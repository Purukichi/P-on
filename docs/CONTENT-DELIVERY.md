# P-on: 音源ZIPをアプリアップデートと一緒に配布する

アプリのインストーラーをFANBOXの支援者へ案内する。アプリ内のFANBOX認証・Discord認証・会員確認サーバーは使用しない。バージョンは現在 **β2.0.0**（内部表記 `2.0.0-beta.0`）。

## 配布の流れ

```text
音源 + ジャケット + manifest.json → 納入ZIP
  → content:prepareで検証・展開
  → Windows/Mac/モバイルのビルドに同梱
  → GitHub Releasesへインストーラーと更新情報を公開
  → FANBOXでインストーラーを案内
  → 利用者が通常のアプリ更新を適用
  → 次回起動時、新曲を既存の棚に追加（以後オフライン再生可能）
```

**ZIPはインストーラーを作る前に納入する。** EXEをビルドした後にZIPを同じGitHub Releaseへ追加するだけでは、そのEXEには音源が入らない。利用者にZIPの手動展開は不要。

## ZIPの内容

ZIP直下に `manifest.json`、`audio/`、`covers/` を入れる。外側の親フォルダは含めない。暗号化ZIP・シンボリックリンク・絶対パスは使わない。

```text
purukichi-music.zip
├── manifest.json
├── audio/
│   ├── song-001.mp3
│   └── song-002.mp3
└── covers/
    └── album-001.jpg
```

メタデータの例:

```json
{
  "schemaVersion": 1,
  "contentVersion": "2026-10-01",
  "tracks": [
    {
      "id": "song-001",
      "title": "曲名",
      "artist": "Purukichi",
      "album": "アルバム名",
      "duration": 180,
      "audio": "audio/song-001.mp3",
      "cover": "covers/album-001.jpg"
    }
  ]
}
```

- `id` は半角英数字・ハイフン・アンダースコア、80文字まで。同じ曲には同じIDを使い続ける。大文字小文字は区別しない。
- `title` と `audio` は必須。`artist`を省略するとPurukichi。`album`を省略するとシングル。`duration`は秒、省略可能。`cover`も省略可能。
- アルバム内の順番は `tracks` の順番。共通ジャケットは各曲の `cover` に同じパスを指定する。
- Windows/Mac/モバイルで共有するパックにはMP3またはAAC/M4Aを推奨。OSごとの実機再生確認は必要。
- 上限は2000曲、ZIP内5000エントリー、1ファイル展開後512MiB、全体展開後2GiB。モバイルはそれ以下でも端末容量・メモリ制約を確認する。

## 納入後のコマンド

```powershell
npm run content:prepare -- "C:\納入\purukichi-music.zip"
npm run build:win
```

Macでは同じZIPを準備後、Mac上で `npm run build:mac`。iOS/Androidでは準備後 `npm run mobile:sync` でXcode/Androidプロジェクトへ反映する。

準備済み音源は `generated/content/` に入り、ソース管理から除外される。ビルド時に参照ファイルとSHA-256を再検証する。Windows/Macはアプリのresourcesへ、モバイルはWeb assetsへ同梱する。`generated/content` が存在しないクリーン環境では、開発テスト用に0曲のパックを作る。**実配布用は必ずZIPを準備してからビルドする。**

納入ZIPが不正・音源不足の場合は処理を中断し、直前の準備済みパックを維持する。ZIPの再準備は新しいパックへの置き換えなので、毎回「新曲だけ」ではなく**そのバージョンで新規利用者に届けたい全曲**を含める。

ZIP自体をReleasesへ添付するのは保管用途として任意。自動更新が取得するのはZIPを組み込んで作ったインストーラーであり、ZIPを別途ダウンロードする仕組みではない。

## GitHubへのアップロード

1. 新曲を含む全曲ZIPを準備する。
2. アプリのバージョンを上げる（次のβなら `2.0.0-beta.1` など）。画面表示用の `src/shared/version.js` とネイティブのビルド番号も揃える。
3. 対象OSでビルド・署名し、動作確認する。
4. 同じタグのGitHub Pre-releaseへWindows EXEと生成された更新YAML・blockmapをまとめてアップロードする。Macも配布する場合はDMG・ZIPとMac用更新情報を含める。
5. FANBOXでインストーラーを案内する。既にβ版を入れた利用者は従来の更新通知から更新する。

βでは通常 `beta.yml` / `beta-mac.yml`、正式版では `latest.yml` / `latest-mac.yml` が生成される。手で書き換えず、ビルドで出た更新メタデータを使う。既存安定版からβへの初回移行は手動インストールを想定。Macの自動更新は署名済みアプリとZIPが必要。

現状の更新先は `electron-builder.yml` の `Purukichi/P-on`。既存のGitHub Actionsは開発用0曲ビルドなので、実配布に利用する場合は各ビルドジョブに納入ZIPの取得と `content:prepare` を追加する。公開リポジトリに音源そのものをコミットする必要はない。

GitHubの公開Releaseに置いたEXE/ZIPは、FANBOX非会員もURLを取得すればダウンロードできる。非公開Releaseは一般利用者向けの現在の自動更新から直接は読めない。本構成はFANBOXでの配布案内によって対象者を限定する方式であり、インストール後の会員資格や退会を判定しない。秘密トークンはアプリに埋め込まない。

参考: [electron-builderの同梱ファイル設定](https://www.electron.build/contents/)、[GitHub Releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases)。

## 更新後の利用者データ

- 最初の起動時に同梱曲をライブラリへ追加する。棚・再生キュー・編集などの既存UIをそのまま使う。
- 曲IDと配布済み記録で二重取り込みを防ぐ。バージョンを飛ばして更新しても、そのパックに含まれる未配布曲を追加する。
- 利用者自身の音源、プレイリスト、編集済みの曲情報、差し替え済み音源は上書きしない。
- 利用者が削除した配布曲は、以後の更新でも自動復活させない。
- 同じIDの曲を再納入しても、既存利用者の曲情報・音源は更新しない。別ミックスなどを新しく届ける場合は新しいIDにする。
- ZIPから曲を外しても、既に利用者が受け取った曲は削除しない。新規インストールには含まれなくなる。
- 全ファイルのコピー・検証後にライブラリと配布済み記録を保存する。途中で失敗した場合は新曲の登録を完了扱いにせず、再起動時に再試行する。容量不足などでファイルだけ残る場合があるが、既存曲・プレイリストは削除しない。

## モバイルでの違い

同じZIPをiOS/Androidアプリへ同梱し、初回起動・更新後の初回起動に新曲を追加する処理を実装している。ただしEXE用のelectron-updaterはモバイルには使えない。iOSはTestFlight/App Store等、Androidは署名済みAPKの更新またはGoogle Play等でアプリ本体を更新する。FANBOXからiOSのEXEやIPAを配るだけで通常のiPhoneへインストールできるわけではない。

今回確認したのはソースコード、共通ビルド、ZIPとデータ保存の自動テストまで。実音源の納入、署名済み配布物、GitHubへの公開、OSごとの実機更新はまだ行っていない。
