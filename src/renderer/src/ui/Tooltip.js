import { closestFrom, create } from './dom.js'

/** 出るまでの間。すぐ出すと、通り過ぎただけでちらつく */
const OPEN_DELAY = 340
/** 相手との隙間 */
const GAP = 8
/** 画面の縁との余白 */
const EDGE = 8

/**
 * 説明の吹き出し。
 *
 * OS 標準の title 属性は、色も形もアプリと無関係な四角で出てしまう。
 * 見た目を揃えるため、title のかわりに data-tip を読んで自前で出す。
 * （読み上げ用の名前は aria-label が持っているので、title は外してよい）
 *
 * 面は右クリックメニューと同じ曇りガラス（theme.css の --glass-bg）。
 */
export class Tooltip {
  #root
  #el
  #timer = null
  /** @type {Element|null} いま出している（出そうとしている）相手 */
  #target = null

  constructor(root) {
    this.#root = root
  }

  mount() {
    this.#el = create('div', { className: 'tooltip', attrs: { role: 'tooltip' } })
    this.#el.hidden = true
    document.body.append(this.#el)

    this.#root.addEventListener('pointerover', (event) => {
      const target = closestFrom(event.target, '[data-tip]')
      if (!target || target === this.#target) return
      this.#schedule(target)
    })

    this.#root.addEventListener('pointerout', (event) => {
      if (!this.#target) return
      // 中の要素へ移っただけなら、出したままにする
      if (this.#target.contains(event.relatedTarget)) return
      this.#hide()
    })

    // キーボードでたどっているときは待たずに出す
    this.#root.addEventListener('focusin', (event) => {
      const target = closestFrom(event.target, '[data-tip]')
      if (target) this.#show(target)
    })
    this.#root.addEventListener('focusout', () => this.#hide())

    /*
     * 押したら引っ込める。
     * 押した先でメニューやダイアログが開くことが多く、
     * その上に説明が残っていると邪魔になる。
     */
    window.addEventListener('pointerdown', () => this.#hide(), true)
    window.addEventListener('wheel', () => this.#hide(), true)
    window.addEventListener('blur', () => this.#hide())

    return this
  }

  #schedule(target) {
    this.#hide()
    this.#target = target
    this.#timer = setTimeout(() => this.#show(target), OPEN_DELAY)
  }

  #show(target) {
    const text = target.dataset.tip
    if (!text || !target.isConnected) return

    clearTimeout(this.#timer)
    this.#timer = null
    this.#target = target

    this.#el.textContent = text
    this.#el.hidden = false

    // 相手の真下。はみ出すときは画面に収まる位置へ寄せ、下が狭ければ上に出す
    const anchor = target.getBoundingClientRect()
    const tip = this.#el.getBoundingClientRect()

    const left = clamp(
      anchor.left + anchor.width / 2 - tip.width / 2,
      EDGE,
      window.innerWidth - tip.width - EDGE
    )
    const below = anchor.bottom + GAP
    const top = below + tip.height + EDGE > window.innerHeight ? anchor.top - GAP - tip.height : below

    this.#el.style.left = `${Math.max(EDGE, left)}px`
    this.#el.style.top = `${Math.max(EDGE, top)}px`
  }

  #hide() {
    clearTimeout(this.#timer)
    this.#timer = null
    this.#target = null
    if (this.#el) this.#el.hidden = true
  }
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), Math.max(min, max))
}
