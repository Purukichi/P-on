import { Emitter } from '../core/Emitter.js'
import { formatTime } from '../utils/time.js'

/**
 * DOM と AudioEngine を繋ぐ層。
 *
 * 要素の取得には CSS クラスではなく `data-el="..."` を使っている。
 * こうしておくと、見た目を変えるためにクラス名を自由に付け替えても
 * JS 側が壊れない (= スタイルを気軽にいじれる)。
 *
 * events: 'open-request'
 */
export class PlayerView extends Emitter {
  #root
  #engine
  #el = {}
  #isScrubbing = false
  #disposers = []

  /** @param {HTMLElement} root @param {{engine: import('../core/AudioEngine.js').AudioEngine}} deps */
  constructor(root, { engine }) {
    super()
    this.#root = root
    this.#engine = engine
  }

  mount() {
    this.#el = {
      open: this.#query('open'),
      title: this.#query('title'),
      subtitle: this.#query('subtitle'),
      artwork: this.#query('artwork'),
      seek: this.#query('seek'),
      currentTime: this.#query('current-time'),
      duration: this.#query('duration'),
      playToggle: this.#query('play-toggle'),
      stop: this.#query('stop'),
      volume: this.#query('volume'),
      volumeValue: this.#query('volume-value'),
      status: this.#query('status')
    }

    this.#bindDom()
    this.#bindEngine()

    this.#renderTrack(this.#engine.track)
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

  /** 一時的なメッセージ (エラーなど) を出す */
  setStatus(message, { tone = 'info' } = {}) {
    this.#el.status.textContent = message ?? ''
    this.#el.status.dataset.tone = tone
  }

  // ---- DOM -> engine -----------------------------------------------------

  #bindDom() {
    const { open, playToggle, stop, seek, volume } = this.#el

    this.#listen(open, 'click', () => this.emit('open-request'))
    this.#listen(playToggle, 'click', () => this.#engine.toggle())
    this.#listen(stop, 'click', () => this.#engine.stop())

    // ドラッグ中は timeupdate でつまみが戻らないようにフラグを立てる
    this.#listen(seek, 'pointerdown', () => {
      this.#isScrubbing = true
    })
    this.#listen(seek, 'input', () => {
      const ratio = Number(seek.value)
      this.#setSeekFill(ratio)
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

    // スペースで再生 / 停止 (入力欄にフォーカスがあるときは無視)
    this.#listen(window, 'keydown', (event) => {
      if (event.code !== 'Space') return
      if (event.target instanceof HTMLInputElement) return
      event.preventDefault()
      this.#engine.toggle()
    })
  }

  // ---- engine -> DOM -----------------------------------------------------

  #bindEngine() {
    const engine = this.#engine
    this.#disposers.push(
      engine.on('track-change', (track) => this.#renderTrack(track)),
      engine.on('state-change', (state) => this.#renderState(state)),
      engine.on('time-update', (time) => this.#renderTime(time)),
      engine.on('volume-change', (value) => this.#renderVolume(value)),
      engine.on('error', (error) => this.setStatus(error.message, { tone: 'error' }))
    )
  }

  #renderTrack(track) {
    const hasTrack = Boolean(track)
    this.#el.title.textContent = hasTrack ? track.displayTitle : 'ファイルが選択されていません'
    this.#el.subtitle.textContent = hasTrack
      ? track.displaySubtitle
      : '「ファイルを開く」から mp3 / wav / flac を選択'
    this.#el.title.title = hasTrack ? track.filePath : ''
    this.#el.artwork.dataset.empty = String(!hasTrack)

    this.#el.seek.disabled = !hasTrack
    this.#el.playToggle.disabled = !hasTrack
    this.#el.stop.disabled = !hasTrack
    if (hasTrack) this.setStatus('')
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
    this.#setSeekFill(progress)
  }

  #renderVolume(value) {
    this.#el.volume.value = String(value)
    this.#el.volume.style.setProperty('--fill', String(value))
    this.#el.volumeValue.textContent = `${Math.round(value * 100)}`
  }

  #setSeekFill(ratio) {
    this.#el.seek.style.setProperty('--fill', String(ratio))
  }

  // ---- helpers -----------------------------------------------------------

  #query(name) {
    const element = this.#root.querySelector(`[data-el="${name}"]`)
    if (!element) throw new Error(`data-el="${name}" の要素が見つかりません`)
    return element
  }

  #listen(target, type, handler, options) {
    target.addEventListener(type, handler, options)
    this.#disposers.push(() => target.removeEventListener(type, handler, options))
  }
}
