import { Emitter } from './Emitter.js'

const STORAGE_KEY = 'hamon.theme'

/**
 * ライト / ナイトモードの切り替え。
 * <html data-theme="light|night"> を書き換えるだけで、実際の配色は CSS 側が持つ。
 *
 * events: 'change' ('light' | 'night')
 */
export class Theme extends Emitter {
  #current = 'light'

  constructor() {
    super()
    const saved = localStorage.getItem(STORAGE_KEY)
    this.#current = saved === 'night' ? 'night' : 'light'
    this.#apply()
  }

  get current() {
    return this.#current
  }

  get isNight() {
    return this.#current === 'night'
  }

  set(theme) {
    const next = theme === 'night' ? 'night' : 'light'
    if (next === this.#current) return
    this.#current = next
    localStorage.setItem(STORAGE_KEY, next)
    this.#apply()
    this.emit('change', next)
  }

  toggle() {
    this.set(this.isNight ? 'light' : 'night')
  }

  #apply() {
    document.documentElement.dataset.theme = this.#current
  }
}
