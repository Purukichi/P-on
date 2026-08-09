import { Emitter } from '../core/Emitter.js'
import { IMAGE_EXTENSIONS } from '@shared/ipc-channels.js'
import { formatTime } from '../utils/time.js'
import { collect, setMarqueeText } from './dom.js'
import { filePathsFrom, isFileDrag, splitByExtension } from './drag.js'

/**
 * 画面中央〜左：ジャケット、曲情報、シークバー、トランスポート、音量。
 * AudioEngine のイベントを購読して描画するだけで、再生ロジックは持たない。
 *
 * events: 'toggle', 'stop', 'next', 'previous',
 *         'cover-dropped' ({imagePath}), 'cover-request' (ジャケット未設定の枠がクリックされた)
 */
export class NowPlaying extends Emitter {
  #root
  #engine
  #el
  #isScrubbing = false
  #disposers = []

  constructor(root, { engine }) {
    super()
    this.#root = root
    this.#engine = engine
  }

  mount() {
    this.#el = collect(this.#root, [
      'cover-frame',
      'cover-image',
      'np-album',
      'np-title',
      'np-artist',
      'seek',
      'current-time',
      'duration',
      'play-toggle',
      'stop',
      'prev',
      'next',
      'volume',
      'volume-value'
    ])

    this.#bindControls()
    this.#bindCoverDrop()
    this.#bindEngine()

    this.renderTrack(this.#engine.track)
    this.#renderState(this.#engine.state)
    this.#renderTime({ currentTime: 0, duration: 0, progress: 0 })
    this.#renderVolume(this.#engine.volume)
    return this
  }

  destroy() {
    for (const dispose of this.#disposers) dispose()
    this.#disposers = []
    this.removeAllListeners()
  }

  /** キューの位置に応じて前後ボタンの活性を切り替える */
  setNavigation({ hasPrevious, hasNext }) {
    this.#el.prev.disabled = !hasPrevious
    this.#el.next.disabled = !hasNext
  }

  /** ライブラリ更新でジャケットや曲名が変わったときに外から呼ぶ */
  renderTrack(track) {
    const hasTrack = Boolean(track)

    // 長いタイトルは「…」ではなく自動スクロールで全体を見せる
    setMarqueeText(this.#el.npTitle, hasTrack ? track.displayTitle : '曲を選んでください')
    this.#el.npArtist.textContent = hasTrack ? track.displayArtist : '—'
    this.#el.npAlbum.textContent = hasTrack ? track.displayAlbum : ''
    this.#el.npAlbum.hidden = !hasTrack

    if (hasTrack && track.hasCover) {
      this.#el.coverImage.src = track.coverUrl
      this.#el.coverImage.alt = `${track.displayTitle} のジャケット`
      this.#el.coverFrame.dataset.empty = 'false'
    } else {
      this.#el.coverImage.removeAttribute('src')
      this.#el.coverImage.alt = ''
      this.#el.coverFrame.dataset.empty = 'true'
    }

    this.#el.seek.disabled = !hasTrack
    this.#el.playToggle.disabled = !hasTrack
    this.#el.stop.disabled = !hasTrack
  }

  // ---- DOM -> engine -----------------------------------------------------

  #bindControls() {
    const { playToggle, stop, prev, next, seek, volume } = this.#el

    this.#listen(playToggle, 'click', () => this.emit('toggle'))
    this.#listen(stop, 'click', () => this.emit('stop'))
    this.#listen(prev, 'click', () => this.emit('previous'))
    this.#listen(next, 'click', () => this.emit('next'))

    // ドラッグ中は timeupdate でつまみが戻らないようにフラグを立てる
    this.#listen(seek, 'pointerdown', () => {
      this.#isScrubbing = true
    })
    this.#listen(seek, 'input', () => {
      const ratio = Number(seek.value)
      this.#setFill(seek, ratio)
      this.#el.currentTime.textContent = formatTime(ratio * this.#engine.duration)
    })
    this.#listen(seek, 'change', () => {
      this.#engine.seekToProgress(Number(seek.value))
      this.#isScrubbing = false
    })
    this.#listen(seek, 'pointerup', () => {
      this.#isScrubbing = false
    })

    this.#listen(volume, 'input', () => {
      this.#engine.volume = Number(volume.value)
    })
  }

  /** ジャケット枠に画像を落としたら、再生中の曲のジャケットとして登録する */
  #bindCoverDrop() {
    const frame = this.#el.coverFrame

    // ジャケットが未設定の枠をクリックしたら、画像選択ダイアログを開いてもらう
    this.#listen(frame, 'click', () => {
      if (frame.dataset.empty === 'true') this.emit('cover-request')
    })

    this.#listen(frame, 'dragover', (event) => {
      if (!isFileDrag(event)) return
      event.preventDefault()
      event.stopPropagation()
      event.dataTransfer.dropEffect = 'copy'
      frame.dataset.dropping = 'true'
    })
    this.#listen(frame, 'dragleave', () => {
      frame.dataset.dropping = 'false'
    })
    this.#listen(frame, 'drop', (event) => {
      if (!isFileDrag(event)) return
      event.preventDefault()
      event.stopPropagation()
      frame.dataset.dropping = 'false'
      const [images] = splitByExtension(filePathsFrom(event.dataTransfer), IMAGE_EXTENSIONS)
      if (images.length > 0) this.emit('cover-dropped', { imagePath: images[0] })
    })
  }

  // ---- engine -> DOM -----------------------------------------------------

  #bindEngine() {
    const engine = this.#engine
    this.#disposers.push(
      engine.on('track-change', (track) => this.renderTrack(track)),
      engine.on('state-change', (state) => this.#renderState(state)),
      engine.on('time-update', (time) => this.#renderTime(time)),
      engine.on('volume-change', (value) => this.#renderVolume(value))
    )
  }

  #renderState(state) {
    this.#root.dataset.state = state
    const isPlaying = state === 'playing'
    this.#el.playToggle.dataset.playing = String(isPlaying)
    this.#el.playToggle.setAttribute('aria-label', isPlaying ? '一時停止' : '再生')
    this.#el.playToggle.title = isPlaying ? '一時停止 (Space)' : '再生 (Space)'
  }

  #renderTime({ currentTime, duration, progress }) {
    this.#el.duration.textContent = formatTime(duration)
    if (this.#isScrubbing) return
    this.#el.currentTime.textContent = formatTime(currentTime)
    this.#el.seek.value = String(progress)
    this.#setFill(this.#el.seek, progress)
  }

  #renderVolume(value) {
    this.#el.volume.value = String(value)
    this.#setFill(this.#el.volume, value)
    this.#el.volumeValue.textContent = String(Math.round(value * 100))
  }

  #setFill(element, ratio) {
    element.style.setProperty('--fill', String(ratio))
  }

  #listen(target, type, handler, options) {
    target.addEventListener(type, handler, options)
    this.#disposers.push(() => target.removeEventListener(type, handler, options))
  }
}
