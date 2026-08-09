import { Emitter } from '../core/Emitter.js'
import { collect } from './dom.js'

/**
 * 設定タブ。
 * 透過度と色相のスライダーは外したので、いまは配色の切り替えと
 * ライブラリの保存先の確認だけを持つ。
 *
 * events: 'toggle-theme', 'open-folder'
 */
export class SettingsDialog extends Emitter {
  #root
  #el
  #theme

  /** @param {HTMLElement} root @param {{theme: import('../core/Theme.js').Theme}} deps */
  constructor(root, { theme }) {
    super()
    this.#root = root
    this.#theme = theme
  }

  mount() {
    this.#el = collect(this.#root, [
      'settings-dialog',
      'settings-theme',
      'settings-library-path',
      'settings-open-folder',
      'settings-close'
    ])

    this.#el.settingsTheme.addEventListener('click', () => this.emit('toggle-theme'))
    this.#el.settingsOpenFolder.addEventListener('click', () => this.emit('open-folder'))
    this.#el.settingsClose.addEventListener('click', () => this.close())

    this.#theme.on('change', () => this.renderTheme())
    this.renderTheme()
    return this
  }

  /** @param {{libraryPath: string}} context */
  open({ libraryPath }) {
    this.#el.settingsLibraryPath.textContent = libraryPath
    this.renderTheme()
    this.#el.settingsDialog.showModal()
  }

  close() {
    if (this.#el.settingsDialog.open) this.#el.settingsDialog.close()
  }

  renderTheme() {
    this.#el.settingsTheme.textContent = this.#theme.isNight
      ? 'ライトモードに戻す'
      : 'ナイトモードにする'
  }
}
