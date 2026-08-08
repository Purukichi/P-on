# HAMON

Electron + electron-vite で作るデスクトップ用オーディオプレイヤー。
フレームワークなしの素の HTML / CSS / JavaScript 構成。

## 必要なもの

Node.js（このマシンでは `C:\Program Files\nodejs` にあるが PATH に入っていないので、
必要なら `$env:PATH = "C:\Program Files\nodejs;$env:PATH"` を先に実行する）。

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

```bash
npm run build
```

Windows 用 exe（NSIS インストーラ + portable）:

```bash
npm run build:win
```

出力先は `release/`。設定は [electron-builder.yml](electron-builder.yml)。
アイコンを変えたいときは `build/icon.ico`（256x256 以上）を置いて、
`electron-builder.yml` の `win.icon` のコメントを外す。

## ディレクトリ構成

```
src/
├── main/                      Electron メインプロセス
│   ├── index.js               ウィンドウ生成
│   ├── ipc.js                 ファイル選択ダイアログ
│   └── media-protocol.js      hamon-media:// で音声を配信（Range 対応）
├── preload/
│   └── index.js               window.hamon として API を公開
├── shared/
│   └── ipc-channels.js        main / preload 共通の定数
└── renderer/
    ├── index.html             マークアップ
    └── src/
        ├── main.js            組み立てとイベント配線
        ├── core/              ★ UI に依存しないロジック
        │   ├── Emitter.js     最小のイベントエミッタ
        │   ├── Track.js       1 曲分の情報モデル
        │   ├── TrackLibrary.js 読み込み済みトラックの管理
        │   └── AudioEngine.js <audio> のラッパ（再生制御）
        ├── ui/
        │   └── PlayerView.js  DOM と AudioEngine の橋渡し
        ├── utils/time.js
        └── styles/            テーマ + パーツ別 CSS
```

## 設計メモ

### ローカルファイルの再生方法

dev 中のレンダラーは `http://localhost:5173` で動くため、`file://` を直接は読めない。
そこで独自スキーム `hamon-media://stream/<token>` を登録し、
main プロセスがファイルをストリーム配信している（[media-protocol.js](src/main/media-protocol.js)）。

- `Range` ヘッダを自前で処理しているので、シークが正しく動く
- URL に入るのはセッション限りのランダムな token で、生のパスは露出しない

### 責務の分け方

- **AudioEngine** — 再生そのもの。DOM を一切触らない。`new Audio()` を内部に持つだけで
  DOM に挿していないので、後で EQ を足すときは `AudioContext.createMediaElementSource()` に
  そのまま繋げられる。
- **Track / TrackLibrary** — 曲情報とファイル管理。UI もエンジンもここを経由して曲を知る。
- **PlayerView** — DOM 更新だけを担当。エンジンのイベントを購読して描画する。

`main.js` はこの 3 つを繋いでいるだけなので、機能を足すときも配線を見れば済む。

### スタイルをいじるときの約束

JS が要素を掴むのに使っているのは **`data-el="..."` 属性だけ**。
`class` は見た目のためにしか使っていないので、クラス名を自由に付け替えたり
構造を組み替えたりしても JS は壊れない。

- 全体のトーンを変える → [theme.css](src/renderer/src/styles/theme.css) の CSS 変数
- 個別パーツ → `styles/components/*.css`（ボタン、シークバー、音量などファイル分割済み）
- 再生状態は `.app[data-state="playing"]` のように CSS から参照できる
  （`idle` / `loading` / `playing` / `paused` / `stopped`）

## 今後の拡張ポイント

| やりたいこと | 触る場所 |
| --- | --- |
| 複数ファイルをまとめて開く | `src/main/ipc.js` の `properties` に `'multiSelections'` を追加 |
| プレイリスト | `TrackLibrary` の上に PlayQueue を作り、`engine.on('ended')` で次の曲へ |
| プレイリストの保存 / 復元 | `Track#toJSON()` で保存、`TrackLibrary#addByPaths()` で復元 |
| タグ（曲名・アーティスト・ジャケット）読み込み | main 側で読んで `Track` のフィールドを埋める |
| イコライザー | `AudioEngine` 内の `<audio>` を Web Audio のグラフに接続する |

## 操作

| 操作 | 割り当て |
| --- | --- |
| 再生 / 一時停止 | 再生ボタン、Space キー |
| 停止（先頭に戻る） | 停止ボタン |
| シーク | シークバーをドラッグ |

## 開発時の小ネタ

`npm run dev` 中は DevTools のコンソールから `window.__hamon`（`engine` / `library` / `view`）
を触れる。本番ビルドでは除去される。
