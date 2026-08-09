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

const HOVER_CLOSE_DELAY = 220
/** これ以上動かしたら矩形選択とみなす */
const MARQUEE_THRESHOLD = 6

/**
 * 画面下のコレクション棚。
 *
 * 表示はグリッドとリストの 2 通り。どちらも
 *   - チェックボックスで複数選択
 *   - 空きスペースのドラッグで矩形選択
 *   - 検索での絞り込み
 * ができる。
 *
 * events: 'play-collection' ({collectionId, trackId?}),
 *         'create-playlist', 'rename-playlist' (playlistId), 'delete-playlist' (playlistId),
 *         'add-track' ({playlistId, trackId}), 'album-cover' (albumName), 'rename-album' (albumName),
 *         'merge-collections' ({sourceId, targetId}), 'add-collection' ({playlistId, collectionId}),
 *         'edit-collection' (collectionId), 'delete-collection' (collectionId),
 *         'group-selection' ({collectionIds, as: 'album'|'playlist'})
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
  #openId = null
  #closeTimer = null
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
      'shelf-popup',
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
      'shelf-clear-selection'
    ])

    this.#bindToolbar()
    this.#bindCards()
    this.#bindPopup()
    this.#bindContextMenu()
    this.#bindSelectionBar()
    this.#bindMarquee()
    this.#bindDropTargets()

    window.addEventListener('pointerdown', (event) => {
      if (!closestFrom(event.target, '[data-el="shelf-popup"], [data-collection-id]')) this.#closeNow()
    })
    this.#el.shelfList.addEventListener('scroll', () => this.#closeNow())

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
      this.#el.shelfExpandLabel.textContent = expanded ? '折りたたむ' : 'もっと見る'
      this.#closeNow()
    })
  }

  #setView(view) {
    this.#shelf.dataset.view = view
    this.#el.shelfViewGrid.dataset.active = String(view === 'grid')
    this.#el.shelfViewList.dataset.active = String(view === 'list')
    this.#closeNow()
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

    if (this.#openId && !this.#visible.some((c) => c.id === this.#openId)) this.#closeNow()
    else if (this.#openId) this.#fillPopup(this.#openId)
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

      this.clearSelection()
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

    list.addEventListener('pointerover', (event) => {
      const card = event.target.closest('[data-collection-id]')
      if (!card) return
      this.#cancelClose()
      this.#open(card)
    })

    list.addEventListener('pointerleave', () => this.#scheduleClose())
  }

  // ---- 矩形選択 ------------------------------------------------------------

  /** 空きスペースを押してドラッグすると、触れたカードを選択する */
  #bindMarquee() {
    const body = this.#el.shelfBody
    const box = this.#el.shelfMarquee

    body.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return
      // カードの上から始めたときは通常のドラッグ（並べ替え / ゴミ箱）に譲る
      if (closestFrom(event.target, '[data-collection-id]')) return

      const rect = body.getBoundingClientRect()
      this.#marquee = {
        startX: event.clientX - rect.left + body.scrollLeft,
        startY: event.clientY - rect.top + body.scrollTop,
        additive: event.ctrlKey || event.metaKey || event.shiftKey,
        active: false
      }
      body.setPointerCapture(event.pointerId)
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
        if (!this.#marquee.additive) this.#selected.clear()
        box.hidden = false
        this.#closeNow()
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

  // ---- ポップアップ --------------------------------------------------------

  #bindPopup() {
    const popup = this.#el.shelfPopup

    popup.addEventListener('pointerenter', () => this.#cancelClose())
    popup.addEventListener('pointerleave', () => this.#scheduleClose())

    popup.addEventListener('click', (event) => {
      if (!this.#openId) return

      if (event.target.closest('[data-action="album-cover"]')) {
        const collection = this.#find(this.#openId)
        if (collection?.type === CollectionType.ALBUM) this.emit('album-cover', collection.name)
        this.#closeNow()
        return
      }

      const row = event.target.closest('[data-track-id]')
      if (!row) return
      this.emit('play-collection', { collectionId: this.#openId, trackId: row.dataset.trackId })
      this.#closeNow()
    })
  }

  #open(card) {
    const collectionId = card.dataset.collectionId
    if (this.#openId === collectionId && !this.#el.shelfPopup.hidden) return

    this.#openId = collectionId
    this.#fillPopup(collectionId)
    this.#el.shelfPopup.hidden = false
    this.#position(card)
  }

  #fillPopup(collectionId) {
    const collection = this.#find(collectionId)
    if (!collection) return
    const popup = this.#el.shelfPopup

    const header = create('header', {
      className: 'popup__head',
      children: [
        create('span', { className: 'popup__type', text: typeLabel(collection.type) }),
        create('span', { className: 'popup__name', text: collection.name }),
        create('span', { className: 'popup__sub', text: collection.subtitle })
      ]
    })

    if (collection.type === CollectionType.ALBUM) {
      header.append(
        create('button', {
          className: 'popup__action',
          text: collection.ownCoverUrl ? 'アルバムのジャケットを変更' : 'アルバムのジャケットを設定',
          attrs: { type: 'button', 'data-action': 'album-cover' }
        })
      )
    }

    const list = create('ol', { className: 'popup__list' })
    if (collection.tracks.length === 0) {
      list.append(create('li', { className: 'popup__empty', text: '曲がありません' }))
    } else {
      collection.tracks.forEach((track, index) => {
        list.append(
          create('li', {
            className: 'popup__row',
            attrs: { 'data-track-id': track.id, role: 'button', tabindex: '0' },
            children: [
              create('span', { className: 'popup__index', text: String(index + 1).padStart(2, '0') }),
              create('span', { className: 'popup__title', text: track.displayTitle }),
              create('span', {
                className: 'popup__time',
                text: Number.isFinite(track.duration) ? formatTime(track.duration) : '--:--'
              })
            ]
          })
        )
      })
    }

    popup.replaceChildren(header, list)
  }

  /** カードの上に出す。画面からはみ出す場合は寄せる */
  #position(card) {
    const popup = this.#el.shelfPopup
    const cardRect = card.getBoundingClientRect()
    const popupRect = popup.getBoundingClientRect()
    const margin = 12

    const left = Math.min(
      Math.max(margin, cardRect.left + cardRect.width / 2 - popupRect.width / 2),
      window.innerWidth - popupRect.width - margin
    )
    const above = cardRect.top - popupRect.height - 10
    popup.style.left = `${left}px`
    // 上に入らなければ下へ回す
    popup.style.top = `${above >= margin ? above : Math.min(cardRect.bottom + 10, window.innerHeight - popupRect.height - margin)}px`
  }

  #scheduleClose() {
    this.#cancelClose()
    this.#closeTimer = setTimeout(() => this.#closeNow(), HOVER_CLOSE_DELAY)
  }

  #cancelClose() {
    clearTimeout(this.#closeTimer)
    this.#closeTimer = null
  }

  #closeNow() {
    this.#cancelClose()
    this.#openId = null
    this.#el.shelfPopup.hidden = true
  }

  // ---- ドラッグ&ドロップ ----------------------------------------------------

  #bindDropTargets() {
    const list = this.#el.shelfList

    list.addEventListener('dragstart', (event) => {
      const card = event.target.closest('[data-collection-id]')
      if (!card) return
      const collection = this.#find(card.dataset.collectionId)
      if (!collection) return

      setCollectionDragData(event, collection.id)
      attachDragThumbnail(event, { coverUrl: collection.coverUrl, label: collection.name })
      card.dataset.dragging = 'true'
      this.#closeNow()
    })

    list.addEventListener('dragend', (event) => {
      const card = event.target.closest('[data-collection-id]')
      if (card) card.dataset.dragging = 'false'
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

      const sourceId = getCollectionDragData(event)
      if (!sourceId || sourceId === target.id) return

      if (target.type === CollectionType.PLAYLIST) {
        this.emit('add-collection', { playlistId: target.sourceId, collectionId: sourceId })
      } else {
        this.emit('merge-collections', { sourceId, targetId: target.id })
      }
    })
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
      const item = event.target.closest('[data-menu-action]')
      if (!item) return
      const collectionId = menu.dataset.collectionId
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

  #menuItemsFor(collection) {
    const item = (action, text, variant) =>
      create('button', {
        className: variant ? `menu__item menu__item--${variant}` : 'menu__item',
        text,
        attrs: { type: 'button', 'data-menu-action': action }
      })

    const items = [item('play', '再生')]

    if (collection.type === CollectionType.PLAYLIST) {
      items.push(item('rename-playlist', '名前を変更'), item('delete', 'プレイリストを削除', 'danger'))
    } else if (collection.type === CollectionType.ALBUM) {
      items.push(
        item('album-cover', 'アルバムのジャケットを変更'),
        item('rename-album', 'アルバム名を変更'),
        item('delete', 'アルバムごと削除', 'danger')
      )
    } else {
      items.push(item('edit', '楽曲情報を編集'), item('delete', 'この曲を削除', 'danger'))
    }
    return items
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
