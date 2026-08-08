import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc-channels.js'

/**
 * レンダラーに公開する API。
 * ここを唯一の窓口にしておくと、後からタグ読み込みやプレイリスト永続化を
 * 足すときも `window.hamon.*` にメソッドを増やすだけで済む。
 *
 * @typedef {{path: string, fileName: string, extension: string, url: string}} AudioFileRef
 */
const api = {
  files: {
    /** ダイアログを開いて選ばれたファイルの参照を返す (キャンセル時は空配列) @returns {Promise<AudioFileRef[]>} */
    openAudioFile: () => ipcRenderer.invoke(IPC.OPEN_AUDIO_FILE),
    /** 既知の絶対パスから再生用の参照を作り直す @returns {Promise<AudioFileRef>} */
    resolveAudioFile: (filePath) => ipcRenderer.invoke(IPC.RESOLVE_AUDIO_FILE, filePath)
  }
}

contextBridge.exposeInMainWorld('hamon', api)
