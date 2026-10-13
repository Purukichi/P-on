/**
 * 見た目の固定値。
 *
 * 以前はスライダーで透過度と色相を変えられるようにしていたが、
 * 実際に使ってみて調整の必要が無かったので固定に戻した。
 * 変えたいときはこの値か theme.css を直接編集する。
 *
 * アクセント色は固定せず、鳴っている曲のジャケットから拾う（ui/accent.js）。
 */
export const APPEARANCE = {
  /** 本体の面の不透明度。小さいほどデスクトップが透ける */
  surfaceAlpha: 0.25
}

/** :root に CSS 変数として書き込む */
export function applyAppearance() {
  document.documentElement.style.setProperty('--surface-alpha', String(APPEARANCE.surfaceAlpha))
}
