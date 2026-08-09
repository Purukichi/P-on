import { Emitter } from './Emitter.js'

const STORAGE_KEY = 'hamon.settings'

export const DEFAULTS = {
  /**
   * 面の不透明度 0.25〜0.95。小さいほど透ける。
   * 背景のぼかしは OS のアクリルが担当していて強さを変えられないので、
   * 「背後の文字が読めない曇りガラス」に見えるかどうかはここで決まる。
   * 既定はしっかり曇る側に寄せてある。
   */
  surfaceAlpha: 0.62,
  /** アクセント色の色相 0〜359。既定の 151 は #00c853 相当 */
  accentHue: 151
}

const RANGES = {
  surfaceAlpha: [0.25, 0.95],
  accentHue: [0, 359]
}

/**
 * 見た目の可変パラメータ。
 * 値は CSS 変数として :root に書き込むだけで、実際の配色は theme.css が組み立てる。
 *
 * events: 'change' (settings)
 */
export class Settings extends Emitter {
  #values = { ...DEFAULTS }

  constructor() {
    super()
    this.#values = { ...DEFAULTS, ...readStored() }
    this.apply()
  }

  get values() {
    return { ...this.#values }
  }

  get(key) {
    return this.#values[key]
  }

  set(key, value) {
    if (!(key in DEFAULTS)) return
    const [min, max] = RANGES[key]
    const next = Math.min(Math.max(Number(value), min), max)
    if (!Number.isFinite(next) || next === this.#values[key]) return

    this.#values[key] = next
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.#values))
    this.apply()
    this.emit('change', this.values)
  }

  reset() {
    this.#values = { ...DEFAULTS }
    localStorage.removeItem(STORAGE_KEY)
    this.apply()
    this.emit('change', this.values)
  }

  /** CSS 変数へ反映する */
  apply() {
    const root = document.documentElement.style
    root.setProperty('--surface-alpha', String(this.#values.surfaceAlpha))
    root.setProperty('--accent-hue', String(this.#values.accentHue))
    // アクセント上の文字色は、明度から黒 / 白を選ぶ
    root.setProperty('--color-accent-contrast', accentContrast(this.#values.accentHue))
  }
}

/** アクセント色（hsl(H 100% 42%)）の上に置く文字色を決める */
function accentContrast(hue) {
  const [r, g, b] = hslToRgb(hue, 1, 0.42)
  // ITU-R BT.709 の相対輝度
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  return luminance > 0.5 ? '#0a0a0c' : '#ffffff'
}

function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x]
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255]
}

function readStored() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    return typeof parsed === 'object' && parsed !== null ? parsed : {}
  } catch {
    return {}
  }
}
