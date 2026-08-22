/**
 * 見た目の固定値。
 *
 * 以前はスライダーで透過度と色相を変えられるようにしていたが、
 * 実際に使ってみて調整の必要が無かったので固定に戻した。
 * 変えたいときはこの値か theme.css を直接編集する。
 */
export const APPEARANCE = {
  /** 本体の面の不透明度。小さいほどデスクトップが透ける */
  surfaceAlpha: 0.25,
  /** アクセント色。theme.css の --color-accent と同じ値にしておくこと */
  accent: '#72e887'
}

/** :root に CSS 変数として書き込む */
export function applyAppearance() {
  const root = document.documentElement.style
  root.setProperty('--surface-alpha', String(APPEARANCE.surfaceAlpha))
  root.setProperty('--color-accent-contrast', accentContrast(APPEARANCE.accent))
}

/** アクセント色の上に置く文字色を明度から決める */
function accentContrast(hex) {
  const [r, g, b] = hexToRgb(hex)
  // ITU-R BT.709 の相対輝度
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  return luminance > 0.5 ? '#0a0a0c' : '#ffffff'
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
