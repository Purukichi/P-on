import { Emitter } from './Emitter.js'
import { Playlist } from './Playlist.js'
import { Track } from './Track.js'

/**
 * ライブラリの状態をレンダラー側に保持する層。
 *
 * main プロセスの変更系 API はどれも「操作後の最新スナップショット」を返すので、
 * ここでは返り値を丸ごと state に差し替えて 'change' を投げるだけでよい。
 * 差分を自前で当てないぶん、状態がズレる余地がない。
 *
 * events: 'change', 'error'
 */
export class Library extends Emitter {
  #api
  /** @type {Track[]} */
  #tracks = []
  /** @type {Playlist[]} */
  #playlists = []
  /** @type {Record<string, {coverFile: string, coverUrl: string}>} */
  #albumCovers = {}
  #libraryPath = ''

  constructor(api = window.hamon) {
    super()
    if (!api?.library) {
      throw new Error('window.hamon が見つかりません (preload が読み込まれていない可能性があります)')
    }
    this.#api = api
  }

  get tracks() {
    return this.#tracks
  }

  get playlists() {
    return this.#playlists
  }

  get libraryPath() {
    return this.#libraryPath
  }

  getTrack(trackId) {
    return this.#tracks.find((track) => track.id === trackId) ?? null
  }

  getPlaylist(playlistId) {
    return this.#playlists.find((playlist) => playlist.id === playlistId) ?? null
  }

  /** アルバムに設定された共通ジャケット（未設定なら null） */
  albumCoverUrl(albumName) {
    return this.#albumCovers[albumName]?.coverUrl ?? null
  }

  /** プレイリストの収録曲を、登録順どおりに Track へ解決する */
  tracksOfPlaylist(playlistId) {
    const playlist = this.getPlaylist(playlistId)
    if (!playlist) return []
    return playlist.trackIds.map((id) => this.getTrack(id)).filter(Boolean)
  }

  // ---- 読み込み ----------------------------------------------------------

  async load() {
    return this.#apply(await this.#api.library.snapshot())
  }

  /**
   * フォーマット情報を後から足したので、古いレコードにも埋めて回る。
   * 既存のデータは消さずに項目を足すだけ。
   */
  async backfillFormats() {
    try {
      const { snapshot, filled } = await this.#api.library.backfillFormats()
      if (filled > 0) this.#apply(snapshot)
      return filled
    } catch (error) {
      this.emit('error', error)
      return 0
    }
  }

  // ---- 変更 --------------------------------------------------------------

  /** ドロップされたファイルを取り込む @returns {Promise<{added: Track[], skipped: string[]}>} */
  async importFiles(filePaths) {
    return this.#runImport(() => this.#api.library.import(filePaths))
  }

  /** ダイアログから取り込む */
  async pickFiles() {
    return this.#runImport(() => this.#api.library.pickFiles())
  }

  async updateTrack(trackId, patch) {
    return this.#run(() => this.#api.library.updateTrack(trackId, patch))
  }

  async pickCover(trackId) {
    return this.#run(() => this.#api.library.pickCover(trackId))
  }

  async setCoverFromPath(trackId, imagePath) {
    return this.#run(() => this.#api.library.setCover(trackId, imagePath))
  }

  async clearCover(trackId) {
    return this.#run(() => this.#api.library.setCover(trackId, null))
  }

  async pickAlbumCover(albumName) {
    return this.#run(() => this.#api.library.pickAlbumCover(albumName))
  }

  async setAlbumCoverFromPath(albumName, imagePath) {
    return this.#run(() => this.#api.library.setAlbumCover(albumName, imagePath))
  }

  async clearAlbumCover(albumName) {
    return this.#run(() => this.#api.library.setAlbumCover(albumName, null))
  }

  async deleteTrack(trackId) {
    return this.#run(() => this.#api.library.deleteTrack(trackId))
  }

  async createPlaylist(name) {
    try {
      const { snapshot, playlistId } = await this.#api.playlists.create(name)
      this.#apply(snapshot)
      return playlistId
    } catch (error) {
      this.emit('error', error)
      return null
    }
  }

  async renamePlaylist(playlistId, name) {
    return this.#run(() => this.#api.playlists.rename(playlistId, name))
  }

  async deletePlaylist(playlistId) {
    return this.#run(() => this.#api.playlists.remove(playlistId))
  }

  async addToPlaylist(playlistId, trackIds) {
    return this.#run(() => this.#api.playlists.addTracks(playlistId, trackIds))
  }

  async removeFromPlaylist(playlistId, trackId) {
    return this.#run(() => this.#api.playlists.removeTrack(playlistId, trackId))
  }

  openFolder() {
    return this.#api.library.openFolder()
  }

  // ---- 内部 --------------------------------------------------------------

  async #run(operation) {
    try {
      this.#apply(await operation())
      return true
    } catch (error) {
      this.emit('error', error)
      return false
    }
  }

  async #runImport(operation) {
    try {
      const { snapshot, added, skipped } = await operation()
      this.#apply(snapshot)
      return { added: added.map((id) => this.getTrack(id)).filter(Boolean), skipped }
    } catch (error) {
      this.emit('error', error)
      return { added: [], skipped: [] }
    }
  }

  #apply(snapshot) {
    this.#libraryPath = snapshot.libraryPath ?? ''
    this.#tracks = snapshot.tracks.map((dto) => new Track(dto))
    this.#playlists = snapshot.playlists.map((dto) => new Playlist(dto))
    this.#albumCovers = snapshot.albumCovers ?? {}
    this.emit('change', this)
    return this
  }
}
