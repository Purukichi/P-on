import { Emitter } from './Emitter.js'

/** ループの種類 */
export const RepeatMode = {
  /** ループしない。最後まで来たら止まる */
  OFF: 'off',
  /** キュー全体を繰り返す。最後の次は先頭に戻る */
  ALL: 'all',
  /** いまの 1 曲だけを繰り返す */
  ONE: 'one'
}

/**
 * 再生キュー。「次に何を鳴らすか」だけを管理し、再生そのものには関与しない。
 *
 * - リストから曲を選ぶ  -> replace() でその一覧に差し替え
 * - ウィンドウにドロップ -> enqueue() で末尾に追加
 *
 * ループもここが持つ。アルバム / プレイリスト / 手で組んだキューは
 * どれも「並んだ Track の列」でしかないので、区別せず同じ規則で回せる。
 *
 * events: 'change' ({tracks, index}), 'repeat-change' (RepeatMode), 'shuffle-change' (boolean)
 */
export class PlayQueue extends Emitter {
  /** @type {import('./Track.js').Track[]} */
  #tracks = []
  #index = -1
  /** @type {'off'|'all'|'one'} */
  #repeat = RepeatMode.OFF
  #shuffle = false
  /**
   * シャッフル中の巡り順（track id）。
   * 並びそのものは動かさないので、画面に出ている一覧は元の順のまま。
   * @type {string[]}
   */
  #order = []

  get tracks() {
    return this.#tracks
  }

  get index() {
    return this.#index
  }

  get current() {
    return this.#tracks[this.#index] ?? null
  }

  get repeat() {
    return this.#repeat
  }

