/**
 * 依存を増やしたくないので最小限のイベントエミッタを自前で持つ。
 * on() は解除用の関数を返すので、UI 側での後片付けが楽になる。
 */
export class Emitter {
  #listeners = new Map()

  on(type, listener) {
    if (!this.#listeners.has(type)) this.#listeners.set(type, new Set())
    this.#listeners.get(type).add(listener)
    return () => this.off(type, listener)
  }

  off(type, listener) {
    this.#listeners.get(type)?.delete(listener)
  }

  emit(type, payload) {
    for (const listener of this.#listeners.get(type) ?? []) {
      try {
        listener(payload)
      } catch (error) {
        console.error(`[emitter] listener for "${type}" threw:`, error)
      }
    }
  }

  removeAllListeners() {
    this.#listeners.clear()
  }
}
