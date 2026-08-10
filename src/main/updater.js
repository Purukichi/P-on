import { app, dialog } from 'electron'
import electronUpdater from 'electron-updater'
import { getMainWindow, getMiniWindow } from './windows.js'

/**
 * 自動更新。
 *
 * 配信元は GitHub Releases（electron-builder.yml の publish を参照）。
 * ビルド時に app-update.yml が同梱され、electron-updater はそこを見て
 * latest.yml を取りに行く。
 *
 * 流れ:
 *   起動 -> 少し置いて確認 -> 裏でダウンロード -> 出来たら再起動を促す
 *
 * 「あとで」を選んでも autoInstallOnAppQuit で次にアプリを閉じたときに入るので、
 * 押しそびれても更新は取りこぼされない。
 */

// electron-updater は CommonJS。名前付き import は環境によって解決できないので、
// 既定の書き出しを受けてから取り出す。
const { autoUpdater } = electronUpdater

/** 起動直後は取り込みや描画で忙しいので、少し待ってから確認する */
const FIRST_CHECK_DELAY = 8000

export function initUpdater() {
  /*
   * 動くのはインストール版だけ。
   * - 開発中は app-update.yml が無い
   * - ポータブル版は自分自身を書き換えられない（PORTABLE_EXECUTABLE_DIR で見分ける）
   */
  if (!app.isPackaged) return
  if (process.env.PORTABLE_EXECUTABLE_DIR) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  // 更新の記録はコンソールにだけ残す。画面に出すのは「用意ができた」ときだけ
  autoUpdater.logger = null

  let prompted = false

  autoUpdater.on('update-downloaded', async (info) => {
    // ダウンロード完了は再確認のたびに飛びうるので、聞くのは 1 回だけ
    if (prompted) return
    prompted = true

    const { response } = await dialog.showMessageBox(visibleWindow(), {
      type: 'info',
      message: `新しいバージョン ${info.version} を用意しました`,
      detail:
        '再起動すると更新が適用されます。\n「あとで」を選んだ場合は、次にアプリを終了したときに自動で適用されます。',
      buttons: ['いま再起動して更新', 'あとで'],
      defaultId: 0,
      cancelId: 1
    })

    if (response !== 0) return
    /*
     * ダイアログを閉じきる前に quitAndInstall すると、
     * 終了処理とダイアログの後片付けがぶつかることがある。
     * 次のティックまで譲ってから終了させる。
     */
    setImmediate(() => autoUpdater.quitAndInstall())
  })

  autoUpdater.on('error', (error) => {
    /*
     * 更新の確認に失敗しても、アプリの用は足りている。
     * オフラインや Releases 未作成でも起動のたびに謝られるのは煩わしいので、
     * 画面には出さずログだけ残す。
     */
    console.error('[updater] 更新を確認できませんでした:', error?.message ?? error)
  })

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((error) => {
      console.error('[updater] 更新の確認に失敗しました:', error?.message ?? error)
    })
  }, FIRST_CHECK_DELAY)
}

/** ダイアログの親。ミニプレイヤーに切り替えているときはそちらに出す */
function visibleWindow() {
  const mini = getMiniWindow()
  return mini?.isVisible() ? mini : getMainWindow()
}
