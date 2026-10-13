import { CollectionType } from '../core/Collections.js'

/**
 * 種類（プレイリスト / アルバム / シングル）の印。棚のカードの隅と、棚の絞り込みボタンで使う。
 *
 *   プレイリスト … 3 本の行と、再生の三角
 *   アルバム     … 正方形のジャケットに収まった盤
 *   シングル     … 盤 1 枚
 *
 * 細い線だけで描く。塗りつぶしの印はジャケットの絵と重なると潰れて見分けにくかったため。
 * 12〜14px に縮めても線が残るよう、viewBox 24 に対して 1.7 の太さにしている。
 */
const SHAPES = {
  [CollectionType.PLAYLIST]: [
    ['path', { d: 'M4 6.5h12M4 11.5h12M4 16.5h7' }],
    ['path', { d: 'M15 14.5v6l5-3z', 'stroke-linejoin': 'round' }]
  ],
  [CollectionType.ALBUM]: [
    ['rect', { x: 3.5, y: 3.5, width: 17, height: 17, rx: 2 }],
    ['circle', { cx: 12, cy: 12, r: 5 }],
    ['circle', { cx: 12, cy: 12, r: 1.2 }]
  ],
  [CollectionType.SINGLE]: [
    ['circle', { cx: 12, cy: 12, r: 8 }],
    ['circle', { cx: 12, cy: 12, r: 2 }]
  ]
}

/**
 * @param {string} type CollectionType のどれか
 * @param {{className?: string}} [options]
 */
export function typeIcon(type, { className } = {}) {
  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '1.7')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('aria-hidden', 'true')
  if (className) svg.setAttribute('class', className)

  for (const [tag, attrs] of SHAPES[type] ?? SHAPES[CollectionType.SINGLE]) {
    const node = document.createElementNS(ns, tag)
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value))
    svg.append(node)
  }
  return svg
}
