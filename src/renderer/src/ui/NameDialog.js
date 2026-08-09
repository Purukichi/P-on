import { collect } from './dom.js'

/**
 * 名前をひとつだけ入力させるダイアログ。
 * プレイリストの作成 / 改名、アルバム名やアーティストの付け直しで使い回す。
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
      'name-note',
      'name-cancel'
    ])

    this.#el.nameForm.addEventListener('submit', (event) => {
      event.preventDefault()
      this.#finish(this.#el.nameInput.value.trim())
    })
    this.#el.nameCancel.addEventListener('click', () => this.#finish(null))
    // Esc で閉じられたときも Promise を解決しておく
    this.#el.nameDialog.addEventListener('close', () => this.#finish(null))

    return this
  }

  /**
   * @param {{heading: string, value?: string, confirmLabel?: string, note?: string}} options
   * @returns {Promise<string|null>} キャンセルなら null。空文字は「未設定にする」の意味で返る
   */
  ask({ heading, value = '', confirmLabel = '決定', note = '' }) {
    this.#el.nameHeading.textContent = heading
    this.#el.nameInput.value = value
    this.#el.nameNote.textContent = note
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
