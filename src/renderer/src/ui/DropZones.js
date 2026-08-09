import { Emitter } from '../core/Emitter.js'
import { AUDIO_EXTENSIONS, IMAGE_EXTENSIONS } from '@shared/ipc-channels.js'
import { collect } from './dom.js'
import { filePathsFrom, getTrackDragData, isFileDrag, isTrackDrag, splitByExtension } from './drag.js'

/**
 * ウィンドウ全体への音源ドロップと、ゴミ箱へのドロップを受け持つ。
 *
 * ブラウザ既定の挙動（ドロップしたファイルへ画面遷移してしまう）を止めるため、
 * window レベルで dragover / drop を必ず preventDefault している。
 *
 * events: 'files-dropped' (string[] 音源のパス),
 *         'images-dropped' (string[] 画像のパス、ジャケット枠以外に落ちたもの),
 *         'trash-track' (trackId)
 */
export class DropZones extends Emitter {
  #root
  #el
  #dragDepth = 0

  constructor(root) {
    super()
    this.#root = root
  }

  mount() {
    this.#el = collect(this.#root, ['dropveil', 'trash'])
    this.#bindWindow()
    this.#bindTrash()
    return this
  }

  #bindWindow() {
    // 既定の「ファイルを開いてしまう」挙動を全面的に止める
    window.addEventListener('dragover', (event) => {
      if (!isFileDrag(event)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
    })

    window.addEventListener('dragenter', (event) => {
      if (!isFileDrag(event)) return
      this.#dragDepth += 1
      this.#el.dropveil.hidden = false
    })

    window.addEventListener('dragleave', (event) => {
      if (!isFileDrag(event)) return
      this.#dragDepth = Math.max(0, this.#dragDepth - 1)
      if (this.#dragDepth === 0) this.#el.dropveil.hidden = true
    })

    /*
     * ベールを畳むのは capture フェーズで行う。
     * ジャケット枠などのドロップ先は stopPropagation するため、bubble 側の
     * リスナーだけだとベールが出しっぱなしになり、画面が固まったように見える。
     * capture ならどこに落ちても必ず先に呼ばれる。
     */
    window.addEventListener(
      'drop',
      () => {
        this.#dragDepth = 0
        this.#el.dropveil.hidden = true
      },
      true
    )

    window.addEventListener('drop', (event) => {
      if (!isFileDrag(event)) return
      event.preventDefault()

      const [audio, rest] = splitByExtension(filePathsFrom(event.dataTransfer), AUDIO_EXTENSIONS)
      if (audio.length > 0) {
        this.emit('files-dropped', audio)
        return
      }

      // ジャケット枠の外に画像だけが落ちたときも、行き場を用意しておく
      const [images] = splitByExtension(rest, IMAGE_EXTENSIONS)
      if (images.length > 0) this.emit('images-dropped', images)
    })
  }

  #bindTrash() {
    const trash = this.#el.trash

    trash.addEventListener('dragover', (event) => {
      if (!isTrackDrag(event)) return
      event.preventDefault()
      event.stopPropagation()
      event.dataTransfer.dropEffect = 'move'
      trash.dataset.dropping = 'true'
    })

    trash.addEventListener('dragleave', () => {
      trash.dataset.dropping = 'false'
    })

    trash.addEventListener('drop', (event) => {
      if (!isTrackDrag(event)) return
      event.preventDefault()
      event.stopPropagation()
      trash.dataset.dropping = 'false'
      const trackId = getTrackDragData(event)
      if (trackId) this.emit('trash-track', trackId)
    })
  }
}
