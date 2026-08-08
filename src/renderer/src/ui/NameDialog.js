import { collect } from './dom.js'

/**
 * 名前をひとつだけ入力させるダイアログ。プレイリストの作成と改名で使い回す。
 * Electron では window.prompt() が使えないため、自前で用意している。
 */
export class NameDialog {
  #root
  #el
  /** @type {((value: string|null) => void)|null} */
  #resolve = null

  constructor(root) {
    this.#root = root
  }

  mount() {
    this.#el = collect(this.#root, [
      'name-dialog',
      'name-form',
      'name-heading',
      'name-input',
      'name-cancel'
    ])

    this.#el.nameForm.addEventListener('submit', (event) => {
      event.preventDefault()
      this.#finish(this.#el.nameInput.value.trim() || null)
    })
    this.#el.nameCancel.addEventListener('click', () => this.#finish(null))
    // Esc で閉じられたときも Promise を解決しておく
    this.#el.nameDialog.addEventListener('close', () => this.#finish(null))

    return this
  }

  /** @returns {Promise<string|null>} キャンセルなら null */
  ask({ heading, value = '', confirmLabel = '決定' }) {
    this.#el.nameHeading.textContent = heading
    this.#el.nameInput.value = value
    this.#el.nameForm.querySelector('[data-el="name-submit"]').textContent = confirmLabel

    return new Promise((resolve) => {
      this.#resolve = resolve
      this.#el.nameDialog.showModal()
      this.#el.nameInput.focus()
      this.#el.nameInput.select()
    })
  }

  #finish(value) {
    const resolve = this.#resolve
    this.#resolve = null
    if (this.#el.nameDialog.open) this.#el.nameDialog.close()
    resolve?.(value)
  }
}
