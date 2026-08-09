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
  /** アクセント色の色相。151 は #00c853 相当の緑 */
  accentHue: 151
}

/** :root に CSS 変数として書き込む */
export function applyAppearance() {
  const root = document.documentElement.style
  root.setProperty('--surface-alpha', String(APPEARANCE.surfaceAlpha))
  root.setProperty('--accent-hue', String(APPEARANCE.accentHue))
  root.setProperty('--color-accent-contrast', accentContrast(APPEARANCE.accentHue))
}

/** アクセント色（hsl(H 100% 42%)）の上に置く文字色を明度から決める */
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
