/**
 * ジャケットからアクセント色を拾う。
 *
 * 「いちばん多い色」ではなく「いちばんアクセントになっている色」を選ぶ。
 * 面積の大半を占める地の色（黒や灰色、くすんだ背景）より、
 * 少なくてもはっきり目立つ鮮やかな色のほうが、その絵の印象を決めていることが多い。
 *
 * - 色相を 24 の棚に分け、彩度が高く、暗すぎも明るすぎもしない画素ほど重く数える
 * - いちばん重い棚の画素を、同じ重みで平均した色を採る
 * - 鮮やかな画素がほとんど無い絵（モノクロ写真など）は null を返す（UI はモノクロのまま）
 *
 * 採った色はボタンの塗りや文字にも使うので、明るさと鮮やかさを読める範囲に寄せてから返す。
 */

const SAMPLE_SIZE = 48
const HUE_BINS = 24
/** 鮮やかな画素がこれより少なければ、色の無い絵とみなす（全画素に占める重みの割合） */
const MIN_PRESENCE = 0.025

/**
 * @param {string} url
 * @returns {Promise<{r: number, g: number, b: number}|null>}
 */
export async function pickAccent(url) {
  const data = await sample(url)
  const bins = Array.from({ length: HUE_BINS }, () => ({ weight: 0, r: 0, g: 0, b: 0 }))
  let pixels = 0

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue
    pixels += 1
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    const { h, s, l } = toHsl(r, g, b)
    if (s < 0.22 || l < 0.12 || l > 0.94) continue

    // 鮮やかさを強く効かせ、明るさは中ほどを好む
    const weight = s * s * (1 - Math.abs(l - 0.55) * 1.4)
    if (weight <= 0) continue
    const bin = bins[Math.floor(h * HUE_BINS) % HUE_BINS]
    bin.weight += weight
    bin.r += r * weight
    bin.g += g * weight
    bin.b += b * weight
  }

  // 隣り合う棚は同じ色の揺らぎなので、両隣と合わせた重さで競わせる
  let best = -1
  let bestWeight = 0
  for (let i = 0; i < HUE_BINS; i += 1) {
    const around =
      bins[i].weight + (bins[(i + 1) % HUE_BINS].weight + bins[(i + HUE_BINS - 1) % HUE_BINS].weight) / 2
    if (around > bestWeight) {
      bestWeight = around
      best = i
    }
  }
  if (best < 0 || pixels === 0 || bins[best].weight / pixels < MIN_PRESENCE) return null

  const bin = bins[best]
  return tune({ r: bin.r / bin.weight, g: bin.g / bin.weight, b: bin.b / bin.weight })
}

/**
 * UI に使える色へ寄せる。
 * 明るさは 0.5〜0.68、鮮やかさは 0.5 以上に収め、色相はそのまま残す。
 */
function tune({ r, g, b }) {
  const { h, s, l } = toHsl(r, g, b)
  return fromHsl(h, Math.min(1, Math.max(s, 0.5)), Math.min(0.68, Math.max(l, 0.5)))
}

/** 色を CSS 変数に書き込む。null ならモノクロ（theme.css の既定）に戻す */
export function applyAccent(target, color) {
  const style = target.style
  if (!color) {
    style.removeProperty('--color-accent')
    style.removeProperty('--color-accent-contrast')
    return
  }
  const { r, g, b } = color
  style.setProperty('--color-accent', `rgb(${Math.round(r)} ${Math.round(g)} ${Math.round(b)})`)
  style.setProperty('--color-accent-contrast', contrastOf(color))
}

/** アクセントの上に置く文字色。ITU-R BT.709 の相対輝度で黒 / 白を選ぶ */
function contrastOf({ r, g, b }) {
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  return luminance > 0.55 ? '#0a0a0c' : '#ffffff'
}

function sample(url) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    // hamon-media:// は ACAO を返すので canvas が汚染されない
    image.crossOrigin = 'anonymous'
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = SAMPLE_SIZE
      canvas.height = SAMPLE_SIZE
      const context = canvas.getContext('2d', { willReadFrequently: true })
      context.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
      resolve(context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data)
    }
    image.onerror = () => reject(new Error('cover load failed'))
    image.src = url
  })
}

function toHsl(r, g, b) {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return { h: 0, s: 0, l }
  const s = d / (1 - Math.abs(2 * l - 1))
  let h
  if (max === r) h = ((g - b) / d) % 6
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return { h: ((h / 6) + 1) % 1, s, l }
}

function fromHsl(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h * 6) % 2) - 1))
  const m = l - c / 2
  const sector = Math.floor(h * 6) % 6
  const [r, g, b] = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x]
  ][sector]
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 }
}
