# HAMON

Electron + electron-vite で作るデスクトップ用オーディオプレイヤー。
フレームワークなしの素の HTML / CSS / JavaScript 構成。

## セットアップ

```bash
npm install
```

## 開発

```bash
npm run dev
```

- レンダラー（HTML / CSS / JS）を保存すると即座に反映される。CSS は再読み込みなしのホット更新。
- main / preload を編集したときは `npm run dev:watch` にしておくと Electron が自動で再起動する。

## ビルド

Windows 用 exe を作る:

```bash
npm run build:win
```

`release/` に 3 種類できる。

| 出力 | 用途 |
| --- | --- |
| `HAMON-0.1.0-x64.exe` | インストーラ。実行するとインストール先を選べて、デスクトップにショートカットができる |
| `HAMON-0.1.0-portable.exe` | インストール不要。ダブルクリックでそのまま起動する |
| `win-unpacked/HAMON.exe` | 展開済みフォルダ。起動が一番速い。ショートカットを自分で作って使う |

設定は [electron-builder.yml](electron-builder.yml)。
アイコンを変えたいときは `build/icon.ico`（256x256 以上）を置いて、
`electron-builder.yml` の `win.icon` のコメントを外す。

コード署名をしていないので、初回起動時に Windows SmartScreen の警告が出る。
「詳細情報」→「実行」で進める。自分で作った exe なので想定どおりの挙動。

レンダラーだけをビルドし直したいときは `npm run build`。

### ビルドが `EXDEV: cross-device link not permitted` で失敗する場合

electron-builder のキャッシュ（`%LOCALAPPDATA%\electron-builder\Cache`）でフォルダの
rename が拒否される環境がある。キャッシュ先をプロジェクト内に移すと通る。

```bash
$env:ELECTRON_BUILDER_CACHE = "$PWD\.builder-cache"; npm run build:win
```

## 使い方

| やりたいこと | 操作 |
| --- | --- |
| 音源を取り込む | ウィンドウにファイルをドラッグ&ドロップ（または「音源を追加」） |
| 再生 / 一時停止 | 再生ボタン、Space キー |
| 停止（先頭に戻る） | 停止ボタン |
| 曲情報を編集 | 一覧の行にマウスを乗せて「編集」 |
| ジャケットを設定 | 編集ダイアログにドロップ / 再生中のジャケット枠に直接ドロップ |
| プレイリストに追加 | 一覧の行を下のプレイリストカードへドラッグ |
| 曲を完全に削除 | 一覧の行を右上のゴミ箱へドラッグ（確認あり） |
| ナイトモード | 右上の月 / 太陽アイコン（設定は次回起動時も保持される） |

取り込んだファイルは元の場所からコピーされるので、元ファイルを移動・削除しても再生できる。

## データの保存場所

```
ドキュメント/HAMON/
├── library.json   曲情報とプレイリスト
├── audio/         取り込んだ音源（元のファイル名のまま）
└── covers/        ジャケット画像
```

「保存フォルダを開く」ボタン（右上のフォルダアイコン）からエクスプローラーで開ける。

## ディレクトリ構成

```
src/
├── main/                      Electron メインプロセス
│   ├── index.js               ウィンドウ生成
│   ├── ipc.js                 レンダラーからの入口
│   ├── library-store.js       保存場所と library.json の読み書き
│   ├── library-service.js     取り込み / 削除 / プレイリスト操作
│   ├── metadata.js            music-metadata でタグとジャケットを抽出
│   └── media-protocol.js      hamon-media:// で配信（Range 対応）
├── preload/
│   └── index.js               window.hamon として API を公開
├── shared/
│   └── ipc-channels.js        main / preload 共通の定数
└── renderer/
    ├── index.html             マークアップ
    └── src/
        ├── main.js            組み立てとイベント配線
        ├── core/              ★ DOM に触らないロジック
        │   ├── Emitter.js     最小のイベントエミッタ
        │   ├── Track.js       1 曲分の情報モデル
        │   ├── Playlist.js    プレイリスト（id の並びだけを持つ）
        │   ├── Library.js     ライブラリの状態と main への操作
        │   ├── PlayQueue.js   再生キュー
        │   ├── AudioEngine.js <audio> のラッパ（再生制御）
        │   └── Theme.js       ライト / ナイトの切り替え
        ├── ui/                DOM 更新だけを担当
        │   ├── NowPlaying.js  ジャケット・曲情報・シーク・音量
        │   ├── TrackList.js   右カラムの一覧
        │   ├── PlaylistShelf.js 下段のプレイリスト棚
        │   ├── TrackEditor.js 楽曲情報の編集ダイアログ
        │   ├── NameDialog.js  名前入力ダイアログ
        │   ├── DropZones.js   ウィンドウ全体とゴミ箱のドロップ
        │   ├── drag.js        ドラッグ&ドロップの共通処理
        │   └── dom.js         DOM ヘルパー
        ├── utils/time.js
        └── styles/            テーマ + パーツ別 CSS
```

