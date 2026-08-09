import { Emitter } from '../core/Emitter.js'
import { CollectionType, filterCollections } from '../core/Collections.js'
import { formatTime } from '../utils/time.js'
import { closestFrom, collect, create } from './dom.js'
import {
  attachDragThumbnail,
  getCollectionDragData,
  getTrackDragData,
  isCollectionDrag,
  isTrackDrag,
  setCollectionDragData
} from './drag.js'

/** これ以上動かしたら矩形選択とみなす */
const MARQUEE_THRESHOLD = 6

/**
 * 画面下のコレクション棚。
 *
 * 表示はグリッドとリストの 2 通り。どちらも
 *   - チェックボックスで複数選択
 *   - 空きスペース、または Shift を押しながらのドラッグで矩形選択
 *   - 検索での絞り込み
 * ができる。
 *
 * カードの詳細（収録曲の一覧や操作）はすべて右クリックメニューに集約している。
 * ホバーで勝手に出るポップアップは、右クリックメニューとぶつかるので廃止した。
 *
 * events: 'play-collection' ({collectionId, trackId?}),
 *         'create-playlist', 'rename-playlist' (playlistId), 'delete-playlist' (playlistId),
 *         'add-track' ({playlistId, trackId}), 'album-cover' (albumName), 'rename-album' (albumName),
 *         'merge-collections' ({sourceId, targetId}), 'add-collection' ({playlistId, collectionId}),
 *         'edit-collection' (collectionId), 'delete-collection' (collectionId),
 *         'group-selection' ({collectionIds, as: 'album'|'playlist'}),
 *         'delete-selection' (collectionIds)
 */
export class CollectionShelf extends Emitter {
  #root
  #shelf
  #el
  /** 元データ（絞り込み前） @type {import('../core/Collections.js').Collection[]} */
  #all = []
  /** いま並べているもの @type {import('../core/Collections.js').Collection[]} */
  #visible = []
  #activeId = null
  #query = ''
  /** @type {Set<string>} */
  #selected = new Set()
  #marquee = null

  constructor(root) {
    super()
    this.#root = root
  }

  get selectedIds() {
    return [...this.#selected]
  }

  clearSelection() {
    if (this.#selected.size === 0) return
    this.#selected.clear()
    this.#renderSelection()
  }

  mount() {
    this.#shelf = this.#root.querySelector('.shelf')
    this.#el = collect(this.#root, [
      'shelf-body',
      'shelf-list',
      'shelf-empty',
      'shelf-add',
      'shelf-menu',
      'shelf-search',
      'shelf-view-grid',
      'shelf-view-list',
      'shelf-expand',
      'shelf-expand-label',
      'shelf-marquee',
      'shelf-selection',
      'shelf-selection-count',
      'shelf-make-album',
      'shelf-make-playlist',
      'shelf-delete-selection',
      'shelf-clear-selection'
    ])

    this.#bindToolbar()
    this.#bindCards()
    this.#bindContextMenu()
    this.#bindSelectionBar()
    this.#bindMarquee()
    this.#bindDropTargets()

    this.#el.shelfList.addEventListener('scroll', () => this.#closeMenu())

    return this
  }

  /** @param {import('../core/Collections.js').Collection[]} collections */
  render(collections, { activeCollectionId = null } = {}) {
    this.#all = collections
    this.#activeId = activeCollectionId
    this.#renderList()
  }

  // ---- ツールバー ----------------------------------------------------------

  #bindToolbar() {
    this.#el.shelfAdd.addEventListener('click', () => this.emit('create-playlist'))

