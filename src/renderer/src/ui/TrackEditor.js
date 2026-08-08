import { Emitter } from '../core/Emitter.js'
import { collect } from './dom.js'
import { filePathsFrom, isFileDrag, splitByExtension } from './drag.js'

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp']

/**
 * 楽曲情報の編集ダイアログ。
 * タイトル / アーティスト / アルバムの入力と、ジャケットの差し替えを行う。
 *
 * events: 'save' ({trackId, title, artist, album}),
 *         'pick-cover' (trackId), 'drop-cover' ({trackId, imagePath}), 'clear-cover' (trackId)
 */
export class TrackEditor extends Emitter {
  #root
  #el
  #trackId = null

  constructor(root) {
    super()
    this.#root = root
  }

  mount() {
    this.#el = collect(this.#root, [
      'editor',
      'editor-form',
      'editor-title',
      'editor-artist',
      'editor-album',
      'editor-thumb',
      'editor-thumb-image',
      'editor-pick-cover',
      'editor-clear-cover',
      'editor-cancel'
    ])

    this.#el.editorForm.addEventListener('submit', (event) => {
      event.preventDefault()
      if (!this.#trackId) return
      this.emit('save', {
        trackId: this.#trackId,
        title: this.#el.editorTitle.value,
        artist: this.#el.editorArtist.value,
        album: this.#el.editorAlbum.value
      })
      this.close()
    })

    this.#el.editorCancel.addEventListener('click', () => this.close())
    this.#el.editorPickCover.addEventListener('click', () => {
      if (this.#trackId) this.emit('pick-cover', this.#trackId)
    })
    this.#el.editorClearCover.addEventListener('click', () => {
      if (this.#trackId) this.emit('clear-cover', this.#trackId)
    })

    this.#bindThumbDrop()
    return this
  }

  get isOpen() {
    return this.#el.editor.open
  }

  get trackId() {
    return this.#trackId
  }

  open(track) {
    this.#trackId = track.id
    this.#el.editorTitle.value = track.title ?? ''
    this.#el.editorArtist.value = track.artist ?? ''
    this.#el.editorAlbum.value = track.album ?? ''
    this.renderCover(track)
    this.#el.editor.showModal()
    this.#el.editorTitle.focus()
  }

  /** ジャケットを差し替えたあと、開いたまま表示だけ更新する */
  renderCover(track) {
    const hasCover = Boolean(track?.coverUrl)
    this.#el.editorThumb.dataset.empty = String(!hasCover)
    if (hasCover) this.#el.editorThumbImage.src = track.coverUrl
    else this.#el.editorThumbImage.removeAttribute('src')
    this.#el.editorClearCover.disabled = !hasCover
  }

  close() {
    this.#trackId = null
    if (this.#el.editor.open) this.#el.editor.close()
  }

  #bindThumbDrop() {
    const thumb = this.#el.editorThumb

    thumb.addEventListener('dragover', (event) => {
      if (!isFileDrag(event)) return
      event.preventDefault()
      event.stopPropagation()
      event.dataTransfer.dropEffect = 'copy'
      thumb.dataset.dropping = 'true'
    })
    thumb.addEventListener('dragleave', () => {
      thumb.dataset.dropping = 'false'
    })
    thumb.addEventListener('drop', (event) => {
      if (!isFileDrag(event)) return
      event.preventDefault()
      event.stopPropagation()
      thumb.dataset.dropping = 'false'
      const [images] = splitByExtension(filePathsFrom(event.dataTransfer), IMAGE_EXTENSIONS)
      if (images.length > 0 && this.#trackId) {
        this.emit('drop-cover', { trackId: this.#trackId, imagePath: images[0] })
      }
    })
  }
}
