# P-on β2.0.0 — Mac・iOS・Androidと音源同梱配信の準備

調査日: 2026-09-23。表示は **β2.0.0**、npm/Electronは `2.0.0-beta.0`、iOSの数値バージョンは `2.0.0`（TestFlightでβ配布）。

## 今回の範囲と現状

従来のWindows用UI・音楽再生処理を共有し、別デザインのアプリにはしない。インストーラーをFANBOXで案内し、アプリ内の認証は行わない。Purukichiの音源ZIPをビルド前に取り込み、アプリ更新と同時に届ける。

| 対象 | 用意したもの | まだ完了していないこと |
| --- | --- | --- |
| Windows | 既存UIを維持したβバージョン・β更新設定 | 新しい署名済みインストーラーの配布 |
| Mac | Intel/Apple Silicon用DMG・ZIP設定、vibrancy、ウィンドウボタンの位置調整 | Mac実機ビルド・操作確認、Developer ID署名・公証 |
| Android | Capacitorネイティブプロジェクト、既存画面、ローカル音源保存、P-onアイコン | SDKでのAPK/AAB生成、実機試験、署名・ストア公開 |
| iOS | Capacitor/Xcodeプロジェクト、既存画面、ローカル音源保存、P-onアイコン | Xcodeでの実機ビルド、署名、TestFlight/App Store審査 |
| 音源同梱配信 | ZIP検証・ビルド同梱・起動時の新曲取り込み・配布済み管理 | 実音源納入、署名済みインストーラーでの更新試験、実際の配布 |

**現時点は開発用の準備版。インストール可能なモバイル配布版ではない。** 実音源はまだ0曲で、外部への公開は行っていない。以前のFANBOX/Discord認証案は撤回し、その専用コードも削除した。

## 共通画面とモバイルの動作

- Electronの `window.hamon` APIと同じ形でモバイル用アダプターを実装。曲の取り込み、タグ読み込み、ジャケット、プレイリスト、編集、削除、曲の並べ替え、音源の差し替えを扱う。
- 音源とメタデータはアプリのWebView内IndexedDBへまとめて保存。起動し直しても保持する。PCのライブラリへの自動同期はしない。
- モバイルでは不透明な背景、セーフエリア、縦画面用の配置だけを上書き。小さい画面では再生エリアをスクロールできる。
- 音源は従来の「音源を追加」から端末のファイル選択を使う。OSのファイルアクセスと音声コーデックの違いは実機で確認する。配信用音源はMP3またはAAC/M4Aを候補とする。
- タッチ端末ではカードを長押しして指を離すと既存メニュー、長押し後に移動するとドラッグ。これらは実機でも確認が必要。
- OSの別ウィンドウを使うミニプレイヤー、保存先フォルダ変更、フォルダを開く操作はモバイルでは表示しない。
- **画面を閉じた状態・画面ロック中の連続再生、着信時の中断と復帰、ロック画面操作は未実装・未検証。** HTMLAudioだけではモバイルOSでの持続動作を保証できない。公開前にiOS AVAudioSession/バックグラウンド再生、Android MediaSession/foreground serviceを組み込んで確認する。
- IndexedDBはβ用。大量の音源では保存容量・メモリの制約があり、保存時にはライブラリ全体を読み書きする。実機の容量試験後、必要なら音源本体をネイティブFilesystemに移す。アプリをアンインストールするとアプリ内音源は消える。

## 開発とビルド

Node.js 24を使用。最初に `npm ci`。

```sh
npm test
npm run catalog:validate
npm run build
npm run mobile:build
npm run mobile:sync
```

ブラウザで確認する場合は `npm run mobile:dev`。Chromeがある端末では `npx playwright test` でスマートフォン・タブレット幅の動作を検証できる。WebViewや実機の代替にはならない。

### Mac

Mac上で `npm ci` → `npm run build:mac`。`release/`にarm64/x64それぞれのDMGとZIPを生成する。ZIPはelectron-updaterのMac更新にも必要。

配布にはApple Developer ID Application証明書と公証設定が必要。electron-builderの `CSC_LINK` / `CSC_KEY_PASSWORD`、公証用 `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` などをローカルの環境またはCI Secretsに設定する。秘密情報はリポジトリに置かない。未署名のCI成果物は動作検証用で、自動更新とGatekeeperの通常動作は検証できない。

### Android

Android StudioとSDK/API 36、JDK 21が必要。

```sh
npm run mobile:sync
npm run mobile:android
```

Android Studioで実機を選択して実行する。または `android` 内でWindowsなら `./gradlew.bat assembleDebug`、macOS/Linuxなら `bash gradlew assembleDebug`。デバッグAPKは `android/app/build/outputs/apk/debug/`。Google Play用は別途release署名とAABを準備する。

### iOS

MacとXcode 26以上が必要。Swift Package Managerを使用する。

```sh
npm run mobile:sync
npm run mobile:ios
```

XcodeでSigning Teamと利用可能なBundle Identifierを設定し、実機で実行。TestFlightはApple Developer登録とApp Store Connectの設定が必要。WindowsからiOS実機用IPAをローカル生成することはできない。

### CI

`.github/workflows/platform-builds.yml` はPRまたは手動実行で、共通ビルド・テスト、未署名Mac版、AndroidデバッグAPK、iOSシミュレーター用アプリを作る。**ワークフローは今回追加しただけで、GitHubへのpush・実行はしていない。** Apple側のランナー/Xcode提供状況に応じた調整が必要な場合がある。成果物の作成はストア公開やGitHub Release公開を行わない。

ネイティブのバージョン更新は `node scripts/sync-native-version.mjs`。配布を重ねる際はAndroid `versionCode` とiOS `CURRENT_PROJECT_VERSION` も増やす。アイコン再出力は `node scripts/mobile-icons.mjs`。

### β更新の扱い

`releaseType: prerelease` とβ側の `allowPrerelease` を設定。今回のβを安定版利用者へ強制配信しない。GitHubでは `v2.0.0-beta.0` のPre-releaseとして公開し、生成されたβ用更新情報と各成果物を一緒に置く。旧版からβへの移行は手動インストールを想定。アプリ本体の更新と楽曲カタログの更新を別に扱う。

## この環境で確認したこと

- Electron版とモバイルWeb版の本番ビルド。
- iOS/Androidネイティブプロジェクト生成。
- 自動テスト: モバイル音源・カバー・プレイリストの保存と再読込、差し替え、削除、並行更新、失敗時のロールバック。
- 音源ZIP: パス検証、破損・不足時の中断、新曲の追加、重複防止、編集や削除記録の保持。
- Chrome: 390×844 / 1024×768で音源取り込み・再生・プレイリスト作成・リロード後保持。スクリーンショットは `out/browser-tests/`。

## 配信設計

ZIP納入とGitHubへのアップロード手順は [CONTENT-DELIVERY.md](CONTENT-DELIVERY.md) を参照。

参考: [Capacitor環境要件](https://capacitorjs.com/docs/getting-started/environment-setup)、[electron-builder Mac](https://www.electron.build/mac/)。
