import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC } from '../shared/ipc-channels.js'

/**
 * レンダラーに公開する API。
 * ここを唯一の窓口にしておくと、機能を足すときも `window.hamon.*` を増やすだけで済む。
 *
 * 変更系はどれも「操作後の最新スナップショット」を返す。
 */
const api = {
  library: {
    /** @returns {Promise<{libraryPath: string, tracks: object[], playlists: object[]}>} */
    snapshot: () => ipcRenderer.invoke(IPC.LIBRARY_SNAPSHOT),
    /** ドロップされたファイルを取り込む @returns {Promise<{snapshot: object, added: string[], skipped: string[]}>} */
    import: (filePaths) => ipcRenderer.invoke(IPC.LIBRARY_IMPORT, filePaths),
    /** ダイアログから取り込む */
    pickFiles: () => ipcRenderer.invoke(IPC.LIBRARY_PICK_FILES),
    updateTrack: (trackId, patch) => ipcRenderer.invoke(IPC.LIBRARY_UPDATE_TRACK, trackId, patch),
    /** その曲だけのジャケット（シングル用） */
    setCover: (trackId, imagePath) => ipcRenderer.invoke(IPC.LIBRARY_SET_COVER, trackId, imagePath),
    pickCover: (trackId) => ipcRenderer.invoke(IPC.LIBRARY_PICK_COVER, trackId),
    /** アルバム共通のジャケット。曲ごとの設定とは独立している */
    setAlbumCover: (albumName, imagePath) =>
      ipcRenderer.invoke(IPC.LIBRARY_SET_ALBUM_COVER, albumName, imagePath),
    pickAlbumCover: (albumName) => ipcRenderer.invoke(IPC.LIBRARY_PICK_ALBUM_COVER, albumName),
    /** アルバムのアーティスト。収録曲の artist は書き換えない。null で未設定に戻す */
    setAlbumArtist: (albumName, artist) =>
      ipcRenderer.invoke(IPC.LIBRARY_SET_ALBUM_ARTIST, albumName, artist),
    /** アルバム名の変更。ジャケットとアルバムのアーティストも一緒に付け替える */
    renameAlbum: (oldName, newName) =>
      ipcRenderer.invoke(IPC.LIBRARY_RENAME_ALBUM, oldName, newName),
    /** 複数の曲にまとめてアルバム名を書き込む。null でシングルに戻す */
    setAlbum: (trackIds, albumName) => ipcRenderer.invoke(IPC.LIBRARY_SET_ALBUM, trackIds, albumName),
    /** 複数の曲にまとめて収録曲側のアーティストを書き込む。null で未設定に戻す */
    setArtist: (trackIds, artist) => ipcRenderer.invoke(IPC.LIBRARY_SET_ARTIST, trackIds, artist),
    deleteTrack: (trackId) => ipcRenderer.invoke(IPC.LIBRARY_DELETE_TRACK, trackId),
    openFolder: () => ipcRenderer.invoke(IPC.LIBRARY_OPEN_FOLDER),
    /**
     * 保存先のフォルダとデータの移し方をユーザーに選ばせる。
     * @returns {Promise<{path: string, mode: 'move'|'copy'|'none'}|null>} キャンセルなら null
     */
    chooseLocation: () => ipcRenderer.invoke(IPC.LIBRARY_CHOOSE_LOCATION),
    /** 選ばれた保存先へ実際に切り替える。移す場合は先に再生を止めておくこと */
    applyLocation: (path, mode) => ipcRenderer.invoke(IPC.LIBRARY_APPLY_LOCATION, path, mode),
    /** フォーマット表示を後から足したので、既存レコードにも埋めて回る */
    backfillFormats: () => ipcRenderer.invoke(IPC.LIBRARY_BACKFILL_FORMATS)
  },

  playlists: {
    create: (name) => ipcRenderer.invoke(IPC.PLAYLIST_CREATE, name),
    rename: (id, name) => ipcRenderer.invoke(IPC.PLAYLIST_RENAME, id, name),
    remove: (id) => ipcRenderer.invoke(IPC.PLAYLIST_DELETE, id),
    addTracks: (id, trackIds) => ipcRenderer.invoke(IPC.PLAYLIST_ADD_TRACKS, id, trackIds),
    removeTrack: (id, trackId) => ipcRenderer.invoke(IPC.PLAYLIST_REMOVE_TRACK, id, trackId),
    /** プレイリストのジャケット。null を渡すと外す */
    setCover: (id, imagePath) => ipcRenderer.invoke(IPC.PLAYLIST_SET_COVER, id, imagePath),
    pickCover: (id, name) => ipcRenderer.invoke(IPC.PLAYLIST_PICK_COVER, id, name)
  },

  /** OS 標準の確認ダイアログ @returns {Promise<boolean>} */
  confirm: (options) => ipcRenderer.invoke(IPC.CONFIRM, options),

  app: {
    /** @returns {Promise<{version: string, supported: boolean, reason: string}>} */
    info: () => ipcRenderer.invoke(IPC.APP_INFO),
    /** @returns {Promise<{status: string, version?: string, message?: string}>} */
    checkUpdate: () => ipcRenderer.invoke(IPC.APP_CHECK_UPDATE)
  },

  /**
   * メインウィンドウ（音を鳴らしている側）とミニプレイヤーの間の通信。
   * publish / on は送り手と受け手が逆になるだけで、両ウィンドウとも同じ API を使う。
   */
  player: {
    publishState: (state) => ipcRenderer.send(IPC.PLAYER_STATE, state),
    onState: (callback) => subscribe(IPC.PLAYER_STATE, callback),

    sendCommand: (command) => ipcRenderer.send(IPC.PLAYER_COMMAND, command),
    onCommand: (callback) => subscribe(IPC.PLAYER_COMMAND, callback),

    requestState: () => ipcRenderer.send(IPC.PLAYER_REQUEST_STATE),
    onStateRequested: (callback) => subscribe(IPC.PLAYER_REQUEST_STATE, callback)
  },

  windows: {
    /** ミニプレイヤーを出してメインを隠す */
    openMini: () => ipcRenderer.send(IPC.WINDOW_OPEN_MINI),
    /** ミニプレイヤーを畳んでメインに戻す */
    closeMini: () => ipcRenderer.send(IPC.WINDOW_CLOSE_MINI),
    /** アプリごと終了する */
    quit: () => ipcRenderer.send(IPC.WINDOW_QUIT),
    /** ミニプレイヤーの形（'portrait' | 'square' | 'landscape'） */
    setMiniShape: (shape) => ipcRenderer.send(IPC.WINDOW_MINI_SHAPE, shape),
    /** ミニプレイヤーを常に手前に出すか */
    setMiniAlwaysOnTop: (onTop) => ipcRenderer.send(IPC.WINDOW_MINI_ON_TOP, onTop),
    /** OS が描くタイトルバーの色を本文と揃える */
    setTitleBar: (colors) => ipcRenderer.send(IPC.WINDOW_SET_TITLEBAR, colors)
  },

  /**
   * ドロップされた File から実ファイルのパスを取り出す。
   * Electron 32 で File.path が廃止されたため、この API を経由する必要がある。
   */
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return ''
    }
  }
}

/**
 * IpcRendererEvent をレンダラーへ渡さないためのラッパ。
 * 戻り値を呼ぶと購読を解除できる。
 */
function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

contextBridge.exposeInMainWorld('hamon', api)
