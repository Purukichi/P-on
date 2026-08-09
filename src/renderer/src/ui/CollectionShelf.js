import { Emitter } from '../core/Emitter.js'
import { CollectionType } from '../core/Collections.js'
import { formatTime } from '../utils/time.js'
import { collect, create } from './dom.js'
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
 *         'add-collection' ({playlistId, collectionId}) プレイリストへ束ごと追加
 */
export class CollectionShelf extends Emitter {
  #root
  #el
  /** @type {import('../core/Collections.js').Collection[]} */
  #collections = []
  #openId = null
  #closeTimer = null

  constructor(root) {
    super()
    this.#root = root
  }

  mount() {
    this.#el = collect(this.#root, ['shelf-list', 'shelf-add', 'shelf-popup'])

    this.#bindCards()
    this.#bindPopup()
    this.#bindDropTargets()

    this.#el.shelfAdd.addEventListener('click', () => this.emit('create-playlist'))

    // 棚の外に出たら閉じる
    window.addEventListener('pointerdown', (event) => {
      if (!event.target.closest('[data-el="shelf-popup"], [data-collection-id]')) this.#closeNow()
    })
    this.#el.shelfList.addEventListener('scroll', () => this.#closeNow())

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

      if (action === 'rename') this.emit('rename-playlist', collection.sourceId)
      else if (action === 'delete') this.emit('delete-playlist', collection.sourceId)
      else this.emit('play-collection', { collectionId: collection.id })
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

  #find(collectionId) {
    return this.#collections.find((collection) => collection.id === collectionId) ?? null
  }
}

function typeLabel(type) {
  if (type === CollectionType.PLAYLIST) return 'PLAYLIST'
  if (type === CollectionType.ALBUM) return 'ALBUM'
  return 'SINGLE'
}

/** アルバム / シングルは CD、プレイリストはリストの印 */
function badgeIcon(type) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')

  if (type === CollectionType.PLAYLIST) {
    svg.append(
      pathEl('M4 6h11v2H4zM4 11h11v2H4zM4 16h7v2H4z', 'currentColor'),
      pathEl('M17.5 12.5v5.2a2 2 0 1 1-1.5-1.94V11z', 'currentColor')
    )
  } else {
    // CD
    const outer = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
    outer.setAttribute('cx', '12')
    outer.setAttribute('cy', '12')
    outer.setAttribute('r', '8.4')
    outer.setAttribute('fill', 'none')
    outer.setAttribute('stroke', 'currentColor')
    outer.setAttribute('stroke-width', '1.8')

    const hole = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
    hole.setAttribute('cx', '12')
    hole.setAttribute('cy', '12')
    hole.setAttribute('r', '2.6')
    hole.setAttribute('fill', 'currentColor')

    svg.append(outer, hole)
  }
  return svg
}

function pathEl(d, fill) {
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', d)
  path.setAttribute('fill', fill)
  return path
}
