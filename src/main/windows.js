import { join } from 'node:path'
import { app, BrowserWindow, screen, shell } from 'electron'
import { IPC } from '../shared/ipc-channels.js'

/**
 * ウィンドウの生成と、メイン / ミニの切り替えを受け持つ。
 *
 * 音を鳴らしているのは常にメインウィンドウの <audio> ひとつだけ。
 * ミニプレイヤーに切り替えるときもメインウィンドウは hide() するだけで破棄しないので、
 * 再生が途切れない。ミニ側は IPC 経由で状態を受け取り、操作を送り返すリモコンに徹する。
 */

const PRELOAD = () => join(__dirname, '../preload/index.js')

/**
 * タスクバーとウィンドウ左上に出すアイコン。
 *
 * 指定しなければ exe に埋め込んだアイコンが使われるが、
 * それだとエクスプローラーのアイコンキャッシュに引きずられて古い絵が残ることがある。
 * 実行時に自分で渡せばキャッシュを経由しないので、更新した絵がそのまま出る。
 * 開発中（electron.exe で動かしているとき）に Electron の既定アイコンにならない利点もある。
 *
 * パッケージ後は resources/ に置かれる（electron-builder.yml の extraResources）。
 */
const ICON = () =>
  app.isPackaged
    ? join(process.resourcesPath, 'icon.ico')
    : join(app.getAppPath(), 'build/icon.ico')

/** hide() 中もタイマーを間引かせない（シークバーの更新が飛ぶため） */
const SHARED_WEB_PREFERENCES = () => ({
  preload: PRELOAD(),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  backgroundThrottling: false
})

/**
 * ミニプレイヤーの一辺（既定）。
 * 形は正方形のひとつだけで、ジャケットをそのまま窓いっぱいに見せる。
 */
const MINI_SIZE = 384

/** ミニをこれ以上小さくしない一辺 */
const MINI_MIN_SIZE = 240

/**
 * いまの一辺。
 * 手を離した時点で正方形へ戻すとき、「どちらの辺を動かしたのか」を
 * 直前の一辺と比べて見分けるために覚えておく。
 */
let miniSquareSide = MINI_SIZE

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
    icon: ICON(),
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
  keepBackdropAlive(mainWindow)
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
  watchMiniHover()
  /*
   * 最前面かどうかはここで決め打ちしない。
   * 生成時は true で始まり、以降はミニ側のピン留めボタンが持ち主になる。
   * ここで true に戻すと、切っておいた設定が開き直すたびに復活してしまう。
   */
  main.hide()
}

/** 常に手前に出すかどうか */
export function setMiniAlwaysOnTop(onTop) {
  getMiniWindow()?.setAlwaysOnTop(Boolean(onTop), 'floating')
}

/*
 * ミニプレイヤーにマウスが入っているかを見張る。
 *
 * ジャケットの面は -webkit-app-region: drag（掴んで窓を動かす領域）なので、
 * その上ではページ側に mouseover が届かない。CSS の :hover に任せると
 * 「操作面そのものに触れたときしか出てこない」ことになってしまう。
 * そこでカーソルの位置を main 側で見て、窓の矩形に入ったかどうかで知らせる。
 *
 * 動くのはミニを出しているあいだだけ。畳んだら止める。
 */
const HOVER_POLL_MS = 120

let hoverTimer = null
let hoverInside = false

function watchMiniHover() {
  stopMiniHoverWatch()
  hoverInside = false

  hoverTimer = setInterval(() => {
    const mini = getMiniWindow()
    if (!mini || !mini.isVisible()) {
      stopMiniHoverWatch()
      return
    }

    const point = screen.getCursorScreenPoint()
    const { x, y, width, height } = mini.getBounds()
    const inside = point.x >= x && point.x < x + width && point.y >= y && point.y < y + height

    if (inside === hoverInside) return
    hoverInside = inside
    mini.webContents.send(IPC.WINDOW_MINI_HOVER, inside)
  }, HOVER_POLL_MS)
}

function stopMiniHoverWatch() {
  if (!hoverTimer) return
  clearInterval(hoverTimer)
  hoverTimer = null

  // 出しっぱなしで畳むと、次に開いたときに出たままになる
  const mini = getMiniWindow()
  if (hoverInside && mini && !mini.isDestroyed()) {
    mini.webContents.send(IPC.WINDOW_MINI_HOVER, false)
  }
  hoverInside = false
}

