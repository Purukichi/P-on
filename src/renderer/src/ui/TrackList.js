import { Emitter } from '../core/Emitter.js'
import { formatTime } from '../utils/time.js'
import { collect, create } from './dom.js'
import { attachDragThumbnail, setTrackDragData } from './drag.js'

/**
 * 右カラムの一覧。いま鳴らしているキューの中身を並べる。
 *
 * 「編集」を押すと各行がタイトル / アーティスト / アルバムの入力欄に変わり、
 * その場で直せる。入力欄から離れた時点で保存する。
 *
 * events: 'play' (trackId), 'edit' (trackId), 'detach' (trackId),
 *         'update' ({trackId, patch})
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

  constructor(root) {
    super()
    this.#root = root
  }

  get isEditing() {
    return this.#editing
  }

  mount() {
    this.#el = collect(this.#root, ['list-title', 'list-count', 'list', 'list-empty', 'list-edit'])

    this.#el.listEdit.addEventListener('click', () => this.#setEditing(!this.#editing))

    // 行ごとに listener を張らず、リスト全体で受ける
    this.#el.list.addEventListener('click', (event) => {
      const row = event.target.closest('[data-track-id]')
      if (!row) return
      // 編集中は入力欄を触りたいので、行クリックでの再生はしない
      if (event.target.closest('.track__field')) return

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
      if (!row || this.#editing) return
      const track = this.#tracks.find((t) => t.id === row.dataset.trackId)
      setTrackDragData(event, row.dataset.trackId)
      if (track) attachDragThumbnail(event, { coverUrl: track.coverUrl, label: track.displayTitle })
      row.dataset.dragging = 'true'
    })

    this.#el.list.addEventListener('dragend', (event) => {
      const row = event.target.closest('[data-track-id]')
      if (row) row.dataset.dragging = 'false'
    })

    return this
  }

  /**
   * @param {object} options
   * @param {string} options.title 見出し
   * @param {'library'|'playlist'} options.mode プレイリスト表示なら「外す」ボタンを出す
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
    this.#el.listEmpty.textContent = emptyMessage
    this.#el.listEmpty.hidden = tracks.length > 0

    this.#el.list.replaceChildren(...tracks.map((track, index) => this.#renderRow(track, index)))
    this.setActive(this.#activeTrackId)
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
          create('span', { className: 'track__meta', text: track.displayArtist })
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
        attrs: { type: 'button', 'data-action': 'edit', title: '楽曲情報を編集' }
      })
    )
    if (this.#mode === 'playlist') {
      actions.append(
        create('button', {
          className: 'track__action',
          text: '外す',
          attrs: { type: 'button', 'data-action': 'detach', title: 'このプレイリストから外す' }
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
        title: label
      }
    })
    // create() は属性で value を渡すため、実際の入力値も揃えておく
    input.value = value
    return input
  }
}
