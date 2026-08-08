import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { AUDIO_EXTENSIONS, IMAGE_EXTENSIONS, IPC } from '../shared/ipc-channels.js'
import * as library from './library-service.js'
import { ensureDirectories, libraryRoot } from './library-store.js'

export function registerIpcHandlers() {
  const handle = (channel, fn) => ipcMain.handle(channel, fn)
  const windowOf = (event) => BrowserWindow.fromWebContents(event.sender)

  // ---- ライブラリ --------------------------------------------------------

  handle(IPC.LIBRARY_SNAPSHOT, () => library.snapshot())

  handle(IPC.LIBRARY_IMPORT, (_event, filePaths) => library.importFiles(asArray(filePaths)))

  handle(IPC.LIBRARY_PICK_FILES, async (event) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(windowOf(event), {
      title: '音源を取り込む',
      buttonLabel: '取り込む',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '音声ファイル', extensions: AUDIO_EXTENSIONS },
        { name: 'すべてのファイル', extensions: ['*'] }
      ]
    })
    if (canceled) return { snapshot: await library.snapshot(), added: [], skipped: [] }
    return library.importFiles(filePaths)
  })

  handle(IPC.LIBRARY_UPDATE_TRACK, (_event, trackId, patch) =>
    library.updateTrack(trackId, patch ?? {})
  )

  handle(IPC.LIBRARY_SET_COVER, (_event, trackId, imagePath) =>
    library.setCover(trackId, imagePath ?? null)
  )

  handle(IPC.LIBRARY_PICK_COVER, async (event, trackId) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(windowOf(event), {
      title: 'ジャケット画像を選択',
      buttonLabel: '設定',
      properties: ['openFile'],
      filters: [{ name: '画像ファイル', extensions: IMAGE_EXTENSIONS }]
    })
    if (canceled) return library.snapshot()
    return library.setCover(trackId, filePaths[0])
  })

  handle(IPC.LIBRARY_DELETE_TRACK, (_event, trackId) => library.deleteTrack(trackId))

  handle(IPC.LIBRARY_OPEN_FOLDER, async () => {
    await ensureDirectories()
    await shell.openPath(libraryRoot())
  })

  // ---- プレイリスト ------------------------------------------------------

  handle(IPC.PLAYLIST_CREATE, (_event, name) => library.createPlaylist(name))
  handle(IPC.PLAYLIST_RENAME, (_event, id, name) => library.renamePlaylist(id, name))
  handle(IPC.PLAYLIST_DELETE, (_event, id) => library.deletePlaylist(id))
  handle(IPC.PLAYLIST_ADD_TRACKS, (_event, id, trackIds) =>
    library.addToPlaylist(id, asArray(trackIds))
  )
  handle(IPC.PLAYLIST_REMOVE_TRACK, (_event, id, trackId) => library.removeFromPlaylist(id, trackId))

  // ---- 共通 --------------------------------------------------------------

  // 削除のような取り消せない操作の前に、OS 標準のダイアログで確認を取る
  handle(IPC.CONFIRM, async (event, { message, detail, confirmLabel = 'OK' } = {}) => {
    const { response } = await dialog.showMessageBox(windowOf(event), {
      type: 'warning',
      buttons: [confirmLabel, 'キャンセル'],
      defaultId: 1,
      cancelId: 1,
      message: message ?? '実行しますか？',
      detail
    })
    return response === 0
  })
}

function asArray(value) {
  if (Array.isArray(value)) return value
  return value == null ? [] : [value]
}