    this.#el.shelfSearch.addEventListener('input', () => {
      this.#query = this.#el.shelfSearch.value
      this.#renderList()
    })

    this.#el.shelfViewGrid.addEventListener('click', () => this.#setView('grid'))
    this.#el.shelfViewList.addEventListener('click', () => this.#setView('list'))

    this.#el.shelfExpand.addEventListener('click', () => {
      const expanded = this.#shelf.dataset.expanded !== 'true'
      this.#shelf.dataset.expanded = String(expanded)
      // 展開中はメインUIをコンパクトな 1 行に切り替える（CSS 側が拾う）
      this.#root.dataset.shelfExpanded = String(expanded)
      this.#el.shelfExpandLabel.textContent = expanded ? '折りたたむ' : 'もっと見る'
      this.#closeMenu()
    })
  }

  #setView(view) {
    this.#shelf.dataset.view = view
    this.#el.shelfViewGrid.dataset.active = String(view === 'grid')
    this.#el.shelfViewList.dataset.active = String(view === 'list')
    this.#closeMenu()
    this.#renderList()
  }

  get #view() {
    return this.#shelf.dataset.view === 'list' ? 'list' : 'grid'
  }

  // ---- 一覧の描画 ----------------------------------------------------------

  #renderList() {
    this.#visible = filterCollections(this.#all, this.#query)

    this.#el.shelfList.replaceChildren(
      ...this.#visible.map((collection) => this.#renderCard(collection))
    )

    const nothing = this.#visible.length === 0
    this.#el.shelfEmpty.hidden = !nothing
    this.#el.shelfEmpty.textContent =
      this.#all.length === 0
        ? '音源ファイルをウィンドウにドラッグすると取り込めます'
        : '見つかりませんでした'

    // 消えたカードの選択は落とす
    for (const id of [...this.#selected]) {
      if (!this.#all.some((c) => c.id === id)) this.#selected.delete(id)
    }
    this.#renderSelection()
    this.#closeMenu()
  }

  #renderCard(collection) {
    const isActive = collection.id === this.#activeId

    const card = create('div', {
      className: 'card',
      attrs: {
        'data-collection-id': collection.id,
        'data-type': collection.type,
        'data-active': String(isActive),
        'data-selected': String(this.#selected.has(collection.id)),
        draggable: 'true',
        role: 'button',
        tabindex: '0',
        title: `${collection.name}（${collection.subtitle}）`
      }
    })

    const art = create('span', {
      className: 'card__art',
      attrs: { 'data-empty': String(!collection.coverUrl) }
    })
    if (collection.coverUrl) {
      art.append(create('img', { className: 'card__image', attrs: { src: collection.coverUrl, alt: '' } }))
    }
    art.append(create('span', { className: 'card__badge', children: [badgeIcon(collection.type)] }))

    // 選択用のチェックボックス。押し間違えたときはもう一度押せば外れる
    const check = create('span', {
      className: 'card__check',
      attrs: { 'data-action': 'select', role: 'checkbox', tabindex: '0' }
    })
    check.setAttribute('aria-checked', String(this.#selected.has(collection.id)))
    check.append(checkIcon())

    card.append(
      art,
      check,
      create('span', { className: 'card__name', text: collection.name }),
      create('span', { className: 'card__sub', text: collection.subtitle })
    )

    if (this.#view === 'list') {
      card.append(
        create('span', {
          className: 'card__meta',
          text: `${typeLabel(collection.type)} · ${collection.size}曲`
        })
      )
    }

    return card
  }

  // ---- カードの操作 --------------------------------------------------------

  #bindCards() {
    const list = this.#el.shelfList

    list.addEventListener('click', (event) => {
      const card = event.target.closest('[data-collection-id]')
      if (!card) return
      const collection = this.#find(card.dataset.collectionId)
      if (!collection) return

      // チェックボックス、または修飾キー付きクリックは選択の切り替え
      if (event.target.closest('[data-action="select"]') || event.ctrlKey || event.metaKey || event.shiftKey) {
        event.preventDefault()
        this.#toggleSelection(collection.id)
        return
      }

      /*
       * 再生しても選択は解除しない。
       * 解除するのは「選択を解除」ボタンか、選択を使う操作が終わったときだけ。
       * （途中で外れると、選び直しからやり直すことになって煩わしい）
       */
      this.emit('play-collection', { collectionId: collection.id })
    })

    list.addEventListener('keydown', (event) => {
      const card = event.target.closest('[data-collection-id]')
      if (!card) return
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      if (event.target.closest('[data-action="select"]')) this.#toggleSelection(card.dataset.collectionId)
      else this.emit('play-collection', { collectionId: card.dataset.collectionId })
    })

  }

  // ---- 矩形選択 ------------------------------------------------------------

  /** 空きスペースを押してドラッグすると、触れたカードを選択する */
  #bindMarquee() {
    const body = this.#el.shelfBody
    const box = this.#el.shelfMarquee

    body.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return

      /*
       * 矩形選択は Shift を押している間だけ。
       * 何も押していないドラッグはカードの並べ替え / ゴミ箱行きに使うので、
       * 意図をはっきり分けている。
       */
      if (!event.shiftKey) return
      event.preventDefault()

      const rect = body.getBoundingClientRect()
      this.#marquee = {
        startX: event.clientX - rect.left + body.scrollLeft,
        startY: event.clientY - rect.top + body.scrollTop,
        active: false
      }
      // 実ポインタが無い（合成イベント等）場合は捕捉できないので握りつぶす
      try {
        body.setPointerCapture(event.pointerId)
      } catch {
        /* 捕捉できなくても矩形選択自体は動く */
      }
    })

    body.addEventListener('pointermove', (event) => {
      if (!this.#marquee) return
      const rect = body.getBoundingClientRect()
      const x = event.clientX - rect.left + body.scrollLeft
      const y = event.clientY - rect.top + body.scrollTop
      const { startX, startY } = this.#marquee

      if (!this.#marquee.active) {
        if (Math.abs(x - startX) < MARQUEE_THRESHOLD && Math.abs(y - startY) < MARQUEE_THRESHOLD) return
        this.#marquee.active = true
        // すでに選んでいるものは残したまま、なぞったぶんを足していく
        box.hidden = false
        this.#closeMenu()
      }

      const left = Math.min(x, startX)
      const top = Math.min(y, startY)
      const width = Math.abs(x - startX)
      const height = Math.abs(y - startY)
      Object.assign(box.style, {
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`,
        height: `${height}px`
      })

      this.#selectWithin({ left, top, right: left + width, bottom: top + height })
    })

    const finish = (event) => {
      if (!this.#marquee) return
      if (body.hasPointerCapture?.(event.pointerId)) body.releasePointerCapture(event.pointerId)
      box.hidden = true
      this.#marquee = null
    }
    body.addEventListener('pointerup', finish)
    body.addEventListener('pointercancel', finish)
  }

  /** 矩形に重なっているカードを選択状態にする */
  #selectWithin(area) {
    const body = this.#el.shelfBody
    const bodyRect = body.getBoundingClientRect()

    for (const card of this.#el.shelfList.children) {
      const rect = card.getBoundingClientRect()
      const left = rect.left - bodyRect.left + body.scrollLeft
      const top = rect.top - bodyRect.top + body.scrollTop
      const hit =
        left < area.right && left + rect.width > area.left && top < area.bottom && top + rect.height > area.top
      if (hit) this.#selected.add(card.dataset.collectionId)
    }
    this.#renderSelection()
  }

  // ---- ドラッグ&ドロップ ----------------------------------------------------

  #bindDropTargets() {
    const list = this.#el.shelfList

    list.addEventListener('dragstart', (event) => {
      const card = event.target.closest('[data-collection-id]')
      if (!card) return
      const collection = this.#find(card.dataset.collectionId)
      if (!collection) return

      /*
       * 選択済みのカードを掴んだときは、選択しているものをまとめて運ぶ。
       * そのままゴミ箱へ落とせば一括削除になる。
       */
      const ids = this.#selected.has(collection.id) && this.#selected.size > 1
        ? this.selectedIds
        : [collection.id]

      setCollectionDragData(event, ids)
      attachDragThumbnail(event, {
        coverUrl: collection.coverUrl,
        label: ids.length > 1 ? `${ids.length}件` : collection.name
      })
      for (const id of ids) {
        this.#cardOf(id)?.setAttribute('data-dragging', 'true')
      }
      this.#closeMenu()
    })

    list.addEventListener('dragend', () => {
      for (const card of this.#el.shelfList.children) card.dataset.dragging = 'false'
    })

    list.addEventListener('dragover', (event) => {
      const card = this.#dropTargetFor(event)
      if (!card) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
      card.dataset.dropping = 'true'
    })

    list.addEventListener('dragleave', (event) => {
      const card = event.target.closest('[data-collection-id]')
      if (card) card.dataset.dropping = 'false'
    })

    list.addEventListener('drop', (event) => {
      const card = this.#dropTargetFor(event)
      if (!card) return
      event.preventDefault()
      card.dataset.dropping = 'false'

      const target = this.#find(card.dataset.collectionId)
      if (!target) return

      if (isTrackDrag(event)) {
        const trackId = getTrackDragData(event)
        if (trackId) this.emit('add-track', { playlistId: target.sourceId, trackId })
        return
      }

      const sources = getCollectionDragData(event).filter((id) => id !== target.id)
      if (sources.length === 0) return

      if (target.type === CollectionType.PLAYLIST) {
        for (const collectionId of sources) {
          this.emit('add-collection', { playlistId: target.sourceId, collectionId })
        }
      } else {
        this.emit('merge-collections', { sourceIds: sources, targetId: target.id })
      }
    })
  }

  #cardOf(collectionId) {
    return this.#el.shelfList.querySelector(`[data-collection-id="${CSS.escape(collectionId)}"]`)
  }

  #dropTargetFor(event) {
    const card = event.target.closest('[data-collection-id]')
    if (!card || card.dataset.dragging === 'true') return null
    if (isTrackDrag(event)) return card.dataset.type === 'playlist' ? card : null
    if (isCollectionDrag(event)) return card
    return null
  }

  // ---- 右クリックメニュー ---------------------------------------------------

  #bindContextMenu() {
    const menu = this.#el.shelfMenu

    this.#el.shelfList.addEventListener('contextmenu', (event) => {
      const card = event.target.closest('[data-collection-id]')
      if (!card) return
      event.preventDefault()
      const collection = this.#find(card.dataset.collectionId)
      if (collection) this.#openMenu(collection, event.clientX, event.clientY)
    })

    menu.addEventListener('click', (event) => {
      const collectionId = menu.dataset.collectionId

      // 収録曲を直接選んで再生する
      const row = event.target.closest('[data-track-id]')
      if (row) {
        this.#closeMenu()
        this.emit('play-collection', { collectionId, trackId: row.dataset.trackId })
        return
      }

      const item = event.target.closest('[data-menu-action]')
      if (!item) return
      const collection = this.#find(collectionId)
      this.#closeMenu()
      if (!collection) return

      switch (item.dataset.menuAction) {
        case 'play':
          this.emit('play-collection', { collectionId })
          break
        case 'edit':
          this.emit('edit-collection', collectionId)
          break
        case 'album-cover':
          this.emit('album-cover', collection.name)
          break
        case 'rename-album':
          this.emit('rename-album', collection.name)
          break
        case 'rename-playlist':
          this.emit('rename-playlist', collection.sourceId)
          break
        case 'delete':
          this.emit('delete-collection', collectionId)
          break
      }
    })

    window.addEventListener('pointerdown', (event) => {
      if (!closestFrom(event.target, '[data-el="shelf-menu"]')) this.#closeMenu()
    })
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.#closeMenu()
    })
  }

  #openMenu(collection, x, y) {
    const menu = this.#el.shelfMenu
    menu.dataset.collectionId = collection.id
    menu.replaceChildren(...this.#menuItemsFor(collection))
    menu.hidden = false

    const rect = menu.getBoundingClientRect()
    menu.style.left = `${Math.min(x, window.innerWidth - rect.width - 8)}px`
    menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - rect.height - 8) - rect.height / 2)}px`
  }

  /**
   * メニューの中身。
   * 以前はホバーのポップアップに出していた収録曲の一覧も、ここにまとめてある。
   */
  #menuItemsFor(collection) {
    const item = (action, text, variant) =>
      create('button', {
        className: variant ? `menu__item menu__item--${variant}` : 'menu__item',
        text,
        attrs: { type: 'button', 'data-menu-action': action }
      })

    const parts = [
      create('div', {
        className: 'menu__head',
        children: [
          create('span', { className: 'menu__type', text: typeLabel(collection.type) }),
          create('span', { className: 'menu__name', text: collection.name }),
          create('span', { className: 'menu__sub', text: collection.subtitle })
        ]
      }),
      item('play', '先頭から再生')
    ]

    if (collection.type === CollectionType.PLAYLIST) {
      parts.push(item('rename-playlist', '名前を変更'), item('delete', 'プレイリストを削除', 'danger'))
    } else if (collection.type === CollectionType.ALBUM) {
      parts.push(
        item('album-cover', 'アルバムのジャケットを変更'),
        item('rename-album', 'アルバム名を変更'),
        item('delete', 'アルバムごと削除', 'danger')
      )
    } else {
      parts.push(item('edit', '楽曲情報を編集'), item('delete', 'この曲を削除', 'danger'))
    }

    // 収録曲。1 曲だけのシングルでは省く
    if (collection.tracks.length > 1) {
      const list = create('ol', { className: 'menu__tracks' })
      collection.tracks.forEach((track, index) => {
        list.append(
          create('li', {
            className: 'menu__track',
            attrs: { 'data-track-id': track.id, role: 'button', tabindex: '0' },
            children: [
              create('span', { className: 'menu__index', text: String(index + 1).padStart(2, '0') }),
              create('span', { className: 'menu__title', text: track.displayTitle }),
              create('span', {
                className: 'menu__time',
                text: Number.isFinite(track.duration) ? formatTime(track.duration) : '--:--'
              })
            ]
          })
        )
      })
      parts.push(create('div', { className: 'menu__divider' }), list)
    }

    return parts
  }

  #closeMenu() {
    this.#el.shelfMenu.hidden = true
  }

  // ---- 選択 ----------------------------------------------------------------

  #bindSelectionBar() {
    this.#el.shelfMakeAlbum.addEventListener('click', () => {
      this.emit('group-selection', { collectionIds: this.selectedIds, as: 'album' })
    })
    this.#el.shelfMakePlaylist.addEventListener('click', () => {
      this.emit('group-selection', { collectionIds: this.selectedIds, as: 'playlist' })
    })
    /*
     * ゴミ箱までドラッグしなくても消せるようにしておく。
     * 棚を広げているとゴミ箱が遠く、掴んだまま運ぶのが億劫なため。
     */
    this.#el.shelfDeleteSelection.addEventListener('click', () => {
      this.emit('delete-selection', this.selectedIds)
    })
    this.#el.shelfClearSelection.addEventListener('click', () => this.clearSelection())
  }

  #toggleSelection(collectionId) {
    if (this.#selected.has(collectionId)) this.#selected.delete(collectionId)
    else this.#selected.add(collectionId)
    this.#renderSelection()
  }

  #renderSelection() {
    for (const card of this.#el.shelfList.children) {
      const on = this.#selected.has(card.dataset.collectionId)
      card.dataset.selected = String(on)
      card.querySelector('.card__check')?.setAttribute('aria-checked', String(on))
    }
    this.#el.shelfSelection.hidden = this.#selected.size === 0
    this.#el.shelfSelectionCount.textContent = `${this.#selected.size}件を選択中`
    this.#el.shelfMakeAlbum.disabled = this.#selected.size === 0
    this.#el.shelfMakePlaylist.disabled = this.#selected.size === 0
    this.#el.shelfDeleteSelection.disabled = this.#selected.size === 0
  }

  #find(collectionId) {
    return this.#all.find((collection) => collection.id === collectionId) ?? null
  }
}

