import { BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron'
import { AUDIO_EXTENSIONS, IMAGE_EXTENSIONS, IPC } from '../shared/ipc-channels.js'
import * as library from './library-service.js'
import { ensureDirectories, libraryRoot } from './library-store.js'
import { closeMiniPlayer, getMainWindow, getMiniWindow, openMiniPlayer } from './windows.js'

export function registerIpcHandlers() {
  const handle = (channel, fn) => ipcMain.handle(channel, fn)
  const windowOf = (event) => BrowserWindow.fromWebContents(event.sender)

  registerPlayerRelay()

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
    const imagePath = await askForImage(event, 'この曲のジャケット画像を選択')
    if (!imagePath) return library.snapshot()
    return library.setCover(trackId, imagePath)
  })

  handle(IPC.LIBRARY_SET_ALBUM_COVER, (_event, albumName, imagePath) =>
    library.setAlbumCover(albumName, imagePath ?? null)
  )

  handle(IPC.LIBRARY_PICK_ALBUM_COVER, async (event, albumName) => {
    const imagePath = await askForImage(event, `「${albumName}」のジャケット画像を選択`)
    if (!imagePath) return library.snapshot()
    return library.setAlbumCover(albumName, imagePath)
  })

  async function askForImage(event, title) {
    const { canceled, filePaths } = await dialog.showOpenDialog(windowOf(event), {
      title,
      buttonLabel: '設定',
      properties: ['openFile'],
      filters: [{ name: '画像ファイル', extensions: IMAGE_EXTENSIONS }]
    })
    return canceled ? null : filePaths[0]
  }

  handle(IPC.LIBRARY_DELETE_TRACK, (_event, trackId) => library.deleteTrack(trackId))

  handle(IPC.LIBRARY_BACKFILL_FORMATS, () => library.backfillFormats())

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

/**
 * メインウィンドウ（音を鳴らしている側）とミニプレイヤーの中継。
 * main プロセスは再生状態を持たず、素通しするだけ。
 */
function registerPlayerRelay() {
  ipcMain.on(IPC.PLAYER_STATE, (_event, state) => {
    getMiniWindow()?.webContents.send(IPC.PLAYER_STATE, state)
  })

  ipcMain.on(IPC.PLAYER_COMMAND, (_event, command) => {
    getMainWindow()?.webContents.send(IPC.PLAYER_COMMAND, command)
  })

  // ミニ側が開いた直後に、今の状態をもう一度送ってもらう
  ipcMain.on(IPC.PLAYER_REQUEST_STATE, () => {
    getMainWindow()?.webContents.send(IPC.PLAYER_REQUEST_STATE)
  })

  ipcMain.on(IPC.WINDOW_OPEN_MINI, () => openMiniPlayer())
  ipcMain.on(IPC.WINDOW_CLOSE_MINI, () => closeMiniPlayer())

  ipcMain.on(IPC.WINDOW_SET_TITLEBAR, (_event, { color, symbolColor, theme } = {}) => {
    /*
     * Windows のアクリルは OS のダーク / ライト設定に従って濃さが変わる。
     * システムがダークのままだと明るいテーマでも背景が灰色に沈むので、
     * アプリのテーマに合わせてアクリル側の明暗も揃える。
     */
    if (theme === 'light' || theme === 'dark') nativeTheme.themeSource = theme

    const main = getMainWindow()
    if (!main || !color || !symbolColor) return
    try {
      main.setTitleBarOverlay({ color, symbolColor, height: 48 })
    } catch (error) {
      // titleBarOverlay に対応していないプラットフォームでは何もしない
      console.warn('[window] タイトルバーの色を変更できませんでした:', error.message)
    }
  })
}

function asArray(value) {
  if (Array.isArray(value)) return value
  return value == null ? [] : [value]
}
