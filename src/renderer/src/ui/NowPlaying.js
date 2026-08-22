import { Emitter } from '../core/Emitter.js'
import { IMAGE_EXTENSIONS } from '@shared/ipc-channels.js'
import { formatTime } from '../utils/time.js'
import { artistLinks } from './ArtistLinks.js'
import { collect, setMarqueeText } from './dom.js'
import { filePathsFrom, isFileDrag, splitByExtension } from './drag.js'

/**
 * 画面中央〜左：ジャケット、曲情報、シークバー、トランスポート、音量。
 * AudioEngine のイベントを購読して描画するだけで、再生ロジックは持たない。
 *
 * ジャケットは 2 段構え。
 * 大きい枠は「いま鳴っている曲」のもので、左上の札は「その曲が入っている単位」のもの。
 * アルバムの中に単独配信のジャケットを持つ曲が混ざっていても、両方見えるようにしている。
 *
 * events: 'toggle', 'stop', 'next', 'previous', 'repeat', 'shuffle',
 *         'cover-dropped' ({imagePath}), 'cover-request' (ジャケット未設定の枠がクリックされた),
 *         'album-cover-dropped' ({imagePath}), 'album-cover-request' (札への操作)
 */
export class NowPlaying extends Emitter {
  #root
  #engine
  #el
  #isScrubbing = false
  /** 音量を数字で入力している最中か */
  #isTypingVolume = false
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
      'cover-album',
      'cover-album-art',
      'cover-album-image',
      'cover-album-name',
      'cover-album-sub',
      'np-title',
      'np-artist',
      'np-format',
      'seek',
      'current-time',
      'duration',
      'play-toggle',
      'stop',
      'prev',
      'next',
      'repeat',
      'shuffle',
      'volume',
      'volume-value',
      'volume-entry'
    ])

    this.#bindControls()
    this.#bindVolumeEntry()
    this.#bindCoverDrop()
    this.#bindAlbumChip()
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

  /** ループの状態を出す。見た目の出し分けは data-repeat を見て CSS が行う */
  renderRepeat(mode) {
    const label =
      mode === 'one' ? '1曲だけループ' : mode === 'all' ? 'キュー全体をループ' : 'ループしない'
    this.#el.repeat.dataset.repeat = mode
    this.#el.repeat.dataset.tip = `${label}（押すと切り替え）`
    this.#el.repeat.setAttribute('aria-label', label)
  }

  /** シャッフルの状態を出す。見た目の出し分けは data-shuffle を見て CSS が行う */
  renderShuffle(on) {
    const label = on ? 'シャッフル再生' : '順番どおりに再生'
    this.#el.shuffle.dataset.shuffle = String(Boolean(on))
    this.#el.shuffle.dataset.tip = `${label}（押すと切り替え）`
    this.#el.shuffle.setAttribute('aria-label', label)
  }

  /**
   * ジャケットの上に出す「いま鳴らしている単位」の札。
   * アルバム / プレイリストを鳴らしているときだけ出す。
   *
   * @param {{name: string, sub: string, coverUrl: string|null}|null} context null で消す
   */
  renderContext(context) {
    const chip = this.#el.coverAlbum
    chip.hidden = !context
    if (!context) return

    this.#el.coverAlbumName.textContent = context.name
    this.#el.coverAlbumSub.textContent = context.sub
    this.#el.coverAlbumSub.hidden = !context.sub

    if (context.coverUrl) {
      this.#el.coverAlbumImage.src = context.coverUrl
      this.#el.coverAlbumArt.dataset.empty = 'false'
    } else {
      this.#el.coverAlbumImage.removeAttribute('src')
      this.#el.coverAlbumArt.dataset.empty = 'true'
    }

    chip.dataset.tip = `${context.name}\nクリックまたは画像をドロップでジャケットを設定`
  }

  /** ライブラリ更新でジャケットや曲名が変わったときに外から呼ぶ */
  renderTrack(track) {
    const hasTrack = Boolean(track)

    // 長いタイトルは「…」ではなく自動スクロールで全体を見せる
    setMarqueeText(this.#el.npTitle, hasTrack ? track.displayTitle : '曲を選んでください')
    // 名前は押せる形にしておく（ArtistPopover がその人の曲を一覧にする）
    this.#el.npArtist.replaceChildren(
      ...artistLinks(hasTrack ? track.artist : null, { fallback: hasTrack ? track.displayArtist : '—' })
    )

    const format = hasTrack ? track.formatSummary : ''
    this.#el.npFormat.textContent = format
    this.#el.npFormat.hidden = format.length === 0

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
    const { playToggle, stop, prev, next, repeat, shuffle, seek, volume } = this.#el

    this.#listen(playToggle, 'click', () => this.emit('toggle'))
    this.#listen(stop, 'click', () => this.emit('stop'))
    this.#listen(prev, 'click', () => this.emit('previous'))
    this.#listen(next, 'click', () => this.emit('next'))
    this.#listen(repeat, 'click', () => this.emit('repeat'))
    this.#listen(shuffle, 'click', () => this.emit('shuffle'))

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

  /**
   * 音量の数字を直接入力させる。
   * スライダーだと 1 刻みで狙うのが難しいので、
   * ダブルクリック（キーボードなら Enter / Space）で入力欄に差し替える。
   */
  #bindVolumeEntry() {
    const { volumeValue, volumeEntry } = this.#el

    const open = () => {
      this.#isTypingVolume = true
      volumeEntry.value = String(Math.round(this.#engine.volume * 100))
      volumeValue.hidden = true
      volumeEntry.hidden = false
      volumeEntry.focus()
      volumeEntry.select()
    }

    const close = () => {
      this.#isTypingVolume = false
      volumeEntry.hidden = true
      volumeValue.hidden = false
    }

    const commit = () => {
      // 閉じたあとに blur が飛んでくるので、二度読まないようにする
      if (!this.#isTypingVolume) return
      const parsed = Number(volumeEntry.value.trim())
      close()
      // 数字でなければ黙って元の値のまま閉じる
      if (!Number.isFinite(parsed)) return
      this.#engine.volume = Math.min(Math.max(parsed, 0), 100) / 100
    }

    this.#listen(volumeValue, 'dblclick', open)
    this.#listen(volumeValue, 'keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      open()
    })

    this.#listen(volumeEntry, 'blur', commit)
    this.#listen(volumeEntry, 'keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        commit()
      } else if (event.key === 'Escape') {
        event.preventDefault()
        close()
      }
      // Space で再生が切り替わらないよう、入力中のキーは外へ流さない
      event.stopPropagation()
    })
  }

  /**
   * ジャケット枠に画像を落としたら、再生中の「曲」のジャケットとして登録する。
   * アルバムを鳴らしている最中でも曲ごとに設定できるので、
   * 単独配信のジャケットを持つ曲だけ差し替える、といったことができる。
   * アルバム側を変えたいときは左上の札に落とす。
   */
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

  /** 左上の札。こちらはアルバム / プレイリスト側のジャケットを受け持つ */
  #bindAlbumChip() {
    const chip = this.#el.coverAlbum

    this.#listen(chip, 'click', () => this.emit('album-cover-request'))

    this.#listen(chip, 'dragover', (event) => {
      if (!isFileDrag(event)) return
      event.preventDefault()
      event.stopPropagation()
      event.dataTransfer.dropEffect = 'copy'
      chip.dataset.dropping = 'true'
      // 枠側の「落とせます」表示は引っ込める
      this.#el.coverFrame.dataset.dropping = 'false'
    })

    this.#listen(chip, 'dragleave', (event) => {
      if (chip.contains(event.relatedTarget)) return
      chip.dataset.dropping = 'false'
    })

    this.#listen(chip, 'drop', (event) => {
      if (!isFileDrag(event)) return
      event.preventDefault()
      event.stopPropagation()
      chip.dataset.dropping = 'false'
      const [images] = splitByExtension(filePathsFrom(event.dataTransfer), IMAGE_EXTENSIONS)
      if (images.length > 0) this.emit('album-cover-dropped', { imagePath: images[0] })
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
    this.#el.playToggle.dataset.tip = isPlaying ? '一時停止 (Space)' : '再生 (Space)'
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
