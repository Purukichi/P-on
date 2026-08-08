import { Emitter } from '../core/Emitter.js'
import { collect, create } from './dom.js'
import { getTrackDragData, isTrackDrag } from './drag.js'

/**
 * 画面下のプレイリスト棚。
 * カードは選択ボタンであると同時に、トラックのドロップ先でもある
 * （曲をカードへドラッグするとそのプレイリストに追加される）。
 *
 * events: 'select' ({type:'library'} | {type:'playlist', id}),
 *         'create', 'rename' (id), 'delete' (id), 'add-track' ({playlistId, trackId})
 */
export class PlaylistShelf extends Emitter {
  #root
  #el

  constructor(root) {
    super()
    this.#root = root
  }

  mount() {
    this.#el = collect(this.#root, ['shelf-library', 'shelf-list', 'playlist-new'])

    this.#el.shelfLibrary.addEventListener('click', () => this.emit('select', { type: 'library' }))
    this.#el.playlistNew.addEventListener('click', () => this.emit('create'))

    this.#el.shelfList.addEventListener('click', (event) => {
      const card = event.target.closest('[data-playlist-id]')
      if (!card) return
      const id = card.dataset.playlistId
      const action = event.target.closest('[data-action]')?.dataset.action

      if (action === 'rename') this.emit('rename', id)
      else if (action === 'delete') this.emit('delete', id)
      else this.emit('select', { type: 'playlist', id })
    })

    this.#bindDropTargets()
    return this
  }

  /**
   * @param {import('../core/Playlist.js').Playlist[]} playlists
   * @param {{view: {type: string, id?: string}, coverOf: (playlistId: string) => string|null, libraryCount: number}} context
   */
  render(playlists, { view, coverOf, libraryCount }) {
    this.#el.shelfLibrary.dataset.active = String(view.type === 'library')
    this.#el.shelfLibrary.querySelector('[data-el="shelf-library-count"]').textContent =
      `${libraryCount}曲`

    this.#el.shelfList.replaceChildren(
      ...playlists.map((playlist) =>
        this.#renderCard(playlist, {
          active: view.type === 'playlist' && view.id === playlist.id,
          coverUrl: coverOf(playlist.id)
        })
      )
    )
  }

  #renderCard(playlist, { active, coverUrl }) {
    const card = create('div', {
      className: 'shelf__card',
      attrs: {
        'data-playlist-id': playlist.id,
        'data-active': String(active),
        role: 'button',
        tabindex: '0'
      }
    })

    const art = create('span', {
      className: 'shelf__art',
      attrs: { 'data-empty': String(!coverUrl) }
    })
    if (coverUrl) {
      art.append(create('img', { className: 'shelf__image', attrs: { src: coverUrl, alt: '' } }))
    }

    card.append(
      art,
      create('span', { className: 'shelf__name', text: playlist.name }),
      create('span', { className: 'shelf__count', text: `${playlist.size}曲` }),
      create('span', {
        className: 'shelf__tools',
        children: [
          create('button', {
            className: 'shelf__tool',
            text: '名前',
            attrs: { type: 'button', 'data-action': 'rename', title: '名前を変更' }
          }),
          create('button', {
            className: 'shelf__tool',
            text: '削除',
            attrs: { type: 'button', 'data-action': 'delete', title: 'プレイリストを削除' }
          })
        ]
      })
    )

    return card
  }

  /** 曲をカードへドラッグしたときにプレイリストへ追加する */
  #bindDropTargets() {
    const list = this.#el.shelfList

    list.addEventListener('dragover', (event) => {
      const card = event.target.closest('[data-playlist-id]')
      if (!card || !isTrackDrag(event)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
      card.dataset.dropping = 'true'
    })

    list.addEventListener('dragleave', (event) => {
      const card = event.target.closest('[data-playlist-id]')
      if (card) card.dataset.dropping = 'false'
    })

    list.addEventListener('drop', (event) => {
      const card = event.target.closest('[data-playlist-id]')
      if (!card || !isTrackDrag(event)) return
      event.preventDefault()
      card.dataset.dropping = 'false'
      const trackId = getTrackDragData(event)
      if (trackId) this.emit('add-track', { playlistId: card.dataset.playlistId, trackId })
    })
  }
}
