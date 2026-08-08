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
    setCover: (trackId, imagePath) => ipcRenderer.invoke(IPC.LIBRARY_SET_COVER, trackId, imagePath),
    pickCover: (trackId) => ipcRenderer.invoke(IPC.LIBRARY_PICK_COVER, trackId),
    deleteTrack: (trackId) => ipcRenderer.invoke(IPC.LIBRARY_DELETE_TRACK, trackId),
    openFolder: () => ipcRenderer.invoke(IPC.LIBRARY_OPEN_FOLDER)
  },

  playlists: {
    create: (name) => ipcRenderer.invoke(IPC.PLAYLIST_CREATE, name),
    rename: (id, name) => ipcRenderer.invoke(IPC.PLAYLIST_RENAME, id, name),
    remove: (id) => ipcRenderer.invoke(IPC.PLAYLIST_DELETE, id),
    addTracks: (id, trackIds) => ipcRenderer.invoke(IPC.PLAYLIST_ADD_TRACKS, id, trackIds),
    removeTrack: (id, trackId) => ipcRenderer.invoke(IPC.PLAYLIST_REMOVE_TRACK, id, trackId)
  },

  /** OS 標準の確認ダイアログ @returns {Promise<boolean>} */
  confirm: (options) => ipcRenderer.invoke(IPC.CONFIRM, options),

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