/** ミニプレイヤーを畳んでメインに戻す */
export function closeMiniPlayer() {
  stopMiniHoverWatch()

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

/**
 * すでに起動しているウィンドウを前に出す。
 * 二重起動を弾いたとき（＝ユーザーはアイコンを押したのに何も起きない）に呼ぶ。
 * ミニプレイヤーに切り替えている最中はそちらを、そうでなければメインを出す。
 */
export function focusExistingWindow() {
  const mini = getMiniWindow()
  const target = mini?.isVisible() ? mini : getMainWindow()
  if (!target) return
  if (target.isMinimized()) target.restore()
  target.show()
  target.focus()
}

function createMiniWindow() {
  miniWindow = new BrowserWindow({
    // 正方形ひとつだけ。大きさは変えられるが、形は変えられない
    width: MINI_SIZE,
    height: MINI_SIZE,
    minWidth: MINI_MIN_SIZE,
    minHeight: MINI_MIN_SIZE,
    show: false,
    frame: false,
    // ミニもタスクバーに出る（skipTaskbar: false）ので、同じアイコンを渡しておく
    icon: ICON(),
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
  keepBackdropAlive(miniWindow)

  /*
   * ジャケットだけを見せる形なので、大きさを変えても正方形のまま。
   * 縦横が崩れると絵の外側に地の色の帯が出てしまい、狙いから外れる。
   */
  try {
    // OS 側の制約。効けばドラッグ中もずっと正方形のまま動く
    miniWindow.setAspectRatio(1)
  } catch (error) {
    // 効かない環境では下の 'resized' が手を離した時点に戻す
    console.error('[windows] 縦横比を固定できません:', error?.message ?? error)
  }

  /*
   * 正方形に戻す受け皿。
   *
   * ドラッグの最中には触らない。'will-resize' を preventDefault して寸法を
   * 入れ直すやり方は、Windows だとリサイズのループを毎フレーム打ち消すことになり、
   * 掴んだ辺がカーソルに付いてこなくなる。
   *
   * ふだんは setAspectRatio（OS 側の制約）が効いてドラッグ中も正方形のままなので、
   * ここは効かなかったときに手を離した時点で正方形へ戻すための保険。
   */
  miniWindow.on('resized', () => {
    if (miniWindow.isDestroyed()) return

    const { x, y, width, height } = miniWindow.getBounds()
    if (width === height) {
      miniSquareSide = width
      return
    }

    // 動かした辺のほうに合わせる（横を引っ張ったら横、縦なら縦）
    const movedHorizontally =
      Math.abs(width - miniSquareSide) >= Math.abs(height - miniSquareSide)
    const side = Math.max(MINI_MIN_SIZE, movedHorizontally ? width : height)

    miniSquareSide = side
    miniWindow.setBounds({ x, y, width: side, height: side })
  })

  // タスクバーから最小化された場合もメインに戻す
  miniWindow.on('minimize', () => closeMiniPlayer())

  miniWindow.on('closed', () => {
    stopMiniHoverWatch()
    miniWindow = null
  })

  loadRenderer(miniWindow, 'mini.html')
  return miniWindow
}

/**
 * Windows はウィンドウが非アクティブになるとアクリルを切って不透明に落とす。
 * それだと「常に透けていてほしい」という期待に合わないので、
 * フォーカスが外れたタイミングで素材を貼り直して透過を維持する。
 */
function keepBackdropAlive(window) {
  const reapply = () => {
    if (window.isDestroyed()) return
    try {
      window.setBackgroundMaterial('acrylic')
    } catch {
      // 対応していないプラットフォームでは何もしない
    }
  }
  window.on('blur', reapply)
  window.on('focus', reapply)
  window.on('show', reapply)
}

/** dev では Vite の dev サーバー、本番ではビルド済み HTML を読む */
function loadRenderer(window, page) {
  if (process.env.ELECTRON_RENDERER_URL) {
    window.loadURL(`${process.env.ELECTRON_RENDERER_URL}/${page}`)
  } else {
    window.loadFile(join(__dirname, `../renderer/${page}`))
  }
}
