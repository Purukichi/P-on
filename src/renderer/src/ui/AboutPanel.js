import { closestFrom, collect } from './dom.js'

/**
 * 左上のブランドマークを押すと出る、バージョンと更新の確認だけの小さなパネル。
 *
 * 更新の実処理は main 側の updater.js が持っている。
 * ここは押した結果を文言に置き換えて出すだけで、状態は持たない。
 */
export class AboutPanel {
  #root
  #el
  /** 二重に確認を投げないための鍵 */
  #checking = false

  constructor(root, { api = window.hamon } = {}) {
    this.#root = root
    this.api = api
  }

  mount() {
    this.#el = collect(this.#root, ['about', 'about-open', 'about-version', 'about-status', 'about-check'])

    this.#el.aboutOpen.addEventListener('click', (event) => {
      event.stopPropagation()
      if (this.#el.about.hidden) this.open()
      else this.close()
    })

    this.#el.aboutCheck.addEventListener('click', () => this.#check())

    // 棚のメニューと同じ作法。外を押すか Esc で閉じる
    window.addEventListener('pointerdown', (event) => {
      if (this.#el.about.hidden) return
      if (closestFrom(event.target, '[data-el="about"]')) return
      if (closestFrom(event.target, '[data-el="about-open"]')) return
      this.close()
    })
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.close()
    })

    return this
  }

  async open() {
    const { about, aboutOpen, aboutVersion, aboutCheck } = this.#el

    // 先に出してから寸法を測る（hidden のままだと幅が取れない）
    about.hidden = false
    aboutOpen.setAttribute('aria-expanded', 'true')

    /*
     * マークの真下に、左端をそろえて出す。
     * 右にはみ出すなら左へ寄せるが、窓がパネルより狭いときに
     * 画面外へ飛ばないよう下限も押さえておく。
     */
    const anchor = aboutOpen.getBoundingClientRect()
    const box = about.getBoundingClientRect()
    const right = window.innerWidth - box.width - 8
    about.style.left = `${Math.max(8, Math.min(anchor.left, right))}px`
    about.style.top = `${anchor.bottom + 6}px`

    const info = await this.api.app.info()
    aboutVersion.textContent = info.version

    if (info.supported) {
      this.#setStatus('Check whether a new version is available.')
      aboutCheck.disabled = false
    } else {
      this.#setStatus(info.reason)
      aboutCheck.disabled = true
    }
  }

  close() {
    this.#el.about.hidden = true
    this.#el.aboutOpen.setAttribute('aria-expanded', 'false')
  }

  async #check() {
    if (this.#checking) return
    this.#checking = true
    this.#el.aboutCheck.disabled = true
    this.#setStatus('Checking…')

    try {
      const result = await this.api.app.checkUpdate()
      this.#renderResult(result)
    } finally {
      this.#checking = false
      this.#el.aboutCheck.disabled = false
    }
  }

  #renderResult({ status, version, message }) {
    switch (status) {
      case 'latest':
        this.#setStatus('You’re up to date.')
        break
      case 'available':
        // 見つかった時点で裏のダウンロードが始まっている
        this.#setStatus(`Version ${version} is available. Downloading…`, 'ready')
        break
      case 'downloaded':
        this.#setStatus(`Version ${version} is ready. Restart to apply it.`, 'ready')
        break
      case 'unsupported':
        this.#setStatus(message ?? 'Updates can’t be checked here.')
        break
      default:
        this.#setStatus(message ?? 'Couldn’t check for updates.', 'error')
    }
  }

  #setStatus(text, tone = 'info') {
    this.#el.aboutStatus.textContent = text
    this.#el.aboutStatus.dataset.tone = tone
  }
}
