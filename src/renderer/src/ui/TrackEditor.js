import { Emitter } from '../core/Emitter.js'
import { IMAGE_EXTENSIONS } from '@shared/ipc-channels.js'
import { collect } from './dom.js'
import { filePathsFrom, isFileDrag, splitByExtension } from './drag.js'

/**
 * 楽曲情報の編集ダイアログ。
 * タイトル / アーティスト / アルバムの入力と、ジャケットの差し替えを行う。
 *
 * events: 'save' ({trackId, title, artist, album}),
 *         'pick-cover' (trackId), 'drop-cover' ({trackId, imagePath}), 'clear-cover' (trackId),
 *         'replace-audio' (trackId)
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
      'editor-cover-note',
      'editor-audio-name',
      'editor-audio-note',
      'editor-replace-audio',
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
    this.#el.editorReplaceAudio.addEventListener('click', () => {
      if (this.#trackId) this.emit('replace-audio', this.#trackId)
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
    this.renderAudio(track)
    this.#el.editor.showModal()
    this.#el.editorTitle.focus()
  }

  /** ジャケットを差し替えたあと、開いたまま表示だけ更新する */
  renderCover(track) {
    const hasCover = Boolean(track?.coverUrl)
    this.#el.editorThumb.dataset.empty = String(!hasCover)
    if (hasCover) this.#el.editorThumbImage.src = track.coverUrl
    else this.#el.editorThumbImage.removeAttribute('src')

    // 曲個別の指定が無いときはアルバム共通のものを借りて表示している
    const usingAlbumCover = !track?.hasOwnCover && Boolean(track?.albumCoverUrl)
    this.#el.editorClearCover.disabled = !track?.hasOwnCover
    this.#el.editorCoverNote.textContent = usingAlbumCover
      ? 'いまはアルバム共通のジャケットを表示中。ここで設定するとこの曲だけ差し替わります。'
      : ''
  }

  /** 音源を差し替えたあと、開いたまま表示だけ更新する */
  renderAudio(track) {
    this.#el.editorAudioName.textContent = fileNameOf(track?.audioFile)
    // 音質は音源そのものの性質なので、差し替えたことがここに出る
    this.#el.editorAudioNote.textContent = track?.formatSummary ?? ''
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

/** 'audio/かくかく.mp3' から 'かくかく.mp3' だけを取り出す */
function fileNameOf(relativePath) {
  return String(relativePath ?? '').split(/[\\/]/).pop() ?? ''
}
