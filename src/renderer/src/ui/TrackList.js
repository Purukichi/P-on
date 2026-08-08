import { Emitter } from '../core/Emitter.js'
import { formatTime } from '../utils/time.js'
import { collect, create } from './dom.js'
import { setTrackDragData } from './drag.js'

/**
 * 右カラムの一覧。ライブラリ全体とプレイリストの中身、どちらもここが描く。
 *
 * 行は draggable にしてあり、ゴミ箱やプレイリストへドラッグできる。
 *
 * events: 'play' (trackId), 'edit' (trackId), 'detach' (trackId=プレイリストから外す)
 */
export class TrackList extends Emitter {
  #root
  #el
  /** @type {import('../core/Track.js').Track[]} */
  #tracks = []
  #activeTrackId = null
  #mode = 'library'

  constructor(root) {
    super()
    this.#root = root
  }

  mount() {
    this.#el = collect(this.#root, ['list-title', 'list-count', 'list', 'list-empty'])

    // 行ごとに listener を張らず、リスト全体で受ける（描画のたびに張り直さずに済む）
    this.#el.list.addEventListener('click', (event) => {
      const row = event.target.closest('[data-track-id]')
      if (!row) return
      const trackId = row.dataset.trackId
      const action = event.target.closest('[data-action]')?.dataset.action

      if (action === 'edit') this.emit('edit', trackId)
      else if (action === 'detach') this.emit('detach', trackId)
      else this.emit('play', trackId)
    })

    this.#el.list.addEventListener('dragstart', (event) => {
      const row = event.target.closest('[data-track-id]')
      if (!row) return
      setTrackDragData(event, row.dataset.trackId)
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

  #renderRow(track, index) {
    const row = create('li', {
      className: 'track',
      attrs: { 'data-track-id': track.id, draggable: 'true', 'data-active': 'false' }
    })

    row.append(
      create('span', { className: 'track__index', text: `${index + 1}.` }),
      create('span', {
        className: 'track__main',
        children: [
          create('span', { className: 'track__title', text: track.displayTitle }),
          create('span', {
            className: 'track__meta',
            text: `${track.displayArtist} — ${track.displayAlbum}`
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
}
