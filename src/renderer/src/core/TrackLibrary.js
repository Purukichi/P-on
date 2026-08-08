import { Emitter } from './Emitter.js'
import { Track } from './Track.js'

/**
 * 「どのファイルを読み込んだか」を持つ層。
 * ファイル選択ダイアログ・パス解決といった main プロセス依存の処理は
 * 全部ここに閉じ込めてあるので、UI は Track の配列だけを見ればよい。
 *
 * 今の MVP では 1 曲ずつしか追加しないが、内部は最初からコレクション。
 * プレイリスト機能はこのクラスの上に PlayQueue などを重ねれば足りる。
 *
 * events: 'change' (tracks が変わった), 'error'
 */
export class TrackLibrary extends Emitter {
  #files
  /** @type {Track[]} */
  #tracks = []

  /** @param {typeof window.hamon.files} fileGateway */
  constructor(fileGateway = window.hamon?.files) {
    super()
    if (!fileGateway) {
      throw new Error('window.hamon.files が見つかりません (preload が読み込まれていない可能性があります)')
    }
    this.#files = fileGateway
  }

  /** @returns {readonly Track[]} */
  get tracks() {
    return this.#tracks
  }

  getById(id) {
    return this.#tracks.find((track) => track.id === id) ?? null
  }

  /**
   * ダイアログを開いて選ばれたファイルをライブラリに追加する。
   * @returns {Promise<Track[]>} 追加された Track (キャンセル時は空配列)
   */
  async pickFiles() {
    let refs
    try {
      refs = await this.#files.openAudioFile()
    } catch (error) {
      this.emit('error', error)
      return []
    }

    const added = refs.map((ref) => Track.fromFileRef(ref))
    return this.#append(added)
  }

  /**
   * 保存済みのパスからライブラリを復元する (プレイリスト機能用の入口)。
   * @param {string[]} filePaths
   */
  async addByPaths(filePaths) {
    const added = []
    for (const filePath of filePaths) {
      try {
        added.push(Track.fromFileRef(await this.#files.resolveAudioFile(filePath)))
      } catch (error) {
        this.emit('error', error)
      }
    }
    return this.#append(added)
  }

  clear() {
    if (this.#tracks.length === 0) return
    this.#tracks = []
    this.emit('change', this.#tracks)
  }

  #append(tracks) {
    if (tracks.length === 0) return []
    this.#tracks = [...this.#tracks, ...tracks]
    this.emit('change', this.#tracks)
    return tracks
  }
}
