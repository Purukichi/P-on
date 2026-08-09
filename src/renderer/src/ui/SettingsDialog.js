import { collect } from './dom.js'

/**
 * 設定タブ。見た目の可変パラメータをその場で反映しながら調整する。
 * 値の保存と CSS 変数への反映は Settings クラスが持つので、ここは入出力だけ。
 */
export class SettingsDialog {
  #root
  #el
  #settings

  /** @param {HTMLElement} root @param {{settings: import('../core/Settings.js').Settings}} deps */
  constructor(root, { settings }) {
    this.#root = root
    this.#settings = settings
  }

  mount() {
    this.#el = collect(this.#root, [
      'settings-dialog',
      'settings-alpha',
      'settings-alpha-value',
      'settings-hue',
      'settings-hue-value',
      'settings-reset',
      'settings-close'
    ])

    // input で即座に反映する（スライダーを動かしながら結果が見える）
    this.#el.settingsAlpha.addEventListener('input', () => {
      this.#settings.set('surfaceAlpha', Number(this.#el.settingsAlpha.value))
    })
    this.#el.settingsHue.addEventListener('input', () => {
      this.#settings.set('accentHue', Number(this.#el.settingsHue.value))
    })

    this.#el.settingsReset.addEventListener('click', () => this.#settings.reset())
    this.#el.settingsClose.addEventListener('click', () => this.close())

    this.#settings.on('change', () => this.render())
    this.render()
    return this
  }

  open() {
    this.render()
    this.#el.settingsDialog.showModal()
  }

  close() {
    if (this.#el.settingsDialog.open) this.#el.settingsDialog.close()
  }

  render() {
    const { surfaceAlpha, accentHue } = this.#settings.values

    this.#el.settingsAlpha.value = String(surfaceAlpha)
    this.#el.settingsAlphaValue.textContent = `${Math.round(surfaceAlpha * 100)}%`
    this.#setFill(this.#el.settingsAlpha, surfaceAlpha, 0.25, 0.95)

    this.#el.settingsHue.value = String(accentHue)
    this.#el.settingsHueValue.textContent = String(Math.round(accentHue))
    this.#setFill(this.#el.settingsHue, accentHue, 0, 359)
  }

  #setFill(element, value, min, max) {
    element.style.setProperty('--fill', String((value - min) / (max - min)))
  }
}
