import { app, BrowserWindow } from 'electron'
import { registerIpcHandlers } from './ipc.js'
import { registerMediaProtocol, registerMediaScheme } from './media-protocol.js'
import { ensureDirectories } from './library-store.js'
import { createMainWindow, focusExistingWindow } from './windows.js'
import { initUpdater } from './updater.js'
import { audioPathsFromArgv, queueOpenedFiles } from './opened-files.js'

/**
 * Windows にこのアプリを名乗るための ID。electron-builder.yml の appId と揃えること。
 * ここを設定しておかないと、インストーラが作ったショートカットと
 * 実行中のウィンドウが別物として扱われ、タスクバーで 2 つに分かれたり
 * ピン留めが効かなかったりする。
 */
const APP_ID = 'com.hamon.player'
app.setAppUserModelId(APP_ID)

// whenReady より前に呼ぶ必要がある
registerMediaScheme()

/*
 * 音を鳴らしているのは 1 プロセスだけ、という前提で組んである。
 * 2 つ目が立ち上がると同じライブラリを別々に書き換えてしまうので、
 * 後から起動したほうは終了させ、すでに開いているウィンドウを前に出す。
 */
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  // 「プログラムから開く」で起動されたとき。レンダラーが準備できたら取りに来る
  queueOpenedFiles(audioPathsFromArgv(process.argv))

  // 起動中にさらにファイルを開かれたときは、2 つ目のプロセスの argv がここに届く
  app.on('second-instance', (_event, argv, workingDirectory) => {
    queueOpenedFiles(audioPathsFromArgv(argv, workingDirectory))
    focusExistingWindow()
  })

  // macOS はパスを引数ではなくイベントで渡してくる（起動前にも来る）
  app.on('open-file', (event, filePath) => {
    event.preventDefault()
    queueOpenedFiles([filePath])
  })

  app.whenReady().then(async () => {
    registerMediaProtocol()
    registerIpcHandlers()
    await ensureDirectories()
    createMainWindow()
    // ウィンドウを出してから。確認自体はさらに数秒置いて始まる
    initUpdater()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
