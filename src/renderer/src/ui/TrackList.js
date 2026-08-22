import { Emitter } from '../core/Emitter.js'
import { formatTime } from '../utils/time.js'
import { artistLinks } from './ArtistLinks.js'
import { collect, create } from './dom.js'
import {
  attachDragThumbnail,
  hideNativeDragImage,
  getCollectionDragData,
  getTrackDragData,
  isCollectionDrag,
  isReorderDrag,
  isTrackDrag,
  setReorderDragData,
  setTrackDragData
} from './drag.js'

/**
 * 並べ替えのとき、まわりの行が場所を空けるのにかける時間。
 * 棚の横送り（およそ 250ms で着地）より、ほんの少しゆったり滑らせている。
 */
const SLIDE_MS = 280
const SLIDE_EASING = 'cubic-bezier(0.22, 0.61, 0.36, 1)'

/** 短冊からふだんの行へ戻り終わるまでの見込み（CSS の transition に合わせる） */
const SETTLE_MS = 260

/**
 * 右カラムの一覧。いま鳴らしているキューの中身を並べる。
 *
 * 「編集」を押すと各行がタイトル / アーティスト / アルバムの入力欄に変わり、
 * その場で直せる。入力欄から離れた時点で保存する。
 *
 * 棚のカードをここへ落とすと、そのぶんがキューの末尾に足される（再生キュー）。
 *
 * 曲順の並べ替えは、行を上下にドラッグする。
 * プレイリストと再生キューは編集モードに入らなくてもそのまま動かせる
 * （プレイリストは動かした順がそのまま保存される）。
 * アルバムの曲順を触るときだけは編集モードに入り、行の左の掴み手から動かす。
 *
 * 掴んだ行は短冊のパネルになって指について来て、元いた場所は空きになる。
 * まわりの行は入る場所を空けるように滑るので、手を離す前に並んだ姿が見えている。
 *
 * events: 'play' (trackId), 'edit' (trackId), 'detach' (trackId),
 *         'update' ({trackId, patch}), 'drop-collections' (collectionIds), 'drop-track' (trackId),
 *         'clear-queue', 'reorder' ({trackIds} 並べ替えた後の順)
 */
export class TrackList extends Emitter {
  #root
  #el
  /** @type {import('../core/Track.js').Track[]} */
  #tracks = []
  #activeTrackId = null
  #mode = 'library'
  #editing = false
  /**
   * 最後に渡された表示内容。
   * 編集中は DOM を組み直さずここに控えておき、編集を終えたときにまとめて反映する。
   */
  #latest = { title: '', mode: 'library', tracks: [], emptyMessage: '' }
  /** 並べ替えで掴んでいる行。掴んでいる間だけ入る @type {HTMLElement|null} */
  #dragging = null
  /** 行ごとの「場所を空ける」アニメーション。継ぎ足すときに前のものを止めるために持つ */
  #slides = new WeakMap()
  /** 落とした直後で、短冊からふだんの行へ戻っている最中の曲 @type {string|null} */
  #settlingId = null
  /** 掴む前にいた場所（この行の手前）。落とさずに終わったときはここへ戻す @type {Node|null} */
  #dragOrigin = null
  /** 指について来る短冊 @type {HTMLElement|null} */
  #panel = null
  /** 短冊のどこを掴んでいるか（行の左上からの距離） */
  #panelGrip = { x: 0, y: 0 }
  /** この一覧の中に落とされたか。外で終わったときは並びを元に戻す */
  #dropped = false

  constructor(root) {
    super()
    this.#root = root
  }

  get isEditing() {
    return this.#editing
  }

