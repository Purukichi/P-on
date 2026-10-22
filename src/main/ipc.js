import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron'
import { AUDIO_EXTENSIONS, IMAGE_EXTENSIONS, IPC } from '../shared/ipc-channels.js'
import * as library from './library-service.js'
import { ensureDirectories, libraryRoot } from './library-store.js'
import {
  closeMiniPlayer,
  getMainWindow,
  getMiniWindow,
  openMiniPlayer,
  setMiniAlwaysOnTop
} from './windows.js'
import { appInfo, checkForUpdatesManually } from './updater.js'
import { takeOpenedFiles } from './opened-files.js'

export function registerIpcHandlers() {
  const handle = (channel, fn) => ipcMain.handle(channel, fn)
  const windowOf = (event) => BrowserWindow.fromWebContents(event.sender)

  registerPlayerRelay()

  // ---- ライブラリ --------------------------------------------------------

  handle(IPC.LIBRARY_SNAPSHOT, () => library.snapshot())

  handle(IPC.LIBRARY_IMPORT, (_event, filePaths) => library.importFiles(asArray(filePaths)))

  // エクスプローラーから開かれたファイル。前に開いたことのあるものは取り込み直さない
  handle(IPC.APP_OPEN_PENDING_FILES, () => library.openFiles(takeOpenedFiles()))

  handle(IPC.LIBRARY_PICK_FILES, async (event) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(windowOf(event), {
      title: 'Import music',
      buttonLabel: 'Import',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Audio', extensions: AUDIO_EXTENSIONS },
        { name: 'All files', extensions: ['*'] }
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
    const imagePath = await askForImage(event, 'Choose artwork for this track')
    if (!imagePath) return library.snapshot()
    return library.setCover(trackId, imagePath)
  })

  handle(IPC.LIBRARY_SET_ALBUM_COVER, (_event, albumName, imagePath) =>
    library.setAlbumCover(albumName, imagePath ?? null)
  )

  handle(IPC.LIBRARY_SET_ALBUM_ARTIST, (_event, albumName, artist) =>
    library.setAlbumArtist(albumName, artist ?? null)
  )

  handle(IPC.LIBRARY_RENAME_ALBUM, (_event, oldName, newName) =>
    library.renameAlbum(oldName, newName)
  )

  handle(IPC.LIBRARY_SET_ALBUM, (_event, trackIds, albumName) =>
    library.setAlbumForTracks(asArray(trackIds), albumName ?? null)
  )

  handle(IPC.LIBRARY_SET_ARTIST, (_event, trackIds, artist) =>
    library.setArtistForTracks(asArray(trackIds), artist ?? null)
  )

  handle(IPC.LIBRARY_REORDER_TRACKS, (_event, trackIds) =>
    library.reorderTracks(asArray(trackIds))
  )

  handle(IPC.LIBRARY_PICK_ALBUM_COVER, async (event, albumName) => {
    const imagePath = await askForImage(event, `Choose artwork for “${albumName}”`)
    if (!imagePath) return library.snapshot()
    return library.setAlbumCover(albumName, imagePath)
  })

  async function askForImage(event, title) {
    const { canceled, filePaths } = await dialog.showOpenDialog(windowOf(event), {
      title,
      buttonLabel: 'Set',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: IMAGE_EXTENSIONS }]
    })
    return canceled ? null : filePaths[0]
  }

  handle(IPC.LIBRARY_REPLACE_AUDIO, async (_event, trackId, filePath) => ({
    snapshot: await library.replaceAudio(trackId, filePath),
    replaced: true
  }))

  handle(IPC.LIBRARY_PICK_AUDIO, async (event, trackId) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(windowOf(event), {
      title: 'Choose replacement audio',
      buttonLabel: 'Replace',
      properties: ['openFile'],
      filters: [
        { name: 'Audio', extensions: AUDIO_EXTENSIONS },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    if (canceled) return { snapshot: await library.snapshot(), replaced: false }
    return { snapshot: await library.replaceAudio(trackId, filePaths[0]), replaced: true }
  })

  handle(IPC.LIBRARY_DELETE_TRACK, (_event, trackId) => library.deleteTrack(trackId))

  handle(IPC.LIBRARY_BACKFILL_FORMATS, () => library.backfillFormats())

  handle(IPC.LIBRARY_OPEN_FOLDER, async () => {
    await ensureDirectories()
    await shell.openPath(libraryRoot())
  })

  // ---- 保存先の変更 ------------------------------------------------------

  /*
   * フォルダ選択と「データをどうするか」の確認は、まとめてここで済ませる。
   * レンダラーは結果だけ受け取って、実行前に再生を止められる。
   */
  handle(IPC.LIBRARY_CHOOSE_LOCATION, async (event) => {
    const parent = windowOf(event)
    const currentRoot = library.libraryLocation()

    const { canceled, filePaths } = await dialog.showOpenDialog(parent, {
      title: 'Choose library location',
      buttonLabel: 'Use this folder',
      defaultPath: currentRoot,
      properties: ['openDirectory', 'createDirectory']
    })
    if (canceled || !filePaths[0]) return null

    const target = filePaths[0]
    const check = library.inspectLocation(target)

    if (!check.ok) {
      await dialog.showMessageBox(parent, {
        type: 'error',
        message: check.reason,
        detail: target,
        buttons: ['OK']
      })
      return null
    }

    // すでにライブラリがあるフォルダは、上書きせず「そのまま使う」だけにする
    if (check.hasLibrary) {
      const { response } = await dialog.showMessageBox(parent, {
        type: 'question',
        message: 'This folder already contains a PMP1 library',
        detail: `${target}\n\nSwitch to this library?\nYour current library stays where it is.`,
        buttons: ['Use this library', 'Cancel'],
        defaultId: 0,
        cancelId: 1
      })
      return response === 0 ? { path: target, mode: 'none' } : null
    }

    const { response } = await dialog.showMessageBox(parent, {
      type: 'question',
      message: 'What should happen to your current library?',
      detail: `From: ${currentRoot}\nTo: ${target}\n\nMove and Copy both finish copying before switching, so your data is safe even if something fails.`,
      buttons: [
        'Move (delete from the old folder)',
        'Copy (keep the old folder)',
        'Don’t move (only change the location)',
        'Cancel'
      ],
      defaultId: 0,
      cancelId: 3
    })

    const modes = ['move', 'copy', 'none']
    return response < modes.length ? { path: target, mode: modes[response] } : null
  })

  handle(IPC.LIBRARY_APPLY_LOCATION, (_event, path, mode) =>
    library.changeLibraryLocation(path, mode)
  )

  // ---- プレイリスト ------------------------------------------------------

  handle(IPC.PLAYLIST_CREATE, (_event, name) => library.createPlaylist(name))
  handle(IPC.PLAYLIST_RENAME, (_event, id, name) => library.renamePlaylist(id, name))
  handle(IPC.PLAYLIST_DELETE, (_event, id) => library.deletePlaylist(id))
  handle(IPC.PLAYLIST_ADD_TRACKS, (_event, id, trackIds) =>
    library.addToPlaylist(id, asArray(trackIds))
  )
  handle(IPC.PLAYLIST_REMOVE_TRACK, (_event, id, trackId) => library.removeFromPlaylist(id, trackId))
  handle(IPC.PLAYLIST_REORDER, (_event, id, trackIds) =>
    library.reorderPlaylist(id, asArray(trackIds))
  )

  handle(IPC.PLAYLIST_SET_COVER, (_event, id, imagePath) =>
    library.setPlaylistCover(id, imagePath ?? null)
  )

  handle(IPC.PLAYLIST_PICK_COVER, async (event, id, name) => {
    const imagePath = await askForImage(event, `Choose artwork for “${name}”`)
    if (!imagePath) return library.snapshot()
    return library.setPlaylistCover(id, imagePath)
  })

  // ---- バージョン情報 ----------------------------------------------------

  handle(IPC.APP_INFO, () => appInfo())
  handle(IPC.APP_CHECK_UPDATE, () => checkForUpdatesManually())

  // ---- 共通 --------------------------------------------------------------

  // 削除のような取り消せない操作の前に、OS 標準のダイアログで確認を取る
  handle(IPC.CONFIRM, async (event, { message, detail, confirmLabel = 'OK' } = {}) => {
    const { response } = await dialog.showMessageBox(windowOf(event), {
      type: 'warning',
      buttons: [confirmLabel, 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: message ?? 'Continue?',
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
  ipcMain.on(IPC.WINDOW_QUIT, () => app.quit())
  ipcMain.on(IPC.WINDOW_MINI_ON_TOP, (_event, onTop) => setMiniAlwaysOnTop(onTop))

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
