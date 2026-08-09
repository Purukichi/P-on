import { Emitter } from '../core/Emitter.js'
import { CollectionType } from '../core/Collections.js'
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

/**
 * 画面下のコレクション棚。
 * プレイリスト / アルバム / シングルのジャケットを並べ、
 * カードにマウスを乗せるとすりガラスのポップアップで収録曲を選べる。
 *
 * events: 'play-collection' ({collectionId, trackId?}),
 *         'create-playlist', 'rename-playlist' (playlistId), 'delete-playlist' (playlistId),
 *         'add-track' ({playlistId, trackId}), 'album-cover' (albumName),
 *         'merge-collections' ({sourceId, targetId})  カード同士を重ねたとき,
 *         'add-collection' ({playlistId, collectionId}) プレイリストへ束ごと追加,
 *         'edit-collection' (collectionId), 'delete-collection' (collectionId),
 *         'rename-album' (albumName),
 *         'group-selection' ({collectionIds, as: 'album'|'playlist'})
 */
export class CollectionShelf extends Emitter {
  #root
  #el
  /** @type {import('../core/Collections.js').Collection[]} */
  #collections = []
  #openId = null
  #closeTimer = null
  /** Ctrl / Shift クリックで選んだカード @type {Set<string>} */
  #selected = new Set()

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
    this.#el = collect(this.#root, [
      'shelf-list',
      'shelf-add',
      'shelf-popup',
      'shelf-menu',
      'shelf-selection',
      'shelf-selection-count',
      'shelf-make-album',
      'shelf-make-playlist',
      'shelf-clear-selection'
    ])

    this.#bindContextMenu()
    this.#bindSelectionBar()

    this.#bindCards()
    this.#bindPopup()
    this.#bindDropTargets()

    this.#el.shelfAdd.addEventListener('click', () => this.emit('create-playlist'))

    // 棚の外に出たら閉じる
    window.addEventListener('pointerdown', (event) => {
      if (!closestFrom(event.target, '[data-el="shelf-popup"], [data-collection-id]')) this.#closeNow()
    })
    this.#el.shelfList.addEventListener('scroll', () => this.#closeNow())

    // 縦ホイールを横スクロールに振り替える（棚は一列なので縦に送れない）
    this.#el.shelfList.addEventListener(
      'wheel',
      (event) => {
        const list = this.#el.shelfList
        if (list.scrollWidth <= list.clientWidth) return
        // タッチパッドの横スワイプはそのまま活かす
        const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
        if (delta === 0) return
        event.preventDefault()
        list.scrollLeft += delta
      },
      { passive: false }
    )

    return this
  }

  /** @param {import('../core/Collections.js').Collection[]} collections */
  render(collections, { activeCollectionId = null } = {}) {
    this.#collections = collections

    this.#el.shelfList.replaceChildren(
      ...collections.map((collection) =>
        this.#renderCard(collection, collection.id === activeCollectionId)
      )
    )

    // 無くなったカードの選択は落とす
    for (const id of [...this.#selected]) {
      if (!collections.some((c) => c.id === id)) this.#selected.delete(id)
    }
    this.#renderSelection()
    this.#closeMenu()

    // 開いていたポップアップの中身が消えたら閉じる
    if (this.#openId && !collections.some((c) => c.id === this.#openId)) this.#closeNow()
    else if (this.#openId) this.#fillPopup(this.#openId)
  }

  // ---- カード ------------------------------------------------------------

  #renderCard(collection, isActive) {
    const card = create('div', {
      className: 'card',
      attrs: {
        'data-collection-id': collection.id,
        'data-type': collection.type,
        'data-active': String(isActive),
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
    // 種類が一目で分かるよう、アルバム / シングルは CD、プレイリストはリストの印を出す
    art.append(create('span', { className: 'card__badge' , children: [badgeIcon(collection.type)] }))

    card.append(
      art,
      create('span', { className: 'card__name', text: collection.name }),
      create('span', { className: 'card__sub', text: collection.subtitle })
    )

    if (collection.type === CollectionType.PLAYLIST) {
      card.append(
        create('span', {
          className: 'card__tools',
          children: [
            create('button', {
              className: 'card__tool',
              text: '名前',
              attrs: { type: 'button', 'data-action': 'rename', title: '名前を変更' }
            }),
            create('button', {
              className: 'card__tool',
              text: '削除',
              attrs: { type: 'button', 'data-action': 'delete', title: 'プレイリストを削除' }
            })
          ]
        })
      )
    }

    return card
  }

  #bindCards() {
    const list = this.#el.shelfList

    list.addEventListener('click', (event) => {
      const card = event.target.closest('[data-collection-id]')
      if (!card) return
      const action = event.target.closest('[data-action]')?.dataset.action
      const collection = this.#find(card.dataset.collectionId)
      if (!collection) return

      // Ctrl / Shift クリックは再生ではなく選択の切り替え
      if (event.ctrlKey || event.metaKey || event.shiftKey) {
        this.#toggleSelection(collection.id)
        return
      }

      if (action === 'rename') this.emit('rename-playlist', collection.sourceId)
      else if (action === 'delete') this.emit('delete-playlist', collection.sourceId)
      else {
        this.clearSelection()
        this.emit('play-collection', { collectionId: collection.id })
      }
    })

    list.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      const card = event.target.closest('[data-collection-id]')
      if (!card) return
      event.preventDefault()
      this.emit('play-collection', { collectionId: card.dataset.collectionId })
    })

    list.addEventListener('pointerover', (event) => {
      const card = event.target.closest('[data-collection-id]')
      if (!card) return
      this.#cancelClose()
      this.#open(card)
    })

    list.addEventListener('pointerleave', () => this.#scheduleClose())
  }

  // ---- ポップアップ ------------------------------------------------------

  #bindPopup() {
    const popup = this.#el.shelfPopup

    popup.addEventListener('pointerenter', () => this.#cancelClose())
    popup.addEventListener('pointerleave', () => this.#scheduleClose())

    popup.addEventListener('click', (event) => {
      if (!this.#openId) return

      // アルバムのジャケット設定
      if (event.target.closest('[data-action="album-cover"]')) {
        const collection = this.#find(this.#openId)
        if (collection?.type === CollectionType.ALBUM) this.emit('album-cover', collection.name)
        this.#closeNow()
        return
      }

      const row = event.target.closest('[data-track-id]')
      if (!row) return
      this.emit('play-collection', {
        collectionId: this.#openId,
        trackId: row.dataset.trackId
      })
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

    // アルバムには共通ジャケットを設定できる（曲ごとの設定とは別枠）
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

  /** カードの真上に出す。画面からはみ出す場合は左右を寄せる */
  #position(card) {
    const popup = this.#el.shelfPopup
    const cardRect = card.getBoundingClientRect()
    const popupRect = popup.getBoundingClientRect()
    const margin = 12

    const left = Math.min(
      Math.max(margin, cardRect.left + cardRect.width / 2 - popupRect.width / 2),
      window.innerWidth - popupRect.width - margin
    )
    popup.style.left = `${left}px`
    popup.style.top = `${Math.max(margin, cardRect.top - popupRect.height - 10)}px`
  }

  #scheduleClose() {
    this.#cancelClose()
    // カードからポップアップへマウスを移す間に閉じないよう、少し待つ
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

  /**
   * 受け付ける組み合わせは 3 つ。
   *   曲         -> プレイリスト        : その曲を追加
   *   コレクション -> プレイリスト        : 束ごと追加
   *   コレクション -> アルバム / シングル : 2 つをまとめて新しいプレイリストを作る
   */
  #bindDropTargets() {
    const list = this.#el.shelfList

    // カード自体もドラッグできる。掴んだ絵がマウスに追随する
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

  /** ドラッグ中の中身に応じて、受け入れられるカードを返す */
  #dropTargetFor(event) {
    const card = event.target.closest('[data-collection-id]')
    if (!card || card.dataset.dragging === 'true') return null

    // 曲はプレイリストにしか落とせない
    if (isTrackDrag(event)) return card.dataset.type === 'playlist' ? card : null
    // コレクションはどのカードにも落とせる
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

    // 画面外へはみ出さないよう寄せる
    const rect = menu.getBoundingClientRect()
    menu.style.left = `${Math.min(x, window.innerWidth - rect.width - 8)}px`
    menu.style.top = `${Math.min(y, window.innerHeight - rect.height - 8) - rect.height / 2}px`
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

  // ---- 複数選択 -------------------------------------------------------------

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
      card.dataset.selected = String(this.#selected.has(card.dataset.collectionId))
    }
    this.#el.shelfSelection.hidden = this.#selected.size === 0
    this.#el.shelfSelectionCount.textContent = `${this.#selected.size}件を選択中`
    // アルバムにまとめられるのは 1 件以上のとき
    this.#el.shelfMakeAlbum.disabled = this.#selected.size === 0
    this.#el.shelfMakePlaylist.disabled = this.#selected.size === 0
  }

  #find(collectionId) {
    return this.#collections.find((collection) => collection.id === collectionId) ?? null
  }
}

function typeLabel(type) {
  if (type === CollectionType.PLAYLIST) return 'PLAYLIST'
  if (type === CollectionType.ALBUM) return 'ALBUM'
  return 'SINGLE'
}

/**
 * 種類ごとの印。ひと目で見分けられるよう形を変えてある。
 *   アルバム   … ケースから覗く盤（重なり）
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
    // 盤が 2 枚重なった形（右奥にもう 1 枚覗く）
    const back = circle(15.6, 12, 6.6, { fill: 'none', stroke: 'currentColor', width: 1.6, opacity: 0.55 })
    const front = circle(9.2, 12, 7, { fill: 'none', stroke: 'currentColor', width: 1.8 })
    const hole = circle(9.2, 12, 2.1, { fill: 'currentColor' })
    svg.append(back, front, hole)
  } else {
    // 一枚の盤
    svg.append(
      circle(12, 12, 8.2, { fill: 'none', stroke: 'currentColor', width: 1.8 }),
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