  set repeat(mode) {
    const next = Object.values(RepeatMode).includes(mode) ? mode : RepeatMode.OFF
    if (next === this.#repeat) return
    this.#repeat = next
    this.emit('repeat-change', next)
  }

  /** 押すたびに しない -> 全曲 -> 1曲 と一周する */
  cycleRepeat() {
    const order = [RepeatMode.OFF, RepeatMode.ALL, RepeatMode.ONE]
    this.repeat = order[(order.indexOf(this.#repeat) + 1) % order.length]
    return this.#repeat
  }

  get shuffle() {
    return this.#shuffle
  }

  set shuffle(on) {
    const next = Boolean(on)
    if (next === this.#shuffle) return
    this.#shuffle = next
    if (next) this.#reshuffle()
    else this.#order = []
    this.emit('shuffle-change', next)
  }

  /** @returns {boolean} 切り替えたあとの状態 */
  toggleShuffle() {
    this.shuffle = !this.#shuffle
    return this.#shuffle
  }

  /*
   * 全曲ループ中は端でも行き止まりにならないので、前後のボタンは常に押せる。
   * 1曲ループは「次へ」を押したときまで縛らない（自動送りだけを止める）。
   */
  get hasNext() {
    if (this.#index < 0) return false
    if (this.#repeat === RepeatMode.ALL) return this.#tracks.length > 0
    return this.#positionInOrder() < this.#tracks.length - 1
  }

  get hasPrevious() {
    if (this.#index < 0) return false
    if (this.#repeat === RepeatMode.ALL) return this.#tracks.length > 0
    return this.#positionInOrder() > 0
  }

  /** キューを丸ごと差し替える */
  replace(tracks, startIndex = 0) {
    this.#tracks = [...tracks]
    this.#index = this.#tracks.length === 0 ? -1 : clampIndex(startIndex, this.#tracks.length)
    this.#reshuffle()
    this.#emit()
    return this.current
  }

  /** 末尾に追加する。何も再生していなければ最初の追加曲を指す */
  enqueue(tracks) {
    if (tracks.length === 0) return null
    const wasEmpty = this.#index < 0
    const firstAddedIndex = this.#tracks.length
    this.#tracks = [...this.#tracks, ...tracks]
    if (wasEmpty) this.#index = firstAddedIndex
    // 足したぶんも巡り順に混ぜる（鳴らしている曲は先頭に残るので再生は途切れない）
    this.#reshuffle()
    this.#emit()
    return wasEmpty ? this.current : null
  }

  /**
   * 次の曲へ。全曲ループ中は最後の次で先頭へ戻る。
   * 1 曲しか入っていないキューでは同じ曲を返すので、頭から鳴らし直しになる。
   */
  next() {
    if (!this.hasNext) return null
    this.#index = this.#step(1)
    this.#emit()
    return this.current
  }

  previous() {
    if (!this.hasPrevious) return null
    this.#index = this.#step(-1)
    this.#emit()
    return this.current
  }

  /** id を指定してキュー内の曲へ移動する */
  jumpTo(trackId) {
    const index = this.#tracks.findIndex((track) => track.id === trackId)
    if (index < 0) return null
    this.#index = index
    this.#emit()
    return this.current
  }

  /**
   * 渡された順に並べ替える。
   * 鳴らしている曲は並べ替えた後も指したままにするので、再生は途切れない。
   *
   * @param {string[]} orderedTrackIds いま入っている曲を、並べたい順に並べたもの
   */
  reorder(orderedTrackIds) {
    const byId = new Map(this.#tracks.map((track) => [track.id, track]))
    const next = orderedTrackIds.map((id) => byId.get(id)).filter(Boolean)
    // 数が合わないときは触らない（削除と行き違ったとき）
    if (next.length !== this.#tracks.length) return false

    const currentId = this.current?.id
    this.#tracks = next
    if (currentId) this.#index = next.findIndex((track) => track.id === currentId)

    this.#emit()
    return true
  }

  /** 消された曲をキューから取り除く。現在再生中の曲が消えたら次の曲へ寄せる */
  remove(trackId) {
    const index = this.#tracks.findIndex((track) => track.id === trackId)
    if (index < 0) return false

    this.#tracks = this.#tracks.filter((track) => track.id !== trackId)

    if (this.#tracks.length === 0) this.#index = -1
    else if (index < this.#index) this.#index -= 1
    else if (index === this.#index) this.#index = Math.min(this.#index, this.#tracks.length - 1)

    this.#emit()
    return true
  }

  /**
   * ライブラリ更新後に、キュー内の Track を新しい実体へ貼り替える。
   * 消えた曲は落とすが、キューそのものは畳まない。
   * 鳴らしていた曲が消えていたら、その**次**に残っている曲を指し直す
   * （アルバムを聴いている途中で 1 曲消しても、続きから鳴らせるように）。
   */
  refresh(resolveTrack) {
    let changed = false
    const next = []
    /** 残った曲が、消える前の並びで何番目にいたか */
    const survivedFrom = []

    this.#tracks.forEach((track, index) => {
      const resolved = resolveTrack(track.id)
      if (resolved) {
        next.push(resolved)
        survivedFrom.push(index)
      } else {
        changed = true
      }
    })
    if (!changed && next.every((track, i) => track === this.#tracks[i])) return

    const previousIndex = this.#index
    this.#tracks = next

    if (next.length === 0) {
      this.#index = -1
    } else {
      /*
       * 元の位置以降で最初に残っているもの。
       * 鳴らしていた曲が残っていればそれ自身が見つかり、
       * 消えていれば次の曲になる。末尾を消したときだけ後ろが無いので最後の曲へ。
       */
      const at = survivedFrom.findIndex((from) => from >= previousIndex)
      this.#index = at >= 0 ? at : next.length - 1
    }

    this.#emit()
  }

  clear() {
    this.#tracks = []
    this.#index = -1
    this.#emit()
  }

  // ---- 巡る順番 --------------------------------------------------------------

  /**
   * 「次はどれか」を決める順番。キュー内の位置（index）を並べたもの。
   * ふだんは並んでいるとおり。シャッフル中は #order の順にたどる。
   */
  #playOrder() {
    if (!this.#shuffle) return this.#tracks.map((_, index) => index)

    const positions = new Map(this.#tracks.map((track, index) => [track.id, index]))
    const order = []
    for (const id of this.#order) {
      const index = positions.get(id)
      if (index === undefined) continue
      positions.delete(id)
      order.push(index)
    }
    // 巡り順に載っていないもの（あとから足された曲）は、並びのまま後ろに付ける
    for (const index of positions.values()) order.push(index)
    return order
  }

  /** いま鳴らしている曲が、巡り順の何番目にいるか */
  #positionInOrder() {
    return this.#playOrder().indexOf(this.#index)
  }

  /** 巡り順で 1 つ進む / 戻る。端は反対側へ回す */
  #step(direction) {
    const order = this.#playOrder()
    const position = order.indexOf(this.#index)
    if (position < 0) return this.#index
    const next = (position + direction + order.length) % order.length
    return order[next]
  }

  /**
   * 巡り順を組み直す。
   * 鳴らしている曲は先頭に置くので、シャッフルを入れても曲が飛ばない。
   */
  #reshuffle() {
    if (!this.#shuffle) {
      this.#order = []
      return
    }

    const currentId = this.current?.id ?? null
    const rest = this.#tracks.map((track) => track.id).filter((id) => id !== currentId)
    for (let i = rest.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[rest[i], rest[j]] = [rest[j], rest[i]]
    }
    this.#order = currentId ? [currentId, ...rest] : rest
  }

  #emit() {
    this.emit('change', { tracks: this.#tracks, index: this.#index })
  }
}

function clampIndex(value, length) {
  return Math.min(Math.max(value, 0), length - 1)
}
