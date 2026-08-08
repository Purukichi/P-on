import { Emitter } from './Emitter.js'

/**
 * 再生キュー。「次に何を鳴らすか」だけを管理し、再生そのものには関与しない。
 *
 * - リストから曲を選ぶ  -> replace() でその一覧に差し替え
 * - ウィンドウにドロップ -> enqueue() で末尾に追加
 *
 * events: 'change' ({tracks, index})
 */
export class PlayQueue extends Emitter {
  /** @type {import('./Track.js').Track[]} */
  #tracks = []
  #index = -1

  get tracks() {
    return this.#tracks
  }

  get index() {
    return this.#index
  }

  get current() {
    return this.#tracks[this.#index] ?? null
  }

  get hasNext() {
    return this.#index >= 0 && this.#index < this.#tracks.length - 1
  }

  get hasPrevious() {
    return this.#index > 0
  }

  /** キューを丸ごと差し替える */
  replace(tracks, startIndex = 0) {
    this.#tracks = [...tracks]
    this.#index = this.#tracks.length === 0 ? -1 : clampIndex(startIndex, this.#tracks.length)
    this.#emit()
    return this.current
  }

  /** 末尾に追加する。何も再生していなければ最初の追加曲を指す */
  enqueue(tracks) {
    if (tracks.length === 0) return null
    const wasEmpty = this.#index < 0
    const firstAddedIndex = this.#tracks.length
    this.#tracks = [...this.#tracks, ...tracks]
    if (wasEmpty) this.#index = firstAddedIndex
    this.#emit()
    return wasEmpty ? this.current : null
  }

  next() {
    if (!this.hasNext) return null
    this.#index += 1
    this.#emit()
    return this.current
  }

  previous() {
    if (!this.hasPrevious) return null
    this.#index -= 1
    this.#emit()
    return this.current
  }

  /** id を指定してキュー内の曲へ移動する */
  jumpTo(trackId) {
    const index = this.#tracks.findIndex((track) => track.id === trackId)
    if (index < 0) return null
    this.#index = index
    this.#emit()
    return this.current
  }

  /** 消された曲をキューから取り除く。現在再生中の曲が消えたら次の曲へ寄せる */
  remove(trackId) {
    const index = this.#tracks.findIndex((track) => track.id === trackId)
    if (index < 0) return false

    this.#tracks = this.#tracks.filter((track) => track.id !== trackId)

    if (this.#tracks.length === 0) this.#index = -1
    else if (index < this.#index) this.#index -= 1
    else if (index === this.#index) this.#index = Math.min(this.#index, this.#tracks.length - 1)

    this.#emit()
    return true
  }

  /** ライブラリ更新後に、キュー内の Track を新しい実体へ貼り替える */
  refresh(resolveTrack) {
    let changed = false
    const next = []
    for (const track of this.#tracks) {
      const resolved = resolveTrack(track.id)
      if (resolved) next.push(resolved)
      else changed = true
    }
    if (!changed && next.every((track, i) => track === this.#tracks[i])) return
    const currentId = this.current?.id
    this.#tracks = next
    this.#index = currentId ? next.findIndex((track) => track.id === currentId) : -1
    if (this.#index < 0 && next.length > 0) this.#index = 0
    this.#emit()
  }

  clear() {
    this.#tracks = []
    this.#index = -1
    this.#emit()
  }

  #emit() {
    this.emit('change', { tracks: this.#tracks, index: this.#index })
  }
}

function clampIndex(value, length) {
  return Math.min(Math.max(value, 0), length - 1)
}
