import { basename, extname, isAbsolute } from 'node:path'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import { AUDIO_EXTENSIONS, IPC } from '../shared/ipc-channels.js'
import { createMediaUrl } from './media-protocol.js'

export function registerIpcHandlers() {
  ipcMain.handle(IPC.OPEN_AUDIO_FILE, async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)

    const { canceled, filePaths } = await dialog.showOpenDialog(window, {
      title: '音声ファイルを選択',
      buttonLabel: '再生',
      // 複数選択やフォルダ読み込みに広げるときはここを増やす
      // (例: properties: ['openFile', 'multiSelections'])
      properties: ['openFile'],
      filters: [
        { name: '音声ファイル', extensions: ['mp3', 'wav', 'flac'] },
        { name: 'その他の音声', extensions: ['m4a', 'aac', 'ogg', 'opus', 'webm'] },
        { name: 'すべてのファイル', extensions: ['*'] }
      ]
    })

    if (canceled) return []
    return filePaths.map(toFileRef)
  })

  // 保存済みプレイリストの復元などで、パスから再生 URL を作り直すための入口
  ipcMain.handle(IPC.RESOLVE_AUDIO_FILE, (_event, filePath) => {
    if (typeof filePath !== 'string' || !isAbsolute(filePath)) {
      throw new Error('絶対パスを指定してください')
    }
    if (!AUDIO_EXTENSIONS.includes(extensionOf(filePath))) {
      throw new Error(`対応していない拡張子です: ${filePath}`)
    }
    return toFileRef(filePath)
  })
}

function toFileRef(filePath) {
  return {
    path: filePath,
    fileName: basename(filePath),
    extension: extensionOf(filePath),
    url: createMediaUrl(filePath)
  }
}

function extensionOf(filePath) {
  return extname(filePath).slice(1).toLowerCase()
}
