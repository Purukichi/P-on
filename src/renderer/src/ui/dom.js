/**
 * JS が掴む目印は `data-el="..."` に統一している。
 * class は見た目専用なので、クラス名を自由に付け替えても JS は壊れない。
 */
export function pick(root, name) {
  const element = root.querySelector(`[data-el="${name}"]`)
  if (!element) throw new Error(`data-el="${name}" の要素が見つかりません`)
  return element
}

/** 名前の配列から {name: element} を作る */
export function collect(root, names) {
  return Object.fromEntries(names.map((name) => [camel(name), pick(root, name)]))
}

/** 要素を組み立てる小さなヘルパー。テキストは textContent で入れるので HTML 混入の心配がない */
export function create(tag, { className, text, attrs, children } = {}) {
  const element = document.createElement(tag)
  if (className) element.className = className
  if (text != null) element.textContent = text
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value == null || value === false) continue
    element.setAttribute(key, value === true ? '' : String(value))
  }
  for (const child of children ?? []) element.append(child)
  return element
}

/** 同じ形の SVG アイコンを使い回すための簡易ファクトリ */
export function icon(pathData, { className = 'icon', viewBox = '0 0 24 24' } = {}) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', viewBox)
  svg.setAttribute('fill', 'currentColor')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('class', className)
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', pathData)
  svg.append(path)
  return svg
}

/**
 * event.target から祖先を探す。
 * window / document レベルのリスナーでは target が Element とは限らないので、
 * closest() を直接呼ぶと落ちることがある。
 */
export function closestFrom(target, selector) {
  return target instanceof Element ? target.closest(selector) : null
}

/**
 * 長いテキストを「…」で切らず、収まらないときだけ自動で往復スクロールさせる。
 * 距離と時間は CSS 変数で渡し、アニメーション自体は CSS 側（.marquee）が持つ。
 */
export function setMarqueeText(element, text) {
  const inner = document.createElement('span')
  inner.className = 'marquee__inner'
  inner.textContent = text
  element.replaceChildren(inner)
  element.dataset.scrolling = 'false'

  // レイアウト確定後でないと scrollWidth が取れない
  requestAnimationFrame(() => {
    if (element.firstChild !== inner) return // 測る前に差し替えられた
    const distance = inner.scrollWidth - element.clientWidth
    if (distance <= 4) return
    element.style.setProperty('--marquee-distance', `${-distance}px`)
    // 距離に応じて時間を伸ばしつつ、長すぎるタイトルでも待たされない範囲に収める
    const seconds = Math.min(Math.max(distance / 90 + 3, 5), 18)
    element.style.setProperty('--marquee-duration', `${seconds.toFixed(1)}s`)
    element.dataset.scrolling = 'true'
  })
}

function camel(name) {
  return name.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
}
