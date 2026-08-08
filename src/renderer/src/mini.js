import './styles/mini.css'
import { formatTime } from './utils/time.js'
import { pick } from './ui/dom.js'

/**
 * ミニプレイヤー。
 *
 * ここには AudioEngine を置かない。音を鳴らしているのは常にメインウィンドウで、
 * この画面は受け取った状態を描き、操作を送り返すだけのリモコン。
 * だからウィンドウを切り替えても再生は途切れない。
 */
const root = document.querySelector('#mini')

const el = {
  art: pick(root, 'mini-art'),
  title: pick(root, 'mini-title'),
  artist: pick(root, 'mini-artist'),
  seek: pick(root, 'mini-seek'),
  current: pick(root, 'mini-current'),
  duration: pick(root, 'mini-duration'),
  toggle: pick(root, 'mini-toggle'),
  prev: pick(root, 'mini-prev'),
  next: pick(root, 'mini-next'),
  volume: pick(root, 'mini-volume'),
  restore: pick(root, 'mini-restore')
}

const send = (type, value) => window.hamon.player.sendCommand({ type, value })

let isScrubbing = false
let lastDuration = 0

// ---- 操作 -> メインウィンドウ ---------------------------------------------

el.toggle.addEventListener('click', () => send('toggle'))
el.prev.addEventListener('click', () => send('previous'))
el.next.addEventListener('click', () => send('next'))
el.restore.addEventListener('click', () => window.hamon.windows.closeMini())

el.seek.addEventListener('pointerdown', () => {
  isScrubbing = true
})
el.seek.addEventListener('input', () => {
  const ratio = Number(el.seek.value)
  setFill(el.seek, ratio)
  el.current.textContent = formatTime(ratio * lastDuration)
})
const commitSeek = () => {
  if (!isScrubbing) return
  isScrubbing = false
  send('seek-progress', Number(el.seek.value))
}
el.seek.addEventListener('change', commitSeek)
el.seek.addEventListener('pointerup', commitSeek)

el.volume.addEventListener('input', () => {
  const value = Number(el.volume.value)
  setFill(el.volume, value)
  send('volume', value)
})

// ---- メインウィンドウ -> 表示 ---------------------------------------------

window.hamon.player.onState(render)

function render(state) {
  const hasTrack = Boolean(state?.trackId)
  root.dataset.hasTrack = String(hasTrack)
  root.dataset.playing = String(Boolean(state?.isPlaying))

  el.title.textContent = hasTrack ? state.title : '曲が選ばれていません'
  el.artist.textContent = hasTrack ? state.artist : '—'
  el.toggle.setAttribute('aria-label', state?.isPlaying ? '一時停止' : '再生')

  if (state?.coverUrl) {
    el.art.src = state.coverUrl
    el.art.hidden = false
  } else {
    el.art.removeAttribute('src')
    el.art.hidden = true
  }

  lastDuration = state?.duration ?? 0
  el.duration.textContent = formatTime(lastDuration)
  el.seek.disabled = !hasTrack
  el.prev.disabled = !state?.hasPrevious
  el.next.disabled = !state?.hasNext

  if (!isScrubbing) {
    const progress = state?.progress ?? 0
    el.seek.value = String(progress)
    setFill(el.seek, progress)
    el.current.textContent = formatTime(state?.currentTime ?? 0)
  }

  // 音量はこちらから送った直後に戻ってくるので、つまみを掴んでいない間だけ追従させる
  if (document.activeElement !== el.volume) {
    const volume = state?.volume ?? 0.8
    el.volume.value = String(volume)
    setFill(el.volume, volume)
  }
}

function setFill(element, ratio) {
  element.style.setProperty('--fill', String(ratio))
}

// 開いた直後は状態を知らないので、メインウィンドウに送り直してもらう
window.hamon.player.requestState()
render(null)
