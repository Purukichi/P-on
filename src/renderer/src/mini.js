import './styles/mini.css'
import { formatTime } from './utils/time.js'
import { pick, setMarqueeText } from './ui/dom.js'

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
  restore: pick(root, 'mini-restore'),
  close: pick(root, 'mini-close'),
  pin: pick(root, 'mini-pin')
}

const send = (type, value) => window.hamon.player.sendCommand({ type, value })

let isScrubbing = false
let lastDuration = 0

// ---- 操作 -> メインウィンドウ ---------------------------------------------

el.toggle.addEventListener('click', () => send('toggle'))
el.prev.addEventListener('click', () => send('previous'))
el.next.addEventListener('click', () => send('next'))
el.restore.addEventListener('click', () => window.hamon.windows.closeMini())
el.close.addEventListener('click', () => window.hamon.windows.quit())

// ---- ピン留め --------------------------------------------------------------

/*
 * 次に開いたときのために覚えておく。
 * ミニのウィンドウは畳んでも壊さず hide するだけなので、
 * 読み書きするのはこの画面が最初に読み込まれたときだけになる。
 */
const ON_TOP_KEY = 'hamon.mini.onTop'

function applyAlwaysOnTop(onTop) {
  el.pin.dataset.active = String(onTop)
  el.pin.setAttribute('aria-pressed', String(onTop))
  el.pin.title = onTop ? '常に手前に表示（解除する）' : '常に手前に表示する'
  localStorage.setItem(ON_TOP_KEY, onTop ? 'on' : 'off')
  window.hamon.windows.setMiniAlwaysOnTop(onTop)
}

/*
 * 操作面はジャケットに重ねてあるので、普段は引っ込めておき、
 * 窓にマウスが入っているあいだだけ出す。
 * ジャケットの面は窓を動かすための drag 領域で、その上ではページに
 * マウスイベントが届かない（＝CSS の :hover では「操作面に触れたときだけ」に
 * なってしまう）ので、窓に入ったかどうかは main 側から受け取る。
 */
window.hamon.windows.onMiniHover((inside) => {
  root.dataset.hover = String(Boolean(inside))

  /*
   * 出ていった時点で、操作面に残ったフォーカスも外す。
   * ボタンを押したあとフォーカスがそこに留まると、
   * キーボード操作中とみなして操作面が出たままになってしまう。
   */
  if (!inside && root.contains(document.activeElement)) document.activeElement.blur()
})

el.pin.addEventListener('click', () => {
  applyAlwaysOnTop(el.pin.dataset.active !== 'true')
})

// 既定は手前に出す。生成時のウィンドウ設定と揃えてある
applyAlwaysOnTop(localStorage.getItem(ON_TOP_KEY) !== 'off')

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

let lastTitle = null
let lastCoverUrl = null

function render(state) {
  const hasTrack = Boolean(state?.trackId)
  root.dataset.hasTrack = String(hasTrack)
  root.dataset.playing = String(Boolean(state?.isPlaying))

  // 高頻度の time-update でマーキーを作り直さないよう、タイトルが変わったときだけ
  const title = hasTrack ? state.title : '曲が選ばれていません'
  if (title !== lastTitle) {
    lastTitle = title
    setMarqueeText(el.title, title)
  }
  el.artist.textContent = hasTrack ? state.artist : '—'
  el.toggle.setAttribute('aria-label', state?.isPlaying ? '一時停止' : '再生')

  if (state?.coverUrl) {
    el.art.src = state.coverUrl
    el.art.hidden = false
  } else {
    el.art.removeAttribute('src')
    el.art.hidden = true
  }
  if (state?.coverUrl !== lastCoverUrl) {
    lastCoverUrl = state?.coverUrl ?? null
    applyTint(lastCoverUrl)
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

// ---- ジャケットの主要色で余白を塗る ----------------------------------------

/** ジャケットから主要色を抽出し、余白の背景 (--mini-tint) に反映する */
async function applyTint(coverUrl) {
  if (!coverUrl) {
    root.style.removeProperty('--mini-tint')
    return
  }
  try {
    const [r, g, b] = await dominantColor(coverUrl)
    // 半透明にして、下のアクリル（デスクトップのぼかし）が透けるようにする
    root.style.setProperty('--mini-tint', `rgb(${r} ${g} ${b} / 44%)`)
  } catch {
    root.style.removeProperty('--mini-tint')
  }
}

/**
 * 画像を縮小して描き、「彩度と出現数」で重み付けした最頻色を返す。
 * 単純な平均だと濁った灰色になりがちなので、鮮やかな色を優先している。
 */
function dominantColor(url) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous' // hamon-media:// は ACAO を返すので canvas が汚染されない
    image.onload = () => {
      const size = 24
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const context = canvas.getContext('2d', { willReadFrequently: true })
      context.drawImage(image, 0, 0, size, size)

      const { data } = context.getImageData(0, 0, size, size)
      const buckets = new Map()

      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 128) continue
        const r = data[i]
        const g = data[i + 1]
        const b = data[i + 2]
        const saturation = Math.max(r, g, b) - Math.min(r, g, b)
        const brightness = Math.max(r, g, b)
        // 4bit に量子化して近い色をまとめる
        const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
        // 鮮やかで、白飛び・黒潰れしていない色を優遇する
        const weight = 1 + saturation * 2 + (brightness > 40 && brightness < 235 ? 48 : 0)
        buckets.set(key, (buckets.get(key) ?? 0) + weight)
      }

      let bestKey = 0
      let bestWeight = -1
      for (const [key, weight] of buckets) {
        if (weight > bestWeight) {
          bestWeight = weight
          bestKey = key
        }
      }
      resolve([((bestKey >> 8) & 15) * 17, ((bestKey >> 4) & 15) * 17, (bestKey & 15) * 17])
    }
    image.onerror = () => reject(new Error('cover load failed'))
    image.src = url
  })
}

// 開いた直後は状態を知らないので、メインウィンドウに送り直してもらう
window.hamon.player.requestState()
render(null)
