import { join } from 'node:path'
import { BrowserWindow, shell } from 'electron'

/**
 * ウィンドウの生成と、メイン / ミニの切り替えを受け持つ。
 *
 * 音を鳴らしているのは常にメインウィンドウの <audio> ひとつだけ。
 * ミニプレイヤーに切り替えるときもメインウィンドウは hide() するだけで破棄しないので、
 * 再生が途切れない。ミニ側は IPC 経由で状態を受け取り、操作を送り返すリモコンに徹する。
 */

const PRELOAD = () => join(__dirname, '../preload/index.js')

/** hide() 中もタイマーを間引かせない（シークバーの更新が飛ぶため） */
const SHARED_WEB_PREFERENCES = () => ({
  preload: PRELOAD(),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  backgroundThrottling: false
})

/** @type {BrowserWindow|null} */
let mainWindow = null
/** @type {BrowserWindow|null} */
let miniWindow = null

export function getMainWindow() {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
}

export function getMiniWindow() {
  return miniWindow && !miniWindow.isDestroyed() ? miniWindow : null
}

export function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 960,
    minHeight: 660,
    show: false,
    // 本文の下からデスクトップが透けるよう、メインもアクリル素材にする
    backgroundMaterial: 'acrylic',
    backgroundColor: '#00000000',
    // タイトルバーは自前の面に溶け込ませる（操作ボタンだけ OS が上に描く）
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#00000000',
      symbolColor: '#0a0a0a',
      height: 48
    },
    autoHideMenuBar: true,
    webPreferences: SHARED_WEB_PREFERENCES()
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())
  mainWindow.on('closed', () => {
    mainWindow = null
    getMiniWindow()?.destroy()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  loadRenderer(mainWindow, 'index.html')
  return mainWindow
}

/** ミニプレイヤーを出してメインを隠す */
export function openMiniPlayer() {
  const main = getMainWindow()
  if (!main) return

  const mini = getMiniWindow() ?? createMiniWindow()
  if (mini.isMinimized()) mini.restore()
  mini.show()
  mini.setAlwaysOnTop(true, 'floating')
  main.hide()
}

/** ミニプレイヤーを畳んでメインに戻す */
export function closeMiniPlayer() {
  const mini = getMiniWindow()
  if (mini) {
    // 最小化されたまま hide すると次に出したときも畳まれたままになる
    if (mini.isMinimized()) mini.restore()
    mini.hide()
  }

  const main = getMainWindow()
  if (!main) return
  main.show()
  main.focus()
}

function createMiniWindow() {
  miniWindow = new BrowserWindow({
    width: 320,
    height: 320,
    minWidth: 200,
    minHeight: 180,
    show: false,
    frame: false,
    // 自由にリサイズできる。ジャケットで埋まらない余白はレンダラー側が
    // ジャケットの主要色で塗る（mini.js の dominant color 抽出を参照）
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: false,
    alwaysOnTop: true,
    // Windows 11 のアクリル。背景を透明にしておくと、デスクトップ側がぼけて透ける
    backgroundMaterial: 'acrylic',
    backgroundColor: '#00000000',
    webPreferences: SHARED_WEB_PREFERENCES()
  })

  miniWindow.setAlwaysOnTop(true, 'floating')

  // タスクバーから最小化された場合もメインに戻す
  miniWindow.on('minimize', () => closeMiniPlayer())

  miniWindow.on('closed', () => {
    miniWindow = null
  })

  loadRenderer(miniWindow, 'mini.html')
  return miniWindow
}

/** dev では Vite の dev サーバー、本番ではビルド済み HTML を読む */
function loadRenderer(window, page) {
  if (process.env.ELECTRON_RENDERER_URL) {
    window.loadURL(`${process.env.ELECTRON_RENDERER_URL}/${page}`)
  } else {
    window.loadFile(join(__dirname, `../renderer/${page}`))
  }
}
