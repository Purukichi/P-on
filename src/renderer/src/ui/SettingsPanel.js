import { closestFrom, collect } from './dom.js'
import { getLanguage, onLanguageChange, setLanguage } from '../i18n.js'

/**
 * 上部バーの歯車を押すと出る設定のパネル。
 *   - 言語（English / 日本語）
 *   - ライブラリの保存フォルダを開く・保存先を移す
 *
 * フォルダまわりのボタン（data-el="open-folder" / "change-library"）の処理は main.js が持っていて、
 * ここは開け閉めと言語の切り替えだけを受け持つ。開け閉めの作法はバージョン情報のパネルと同じ。
 */
export class SettingsPanel {
  #root
  #el

  constructor(root) {
    this.#root = root
  }

  mount() {
    this.#el = collect(this.#root, ['settings', 'settings-open', 'lang-en', 'lang-ja'])

    this.#el.settingsOpen.addEventListener('click', (event) => {
      event.stopPropagation()
      if (this.#el.settings.hidden) this.open()
      else this.close()
    })

    for (const button of [this.#el.langEn, this.#el.langJa]) {
      button.addEventListener('click', () => setLanguage(button.dataset.lang))
    }
    onLanguageChange(() => this.#renderLanguage())
    this.#renderLanguage()

    window.addEventListener('pointerdown', (event) => {
      if (this.#el.settings.hidden) return
      if (closestFrom(event.target, '[data-el="settings"]')) return
      if (closestFrom(event.target, '[data-el="settings-open"]')) return
      this.close()
    })
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.close()
    })

    return this
  }

  open() {
    const { settings, settingsOpen } = this.#el
    settings.hidden = false
    settingsOpen.setAttribute('aria-expanded', 'true')

    // 歯車の真下に、右端をそろえて出す。窓の左端からはみ出さないよう下限を押さえる
    const anchor = settingsOpen.getBoundingClientRect()
    const box = settings.getBoundingClientRect()
    settings.style.left = `${Math.max(8, anchor.right - box.width)}px`
    settings.style.top = `${anchor.bottom + 6}px`
  }

  close() {
    this.#el.settings.hidden = true
    this.#el.settingsOpen.setAttribute('aria-expanded', 'false')
  }

  #renderLanguage() {
    const language = getLanguage()
    this.#el.langEn.dataset.active = String(language === 'en')
    this.#el.langJa.dataset.active = String(language === 'ja')
  }
}