## 設計メモ

### ローカルファイルの再生方法

dev 中のレンダラーは `http://localhost:5173` で動くため、`file://` を直接は読めない。
そこで独自スキーム `hamon-media://library/audio/xxx.mp3` を登録し、
main プロセスがストリーム配信している（[media-protocol.js](src/main/media-protocol.js)）。

- `Range` ヘッダを自前で処理しているので、シークが正しく動く
- 配信できるのはライブラリフォルダ配下だけ。外を指す URL は 403 で弾く

### 状態の同期

main の変更系 API は **すべて「操作後の最新スナップショット」を返す**。
レンダラーの `Library` は返ってきた内容で状態を丸ごと差し替えるだけなので、
差分を自前で当てる必要がなく、状態がズレる余地がない。

### 責務の分け方

- **AudioEngine** — 再生そのもの。DOM を一切触らない。`new Audio()` を内部に持つだけで
  DOM に挿していないので、EQ を足すときは `AudioContext.createMediaElementSource()` に
  そのまま繋げられる。
- **Track / Playlist / Library** — 曲情報とファイル管理。表示ルール
  （アルバム未設定なら「シングル」など）は Track に集約。
- **PlayQueue** — 「次に何を鳴らすか」だけ。再生には関与しない。
- **ui/** — DOM 更新だけ。`main.js` がこれらを繋いでいる。

### スタイルをいじるときの約束

JS が要素を掴むのに使っているのは **`data-el="..."` 属性だけ**。
`class` は見た目のためにしか使っていないので、クラス名を自由に付け替えたり
構造を組み替えたりしても JS は壊れない。

- 全体のトーンを変える → [theme.css](src/renderer/src/styles/theme.css) の CSS 変数
  （ライトが `:root`、ナイトが `[data-theme='night']`）
- 個別パーツ → `styles/components/*.css`
- 再生状態は `.app[data-state="playing"]` のように CSS から参照できる
  （`idle` / `loading` / `playing` / `paused` / `stopped`）

## 既知の制限

- 同じファイルを 2 回取り込むと 2 曲として登録される（重複判定はしていない）。
  ファイル名が衝突した場合は ` (2)` を付けて別ファイルとして保存する。
- アプリの外から `ドキュメント/HAMON` の中身を消しても、起動中は反映されない
  （library.json はアプリ起動時に一度だけ読む）。
- 曲順の並べ替えは未対応。プレイリストは追加した順に再生される。

## 今後の拡張ポイント

| やりたいこと | 触る場所 |
| --- | --- |
| シャッフル / リピート | `PlayQueue` に再生順の決め方を足す |
| 曲順の並べ替え | `TrackList` の行を並べ替え可能にし、`playlists.addTracks` を順序込みの API に広げる |
| 検索 / 絞り込み | `main.js` の `tracksForView()` にフィルタを挟む |
| イコライザー | `AudioEngine` 内の `<audio>` を Web Audio のグラフに接続する |
| 歌詞表示 | `Track` にフィールドを足し、`metadata.js` で読み取る |

## 開発時の小ネタ

`npm run dev` 中は DevTools のコンソールから
`window.__hamon`（`engine` / `library` / `queue` / `theme` / `views`）を触れる。
本番ビルドでは除去される。