  mount() {
    this.#el = collect(this.#root, [
      'list-panel',
      'list-title',
      'list-count',
      'list',
      'list-empty',
      'list-edit',
      'list-clear'
    ])

    this.#el.listEdit.addEventListener('click', () => this.#setEditing(!this.#editing))
    this.#el.listClear.addEventListener('click', () => this.emit('clear-queue'))

    // 行ごとに listener を張らず、リスト全体で受ける
    this.#el.list.addEventListener('click', (event) => {
      const row = event.target.closest('[data-track-id]')
      if (!row) return
      // 編集中は入力欄を触りたいので、行クリックでの再生はしない
      if (event.target.closest('.track__field')) return
      // アーティスト名は再生ではなく、その人の曲の一覧を開く（ArtistPopover が受ける）
      if (event.target.closest('[data-artist]')) return

      const trackId = row.dataset.trackId
      const action = event.target.closest('[data-action]')?.dataset.action

      if (action === 'edit') this.emit('edit', trackId)
      else if (action === 'detach') this.emit('detach', trackId)
      else if (!this.#editing) this.emit('play', trackId)
    })

    // 入力欄から離れたら保存する
    this.#el.list.addEventListener(
      'blur',
      (event) => {
        const field = event.target.closest('.track__field')
        if (!field) return
        this.#commit(field)
      },
      true
    )

    this.#el.list.addEventListener('keydown', (event) => {
      const field = event.target.closest('.track__field')
      if (!field) return
      if (event.key === 'Enter') {
        event.preventDefault()
        field.blur()
      } else if (event.key === 'Escape') {
        field.value = field.dataset.original ?? ''
        field.blur()
      }
    })

    this.#el.list.addEventListener('dragstart', (event) => {
      const row = event.target.closest('[data-track-id]')
      if (!row) return

      // 編集中は掴み手からのドラッグだけを受ける（入力欄の文字を選ぶ操作と喧嘩しない）
      if (this.#editing && !event.target.closest('.track__grip')) {
        event.preventDefault()
        return
      }

      const trackId = row.dataset.trackId
      const track = this.#tracks.find((t) => t.id === trackId)

      /*
       * 並べ替えと持ち出しの両方を載せておく。
       * どちらとして扱うかは落とした先が決める。
       * この一覧の中なら並べ替え、ゴミ箱や棚のカードなら持ち出し。
       */
      if (this.#canReorder) setReorderDragData(event, trackId)
      // 編集中の持ち出しは受け付けない（曲順を直している最中に消えると事故になる）
      if (!this.#editing) setTrackDragData(event, trackId)

      if (this.#canReorder) {
        this.#dragging = row
        // 動かすのはこの行だけなので、隣を覚えておけば元の場所に戻せる
        this.#dragOrigin = row.nextSibling
        this.#dropped = false

        // 指について来る短冊は自前で描く（ブラウザ任せの絵は薄く透かされてしまう）
        hideNativeDragImage(event)
        this.#openPanel(row, event)
        // 元の場所は空きにする
        row.dataset.lifted = 'true'
        return
      }

      if (track) {
        attachDragThumbnail(event, { coverUrl: track.coverUrl, label: track.displayTitle })
      }
      row.dataset.dragging = 'true'
    })

    /*
     * 短冊は指について来る。
     *
     * capture で受けるのが要点。
     * 並べ替え中の dragover は、この一覧が受け取った時点で stopPropagation している
     * （棚のカードの受け皿まで上げないため）ので、
     * ふつうに document で待っていると、肝心の一覧の上にいる間だけ座標が届かない。
     *
     * drag は掴んでいる行そのものに届くもので、窓の外へ出ている間も座標を運んでくれる。
     */
    document.addEventListener('dragover', (event) => this.#movePanel(event), true)
    document.addEventListener('drag', (event) => this.#movePanel(event), true)

    this.#el.list.addEventListener('dragend', () => this.#endDrag())

    this.#bindReorder()
    this.#bindDropTarget()

    return this
  }

  /**
   * 曲順の並べ替え。
   *
   * 掴んでいる行は「行そのもの」を動かしながら追いかける。
   * 線を引いて落としどころを示すのではなく、まわりの行が実際に場所を空けるので、
   * 手を離す前に並んだ姿がそのまま見えている。
   */
  #bindReorder() {
    const list = this.#el.list

    list.addEventListener('dragover', (event) => {
      if (!this.#dragging || !isReorderDrag(event)) return

      // 棚のカードの受け皿（パネル側）まで上げない
      event.preventDefault()
      event.stopPropagation()
      event.dataTransfer.dropEffect = 'move'

      const row = event.target.closest('[data-track-id]')
      if (!row || row === this.#dragging) return

      // 行の上半分なら手前、下半分なら奥へ入れる
      const rect = row.getBoundingClientRect()
      const after = event.clientY > rect.top + rect.height / 2
      this.#slideTo(after ? row.nextSibling : row)
    })

    list.addEventListener('drop', (event) => {
      if (!this.#dragging || !isReorderDrag(event)) return
      event.preventDefault()
      event.stopPropagation()

      // 位置はドラッグ中にもう動かしてあるので、いまの並びをそのまま確定する
      this.#dropped = true
      const moved = this.#endDrag()
      if (moved) this.#applyDomOrder()
    })
  }

  /**
   * 指について来る短冊を出す。
   * 行の写しなので、中身はそのまま見える。濃さは行のパネルと同じ（透かさない）。
   */
  #openPanel(row, event) {
    const rect = row.getBoundingClientRect()
    const panel = row.cloneNode(true)
    panel.classList.add('track--panel')
    panel.style.width = `${rect.width}px`
    panel.style.height = `${rect.height}px`
    document.body.append(panel)

    // 掴んだ場所をそのまま持つ（指の下で紙がずれない）
    this.#panel = panel
    this.#panelGrip = { x: event.clientX - rect.left, y: event.clientY - rect.top }
    this.#movePanel(event)
  }

  /**
   * 短冊を指の位置へ動かす。
   *
   * ドラッグの終わりぎわには座標が (0, 0) の催しが届くことがある。
   * そのまま動かすと、離した瞬間に短冊が画面の左上へ飛ぶので読み飛ばす。
   */
  #movePanel(event) {
    if (!this.#panel) return
    if (event.clientX === 0 && event.clientY === 0) return

    const x = event.clientX - this.#panelGrip.x
    const y = event.clientY - this.#panelGrip.y
    this.#panel.style.transform = `translate(${x}px, ${y}px)`
  }

  #closePanel() {
    this.#panel?.remove()
    this.#panel = null
  }

  /** 編集中に加えて、プレイリストと再生キューはそのまま並べ替えられる */
  get #canReorder() {
    return this.#editing || this.#mode === 'playlist' || this.#mode === 'queue'
  }

  /**
   * 掴んでいる行を reference の手前へ移し、押し出される行を滑らせる。
   *
   * 動かす前と後の位置を測り、いったん元の位置へ戻してから 0 へ向かわせる（FLIP）。
   * 途中でもう一度動かされたときは、そのときに見えている位置から測り直すので、
   * 滑っている最中に行き先が変わっても飛ばずにつながる。
   *
   * @param {Node|null} reference この行の手前に入れる。null なら末尾
   */
  #slideTo(reference) {
    if (reference === this.#dragging) return
    // すでにそこにいるなら動かさない（同じ場所へ入れ直すと滑りが途切れる）
    if (this.#dragging.nextSibling === reference) return

    const rows = [...this.#el.list.children].filter((row) => row !== this.#dragging)
    const before = new Map(rows.map((row) => [row, row.getBoundingClientRect().top]))

    this.#el.list.insertBefore(this.#dragging, reference)
    // 通し番号も一緒に振り直す（動かしている最中も並びどおりの数字にする）
    this.#renumber()

    for (const row of rows) {
      // 見えている位置は測り終えたので、走っていたぶんは止めてよい
      this.#slides.get(row)?.cancel()

      const delta = before.get(row) - row.getBoundingClientRect().top
      if (Math.abs(delta) < 1) continue

      const slide = row.animate(
        [{ transform: `translateY(${delta}px)` }, { transform: 'translateY(0)' }],
        { duration: SLIDE_MS, easing: SLIDE_EASING }
      )
      this.#slides.set(row, slide)
    }
  }

  /**
   * 掴んでいる状態を解く。
   * 短冊から普通の行へは、ぱっと戻さずに時間をかけて戻す（CSS の data-settling）。
   *
   * @returns {boolean} 並べ替えとして掴んでいたか
   */
  #endDrag() {
    const row = this.#dragging
    this.#dragging = null
    this.#closePanel()

    for (const child of this.#el.list.children) child.dataset.dragging = 'false'
    if (!row) return false

    delete row.dataset.lifted

    /*
     * ゴミ箱や棚へ持ち出したとき、この一覧の外で終わったとき（Esc など）は、
     * ドラッグ中に動かした見た目だけが残ってしまうので、掴む前の場所へ戻す。
     */
    if (!this.#dropped) {
      this.#el.list.insertBefore(row, this.#dragOrigin)
      this.#renumber()
      this.#dragOrigin = null
      return false
    }
    this.#dragOrigin = null

    /*
     * 落とした直後は、保存を挟んで一覧が組み直されることがある。
     * そのときは行の実体が入れ替わるので、id を覚えておいて
     * 組み直したあとの行で戻りを続ける（#paint の最後）。
     */
    this.#settlingId = row.dataset.trackId
    this.#settle(row)
    setTimeout(() => {
      if (this.#settlingId === row.dataset.trackId) this.#settlingId = null
    }, SETTLE_MS)
    return true
  }

  /** 短冊の見た目から、ふだんの行へ戻す。速さは CSS（.track の transition）が持つ */
  #settle(row) {
    row.dataset.settling = 'true'
    requestAnimationFrame(() => delete row.dataset.settling)
  }

  /** 行の左の通し番号を、いまの並びで振り直す */
  #renumber() {
    ;[...this.#el.list.children].forEach((row, index) => {
      const label = row.querySelector('.track__index')
      if (label) label.textContent = `${index + 1}.`
    })
  }

  /** 並べ替えた DOM の順を、通し番号・控えている一覧・外側へ反映する */
  #applyDomOrder() {
    const order = [...this.#el.list.children].map((row) => row.dataset.trackId)
    this.#renumber()

    const byId = new Map(this.#tracks.map((track) => [track.id, track]))
    this.#tracks = order.map((id) => byId.get(id)).filter(Boolean)
    this.#latest = { ...this.#latest, tracks: this.#tracks }

    this.emit('reorder', { trackIds: order })
  }

  /**
   * 棚のカードの受け皿。
   * パネル全体で受けるので、空のときでも（曲が 1 行も無くても）落とせる。
   */
  #bindDropTarget() {
    const panel = this.#el.listPanel

    /*
     * 棚のカードのほか、右クリックメニューの収録曲（1 曲だけ）も受ける。
     * この一覧の中での並べ替えは、行そのものが動くのでここでは扱わない
     * （並べ替えのドラッグは持ち出し用の型も一緒に持っているため、明示的に外す）。
     */
    const accepts = (event) =>
      !isReorderDrag(event) && (isCollectionDrag(event) || isTrackDrag(event))

    panel.addEventListener('dragover', (event) => {
      if (!accepts(event)) return
      event.preventDefault()
      event.stopPropagation()
      event.dataTransfer.dropEffect = 'copy'
      panel.dataset.dropping = 'true'
    })

    panel.addEventListener('dragleave', (event) => {
      // 中の要素へ移っただけの dragleave では畳まない
      if (panel.contains(event.relatedTarget)) return
      panel.dataset.dropping = 'false'
    })

    panel.addEventListener('drop', (event) => {
      if (!accepts(event)) return
      event.preventDefault()
      event.stopPropagation()
      panel.dataset.dropping = 'false'

      const collectionIds = getCollectionDragData(event)
      if (collectionIds.length > 0) {
        this.emit('drop-collections', collectionIds)
        return
      }

      const trackId = getTrackDragData(event)
      if (trackId) this.emit('drop-track', trackId)
    })
  }

  /**
   * @param {object} options
   * @param {string} options.title 見出し
   * @param {'library'|'playlist'|'queue'} options.mode プレイリスト / 再生キューなら「外す」ボタンを出す
   * @param {import('../core/Track.js').Track[]} options.tracks
   * @param {string} options.emptyMessage
   */
  render({ title, mode, tracks, emptyMessage }) {
    this.#latest = { title, mode, tracks, emptyMessage }

    /*
     * 編集中に組み直すと入力欄からフォーカスが外れてしまうので、DOM は触らない。
     * 控えた内容は編集を終えた時点で反映されるので、
     * その場で直したクレジットもそのまま画面に出る。
     */
    if (this.#editing) return
    this.#paint()
  }

  /** 控えてある内容で一覧を組み直す */
  #paint() {
    const { title, mode, tracks, emptyMessage } = this.#latest
    this.#tracks = tracks
    this.#mode = mode

    this.#el.listTitle.textContent = title
    this.#el.listCount.textContent = `${tracks.length}曲`
    // 空にできるのは自分で組んだキューだけ。アルバムやプレイリストの中身は消さない
    this.#el.listClear.hidden = mode !== 'queue' || tracks.length === 0
    this.#el.listEmpty.textContent = emptyMessage
    this.#el.listEmpty.hidden = tracks.length > 0

    this.#el.list.replaceChildren(...tracks.map((track, index) => this.#renderRow(track, index)))
    this.setActive(this.#activeTrackId)

    /*
     * 並べ替えを保存したあとの組み直し。
     * 行の実体は入れ替わっているので、いま落としたばかりの曲を探して戻りを続ける。
     */
    if (this.#settlingId) {
      const row = [...this.#el.list.children].find((r) => r.dataset.trackId === this.#settlingId)
      if (row) this.#settle(row)
    }
  }

  /** 再生中の行にマークを付ける */
  setActive(trackId) {
    this.#activeTrackId = trackId
    for (const row of this.#el.list.children) {
      row.dataset.active = String(row.dataset.trackId === trackId)
    }
  }

  #setEditing(editing) {
    this.#editing = editing
    this.#root.dataset.listEdit = String(editing)
    this.#el.listEdit.dataset.active = String(editing)
    this.#el.listEdit.textContent = editing ? '完了' : '編集'
    // 編集中に届いていた更新もここで一緒に反映される
    this.#paint()
  }

  #commit(field) {
    const row = field.closest('[data-track-id]')
    if (!row) return
    const value = field.value.trim()
    if (value === (field.dataset.original ?? '')) return
    field.dataset.original = value
    this.emit('update', { trackId: row.dataset.trackId, patch: { [field.dataset.field]: value } })
  }

  #renderRow(track, index) {
    const row = create('li', {
      className: 'track',
      attrs: {
        'data-track-id': track.id,
        draggable: String(!this.#editing),
        'data-active': 'false'
      }
    })

    row.append(create('span', { className: 'track__index', text: `${index + 1}.` }))

    if (this.#editing) {
      row.append(
        // 掴んで上下に動かすと曲順が変わる。ドラッグを始められるのはここだけ
        create('span', {
          className: 'track__grip',
          text: '⠿',
          attrs: { draggable: 'true', 'data-tip': 'ドラッグして曲順を変更', 'aria-hidden': 'true' }
        }),
        create('span', {
          className: 'track__fields',
          children: [
            this.#field('title', track.title || track.baseFileName, track.baseFileName, 'タイトル'),
            this.#field('artist', track.artist ?? '', '', 'アーティスト'),
            this.#field('album', track.album ?? '', '', 'アルバム（空ならシングル）')
          ]
        })
      )
      return row
    }

    row.append(
      create('span', {
        className: 'track__main',
        children: [
          create('span', { className: 'track__title', text: track.displayTitle }),
          // 見出しに出ているアルバム名は繰り返さない。行にはアーティストだけ添える
          create('span', {
            className: 'track__meta',
            children: artistLinks(track.artist, { fallback: track.displayArtist })
          })
        ]
      }),
      create('span', {
        className: 'track__duration',
        text: Number.isFinite(track.duration) ? formatTime(track.duration) : '--:--'
      })
    )

    const actions = create('span', { className: 'track__actions' })
    actions.append(
      create('button', {
        className: 'track__action',
        text: '編集',
        attrs: { type: 'button', 'data-action': 'edit', 'data-tip': '楽曲情報を編集' }
      })
    )
    if (this.#mode === 'playlist' || this.#mode === 'queue') {
      actions.append(
        create('button', {
          className: 'track__action',
          text: '外す',
          attrs: {
            type: 'button',
            'data-action': 'detach',
            'data-tip': this.#mode === 'queue' ? '再生キューから外す' : 'このプレイリストから外す'
          }
        })
      )
    }
    row.append(actions)

    return row
  }

  #field(name, value, placeholder, label) {
    const input = create('input', {
      className: 'track__field',
      attrs: {
        type: 'text',
        value,
        placeholder,
        'data-field': name,
        'data-original': value,
        'aria-label': label,
        'data-tip': label
      }
    })
    // create() は属性で value を渡すため、実際の入力値も揃えておく
    input.value = value
    return input
  }
}
