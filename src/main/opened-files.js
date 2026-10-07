import { existsSync } from 'node:fs'
import { extname, resolve } from 'node:path'
import { AUDIO_EXTENSIONS, IPC } from '../shared/ipc-channels.js'
import { getMainWindow } from './windows.js'

/**
 * エクスプローラーの「プログラムから開く」やダブルクリックで渡された音声ファイル。
 *
 * Windows ではファイルのパスがコマンドライン引数で届く。
 * 起動時は process.argv に、すでに起動しているときは 2 つ目のプロセスの argv が
 * second-instance 経由で届く（2 つ目のプロセス自体はすぐ終わる）。
 * macOS では open-file イベントで届く。
 *
 * 届いた時点ではレンダラーがまだ読み込み中かもしれないので、ここに溜めておき、
 * 「届いた」とだけ知らせてレンダラー側から取りに来てもらう。
 * こうすれば起動直後でも取りこぼさない。
 */

/** @type {string[]} */
let pending = []

/** argv から音声ファイルのパスだけを拾う。workingDirectory は相対パスの基準 */
export function audioPathsFromArgv(argv, workingDirectory = process.cwd()) {
  return argv
    .slice(1) // 先頭は exe 自身
    .filter((arg) => !arg.startsWith('-'))
    .map((arg) => resolve(workingDirectory, arg))
    .filter(isOpenableAudio)
}

function isOpenableAudio(filePath) {
  const extension = extname(filePath).slice(1).toLowerCase()
  return AUDIO_EXTENSIONS.includes(extension) && existsSync(filePath)
}

/** 開くファイルを足して、レンダラーに知らせる */
export function queueOpenedFiles(filePaths) {
  const accepted = filePaths.filter(isOpenableAudio)
  if (accepted.length === 0) return
  pending.push(...accepted)
  getMainWindow()?.webContents.send(IPC.APP_FILES_OPENED)
}

/** 溜まっている分を渡して空にする */
export function takeOpenedFiles() {
  const taken = pending
  pending = []
  return taken
}
