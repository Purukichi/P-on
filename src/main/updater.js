import { app, dialog } from 'electron'
import electronUpdater from 'electron-updater'
import { DISPLAY_VERSION } from '../shared/version.js'
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

/**
 * この環境で自動更新が使えるか。
 * 使えない理由は画面にそのまま出すので、文言もここで持つ。
 */
let support = { supported: false, reason: '' }

/** ダウンロード済みの版。手動で確認したときに「準備できています」と答えるために覚えておく */
let downloadedVersion = null

/** バージョン情報のパネルに出す内容 */
export function appInfo() {
  return { version: DISPLAY_VERSION, buildVersion: app.getVersion(), ...support }
}

/**
 * 手動での更新確認。
 * 自動の確認と同じ autoUpdater を使うので、
 * 見つかればそのまま裏でダウンロードが始まり、
 * 済んだ時点で initUpdater 側の案内が出る。
 *
 * @returns {Promise<{status: string, version?: string, message?: string}>}
 */
export async function checkForUpdatesManually() {
  if (!support.supported) return { status: 'unsupported', message: support.reason }
  if (downloadedVersion) return { status: 'downloaded', version: downloadedVersion }

  try {
    const result = await autoUpdater.checkForUpdates()
    const latest = result?.updateInfo?.version ?? null
    if (!latest) return { status: 'error', message: '更新情報を取得できませんでした' }
    if (latest === app.getVersion()) return { status: 'latest', version: latest }
    return { status: 'available', version: latest }
  } catch (error) {
    return { status: 'error', message: readableError(error) }
  }
}

/**
 * 生のエラーは URL やヘッダまで含んでいて画面に出せないので、
 * よくある原因だけ言い換える。
 */
function readableError(error) {
  const text = String(error?.message ?? error)
  if (text.includes('404')) {
    return '配信元が見つかりませんでした。リリースが未公開か、リポジトリが非公開の可能性があります。'
  }
  if (/ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|net::/i.test(text)) {
    return 'ネットワークに接続できませんでした。'
  }
  return '更新を確認できませんでした。'
}

export function initUpdater() {
  /*
   * 動くのはインストール版だけ。
   * - 開発中は app-update.yml が無い
   * - ポータブル版は自分自身を書き換えられない（PORTABLE_EXECUTABLE_DIR で見分ける）
   */
  if (!app.isPackaged) {
    support = { supported: false, reason: '開発中のため、更新の確認は行いません。' }
    return
  }
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    support = {
      supported: false,
      reason: 'ポータブル版は自動更新に対応していません。新しい版は手動で入れ替えてください。'
    }
    return
  }

  support = { supported: true, reason: '' }

  autoUpdater.autoDownload = true
  autoUpdater.allowPrerelease = app.getVersion().includes('-beta.')
  autoUpdater.allowDowngrade = false
  autoUpdater.autoInstallOnAppQuit = true
  // 更新の記録はコンソールにだけ残す。画面に出すのは「用意ができた」ときだけ
  autoUpdater.logger = null

  let prompted = false

  autoUpdater.on('update-downloaded', async (info) => {
    downloadedVersion = info.version

    // ダウンロード完了は再確認のたびに飛びうるので、聞くのは 1 回だけ
    if (prompted) return
    prompted = true

    const { response } = await dialog.showMessageBox(visibleWindow(), {
      type: 'info',
      message: `新しいバージョン ${info.version} を用意しました`,
      detail:
        '再起動すると更新が適用されます。音源を含む更新では、新しい楽曲もライブラリに追加されます。\n「あとで」を選んだ場合は、次にアプリを終了したときに自動で適用されます。',
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
