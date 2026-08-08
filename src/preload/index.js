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

contextBridge.exposeInMainWorld('hamon', api)