function typeLabel(type) {
  if (type === CollectionType.PLAYLIST) return 'PLAYLIST'
  if (type === CollectionType.ALBUM) return 'ALBUM'
  return 'SINGLE'
}

function checkIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')
  svg.append(pathEl('M9.6 16.2 5.4 12l-1.4 1.4 5.6 5.6 12-12L20.2 5.6z'))
  return svg
}

/**
 * 種類ごとの印。ひと目で見分けられるよう形を変えてある。
 *   アルバム   … 盤が 2 枚重なった形
 *   シングル   … 一枚の盤
 *   プレイリスト … リストと再生記号
 */
function badgeIcon(type) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')

  if (type === CollectionType.PLAYLIST) {
    svg.append(
      pathEl('M3 6h12v2.2H3zM3 10.9h12v2.2H3zM3 15.8h7.5V18H3z'),
      pathEl('M17.4 10v6.1a2.3 2.3 0 1 1-1.7-2.2V8.2l5.3-1.2v5.9a2.3 2.3 0 1 1-1.7-2.2V9z')
    )
  } else if (type === CollectionType.ALBUM) {
    svg.append(
      circle(15.6, 12, 6.6, { stroke: 'currentColor', width: 1.6, opacity: 0.55 }),
      circle(9.2, 12, 7, { stroke: 'currentColor', width: 1.8 }),
      circle(9.2, 12, 2.1, { fill: 'currentColor' })
    )
  } else {
    svg.append(
      circle(12, 12, 8.2, { stroke: 'currentColor', width: 1.8 }),
      circle(12, 12, 2.4, { fill: 'currentColor' })
    )
  }
  return svg
}

function circle(cx, cy, r, { fill = 'none', stroke, width, opacity } = {}) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
  element.setAttribute('cx', String(cx))
  element.setAttribute('cy', String(cy))
  element.setAttribute('r', String(r))
  element.setAttribute('fill', fill)
  if (stroke) element.setAttribute('stroke', stroke)
  if (width) element.setAttribute('stroke-width', String(width))
  if (opacity != null) element.setAttribute('opacity', String(opacity))
  return element
}

function pathEl(d) {
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', d)
  path.setAttribute('fill', 'currentColor')
  return path
}
