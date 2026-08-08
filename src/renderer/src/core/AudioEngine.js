import { Emitter } from './Emitter.js'

/** @typedef {'idle'|'loading'|'playing'|'paused'|'stopped'} PlaybackState */

/**
 * HTMLAudioElement を包んだ再生エンジン。
 *
 * DOM には挿さず `new Audio()` を内部で持つだけにしてあるので、
 * - UI をどう組み替えてもエンジンは影響を受けない
 * - 後で EQ を足したくなったら AudioContext.createMediaElementSource(this.#audio)
 *   でそのまま Web Audio のグラフに繋げられる
 *
 * events:
 *   'track-change'  Track|null
 *   'state-change'  PlaybackState
 *   'time-update'   {currentTime, duration, progress}
 *   'duration-change' number
 *   'volume-change' number (0..1)
 *   'ended'         Track
 *   'error'         Error
 */
export class AudioEngine extends Emitter {
  /** @type {HTMLAudioElement} */
  #audio
  /** @type {import('./Track.js').Track|null} */
  #track = null
  /** @type {PlaybackState} */
  #state = 'idle'

  constructor({ volume = 0.8 } = {}) {
    super()
    this.#audio = new Audio()
    this.#audio.preload = 'metadata'
    this.#audio.volume = clamp01(volume)
    this.#bindAudioEvents()
  }

  // ---- 状態の読み取り ----------------------------------------------------

  get track() {
    return this.#track
  }

  get state() {
    return this.#state
  }

  get isPlaying() {
    return this.#state === 'playing'
  }

  /** 秒。未確定なら 0 */
  get duration() {
    return Number.isFinite(this.#audio.duration) ? this.#audio.duration : 0
  }

  get currentTime() {
    return this.#audio.currentTime || 0
  }

  /** 0..1 */
  get progress() {
    const duration = this.duration
    return duration > 0 ? this.currentTime / duration : 0
  }

  get volume() {
    return this.#audio.volume
  }

  set volume(value) {
    this.#audio.volume = clamp01(value)
  }

  // ---- 操作 --------------------------------------------------------------

  /**
   * トラックを読み込む。
   * @param {import('./Track.js').Track} track
   */
  load(track, { autoplay = false } = {}) {
    this.#track = track
    this.#audio.src = track.url
    this.#audio.load()
    this.#setState('loading')
    this.emit('track-change', track)
    this.#emitTime()
    if (autoplay) this.play()
  }

  play() {
    if (!this.#track) return Promise.resolve()
    return this.#audio.play().catch((error) => {
      this.emit('error', error)
    })
  }

  pause() {
    if (!this.#track) return
    this.#audio.pause()
  }

  toggle() {
    return this.isPlaying ? this.pause() : this.play()
  }

  /** 停止 = 一時停止 + 先頭に巻き戻し */
  stop() {
    if (!this.#track) return
    this.#audio.pause()
    this.#audio.currentTime = 0
    this.#setState('stopped')
    this.#emitTime()
  }

  /** 秒で移動 */
  seek(seconds) {
    if (!this.#track || this.duration <= 0) return
    this.#audio.currentTime = Math.min(Math.max(seconds, 0), this.duration)
    this.#emitTime()
  }

  /** 0..1 の割合で移動 (シークバー用) */
  seekToProgress(ratio) {
    this.seek(clamp01(ratio) * this.duration)
  }

  /** 読み込みを解除して初期状態に戻す */
  unload() {
    this.#audio.pause()
    this.#audio.removeAttribute('src')
    this.#audio.load()
    this.#track = null
    this.#setState('idle')
    this.emit('track-change', null)
    this.#emitTime()
  }

  dispose() {
    this.unload()
    this.removeAllListeners()
  }

  // ---- 内部 --------------------------------------------------------------

  #bindAudioEvents() {
    const audio = this.#audio

    audio.addEventListener('loadedmetadata', () => {
      this.#track?.setDuration(audio.duration)
      this.emit('duration-change', this.duration)
      this.#emitTime()
    })

    audio.addEventListener('play', () => this.#setState('playing'))
    audio.addEventListener('playing', () => this.#setState('playing'))
    audio.addEventListener('waiting', () => this.#setState('loading'))

    audio.addEventListener('pause', () => {
      // stop() 由来の pause は既に 'stopped' にしてあるので上書きしない
      if (this.#state !== 'stopped') this.#setState('paused')
    })

    audio.addEventListener('timeupdate', () => this.#emitTime())
    audio.addEventListener('seeked', () => this.#emitTime())
    audio.addEventListener('volumechange', () => this.emit('volume-change', audio.volume))

    audio.addEventListener('ended', () => {
      this.#setState('stopped')
      this.#emitTime()
      // プレイリストを足すときはここを購読して次の曲へ進める
      this.emit('ended', this.#track)
    })

    audio.addEventListener('error', () => {
      if (!audio.currentSrc) return // unload() 時の空 src は無視
      const code = audio.error?.code
      this.#setState('idle')
      this.emit('error', new Error(`再生できませんでした (code: ${code ?? 'unknown'})`))
    })
  }

  #setState(next) {
    if (this.#state === next) return
    this.#state = next
    this.emit('state-change', next)
  }

  #emitTime() {
    this.emit('time-update', {
      currentTime: this.currentTime,
      duration: this.duration,
      progress: this.progress
    })
  }
}

function clamp01(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.min(Math.max(n, 0), 1)
}
