# 開発メモ

P-on の中身をいじる人向けの覚え書き。使い方は [README](../README.md) を参照。

Electron + electron-vite。フレームワークなしの素の HTML / CSS / JavaScript 構成。

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

`release/` にできるもの。

| 出力 | 用途 |
| --- | --- |
| `P-on-<version>-x64.exe` | インストーラ。実行するとインストール先を選べて、デスクトップにショートカットができる。自動更新が効くのはこれだけ |
| `win-unpacked/P-on.exe` | 展開済みフォルダ。起動が一番速い。ショートカットを自分で作って使う |
| `latest.yml` | 自動更新の目録。Releases に exe と一緒に上げる（これが無いと更新を検出できない） |

設定は [electron-builder.yml](../electron-builder.yml)。アイコンは `build/icon.ico` を使う。

### 電子署名

1.2.30 から、exe とインストーラに Authenticode の署名を付けている（名義は Yushi Hiyama）。
署名があると、配ったあとにファイルの中身がすり替えられていないことを利用者が確かめられる。
プロパティの「デジタル署名」タブか、PowerShell で見られる。

```bash
Get-AuthenticodeSignature "release\P-on-1.2.30-x64.exe" | Format-List
```

鍵は pfx としてリポジトリに置かず、Windows の証明書ストア
（`Cert:\CurrentUser\My` の `CN=Yushi Hiyama`）から名前で引く。
そのため**この証明書が入っている端末でしかビルドできない**。
別の端末でビルドしたくなったら、証明書を pfx で書き出して持っていく
（`certmgr.msc` → 個人 → 証明書 → エクスポート、秘密キーを含める）。

作り直すときは以下。有効期限は 2036-08-25。

```bash
New-SelfSignedCertificate -Type CodeSigningCert -Subject "CN=Yushi Hiyama" -KeyExportPolicy Exportable -KeySpec Signature -KeyLength 3072 -HashAlgorithm SHA256 -CertStoreLocation Cert:\CurrentUser\My -NotAfter (Get-Date).AddYears(10)
```

ただし自己署名なので、**SmartScreen の警告は今までどおり出る**。
警告が消えるのは公的な認証局（DigiCert や Sectigo など）が出した
コード署名証明書を使ったときだけで、これは有料。
初回起動時は「詳細情報」→「実行」で進める。

自己署名だと `electron-builder.yml` の `verifyUpdateCodeSignature` も
`false` のままにしておく必要がある。詳しくはそのファイルのコメントを参照。

レンダラーだけをビルドし直したいときは `npm run build`。

### ビルドが `EXDEV: cross-device link not permitted` で失敗する場合

electron-builder のキャッシュ（`%LOCALAPPDATA%\electron-builder\Cache`）でフォルダの
rename が拒否される環境がある。キャッシュ先をプロジェクト内に移すと通る。

```bash
$env:ELECTRON_BUILDER_CACHE = "$PWD\.builder-cache"; npm run build:win
```

## 更新を配る

インストール版は起動から数秒後に GitHub Releases を見に行き、新しいものがあれば
裏でダウンロードしてから再起動を促す。「あとで」を選んでも、次にアプリを終了した
ときに適用される（[updater.js](../src/main/updater.js)）。

配信元は [electron-builder.yml](../electron-builder.yml) の `publish`。ここの `owner` /
`repo` がビルド時に `app-update.yml` へ焼き込まれるので、**GitHub のユーザー名や
リポジトリ名が違う場合は必ず先に直す**。間違っていてもアプリは普通に起動するが、
更新が永久に見つからないまま気づけない。

新しい版を配る手順:

1. `package.json` の `version` を上げる（上げないと更新として認識されない）
2. GitHub のリポジトリを用意する（初回のみ）。非公開リポジトリはトークンを exe に
   埋める必要があり安全でないので、公開リポジトリにする
3. `repo` 権限を持つ Personal Access Token を `GH_TOKEN` に入れて実行する

```bash
$env:GH_TOKEN = "<personal access token>"; npm run release
```

`release/` の exe と `latest.yml` が Releases へ上がる。

インストール済みのアプリが更新を受け取るのは、その版が**すでに更新機能を持っている**
場合だけ。更新機能が入る前の版を使っている場合は、一度だけ手でインストールし直す。

### 手で上げる（GitHub の画面から）

トークンを用意したくないときや、`npm run release` が途中で失敗したときは、
ブラウザからでも同じものを配れる。アプリ側の見え方は自動で上げた場合と変わらない。

1. `package.json` の `version` を上げてから、インストーラを作る

   ```bash
   npm run build:win
   ```

2. `release/` にできた次の 3 つを用意する。**`latest.yml` を忘れると、
   アプリ側は更新に気づけない**（新しい Release があっても永久に「最新です」と答える）

   | ファイル | 要否 |
   | --- | --- |
   | `P-on-<version>-x64.exe` | 必須。インストーラ本体 |
   | `latest.yml` | 必須。版番号とハッシュの目録。これを見て更新を検出する |
   | `P-on-<version>-x64.exe.blockmap` | 任意。差分ダウンロード用。無くても更新は通る（毎回まるごと落とす） |

   exe は**名前も中身も変えない**こと。`latest.yml` に書いてあるファイル名と
   sha512 が照合されるので、リネームしたり作り直したりすると弾かれる。

3. GitHub の [Releases](https://github.com/Purukichi/P-on/releases) → *Draft a new release*

   | 項目 | 入れるもの |
   | --- | --- |
   | Tag | `v<version>`（例: `v1.2.5`）。新規作成でよい |
   | Target | `main` |
   | Title | 任意（`v1.2.5` など） |
   | 添付 | 上の 3 ファイルをドラッグ&ドロップ |

4. **Set as a pre-release のチェックは外す**。`electron-builder.yml` の
   `releaseType: release` により、下書きと先行公開は更新として配られない。
   アップロードが終わってから *Publish release* を押す

5. 確認は、1 つ前の版をインストールしたまま起動し、ブランドマーク →「更新を確認」。
   数秒後に新しい版のダウンロードが始まれば成功

配信元の owner / repo は `electron-builder.yml` の `publish` に書いたものが
exe へ焼き込まれている。**別のリポジトリの Releases に上げても届かない**ので、
上げ先が `Purukichi/P-on` であることを確認すること。

なお 1.2.3 以前の利用者は旧 HAMON リポジトリを見に来る。そちらの Releases に
1.2.4 が上がっていれば、1.2.4 へ上がった時点で配信元が P-on に切り替わるので、
以降は P-on 側だけ更新すればよい。

## 画面まわりの設計

グリッド表示は縦に折り返さず、高さに収まる段数だけ積んで横へ並んでいく。
マウスホイールの縦回転はそのまま横送りになる。縦には溢れないので、
スクロールバーも横だけ出す（リスト表示は今までどおり縦）。

横送りは位置をその場で書き換えず、目標だけを動かして毎フレーム追いかける
（およそ 250ms で着地する）。一瞬で飛ぶと手応えが無く、いま何枚ぶん動いたのかも掴めないため。
速さは [CollectionShelf.js](../src/renderer/src/ui/CollectionShelf.js) の
`WHEEL_STEP`（1 回の距離）と `GLIDE_EASE`（追いつく速さ）で決まる。

追いかけるのをやめる条件は 3 つある。

| やめる条件 | なぜ |
| --- | --- |
| 目標に着いた | 小数の差をいつまでも追わない |
| 端に着いて動かせない | `scrollWidth` から出した目標は、実際に行ける位置を数 px 超えることがある。これが無いと届かない目標を永久に追い続ける |
| 自分が置いた位置から動いていた | スクロールバーを掴まれた合図。そのまま追いかけると、掴んだ先から元の位置へ引き戻してしまう |

ウィンドウを縦に狭めると、ジャケットと余白・棚の段が順に詰まって全体が収まるようになっている
（[responsive.css](../src/renderer/src/styles/responsive.css)）。

右側の曲リストは、キューに曲が入っていれば必ず出る（シングル 1 曲でも出る）。
棚のカードを掴んでいる間は、キューが空でも受け皿として開く。
再生中の曲を削除すると、既定の空の状態に戻る。

見出しは鳴らしているものの名前になる。棚から寄せ集めて組んだときは「再生キュー」。

「もっと見る」で棚を広げると、上の再生画面は 1 行のコンパクト表示に畳まれる。
（畳まないと棚とジャケットが同じ場所を取り合って重なってしまうため）

タグの無い音源はシングルとして入るので、複数選んでから
「アルバムにまとめる」を押すと、まとめてアルバム名を書き込める。

### シークバーの動き

`<audio>` の `timeupdate` は 4 回/秒ほどしか来ないので、そのまま描くとシークバーが
その刻みで飛び飛びに進む。再生中は [AudioEngine](../src/renderer/src/core/AudioEngine.js) が
24fps（`TICK_INTERVAL`）で現在位置を配り直し、滑らかに見せている。
バーの移動量は 1 秒あたり数 px しかないので、これ以上細かくしても見た目は変わらない。

タイマーに `setInterval` を使っているのは、`requestAnimationFrame` だと画面が隠れている
あいだ止まってしまうため。ミニプレイヤーに切り替えるとメインウィンドウは hide されるので、
そこで止まるとミニ側のシークバーまで固まってしまう。

### ジャケットの二階建て

ジャケットは「アルバム共通」と「曲個別」の 2 つを別々に持つ。

| | どこで設定するか | 効く範囲 |
| --- | --- | --- |
| アルバム共通 | 棚のカードのポップアップ | そのアルバムの全曲 |
| 曲個別 | ジャケット枠のクリック / 編集ダイアログ | その 1 曲だけ（アルバム共通を上書き） |

取り込み時、アルバム名を持つ曲の埋め込み画像は**アルバム共通**として保存される。
そのため「アルバムのジャケットを差し替える」操作が収録曲すべてに効く。
アルバムに入っている曲がシングルとしても出ていて別のアートワークを使いたいときは、
その曲にだけ個別ジャケットを設定すれば上書きできる。
アルバム名を持たない曲（シングル）の埋め込み画像は、その曲個別のジャケットになる。

### ミニプレイヤー

Spotify のような、常に最前面に浮く小さなプレイヤー。
**形は正方形のひとつだけ**で、ジャケットを窓いっぱいに見せる。
操作面（シークバー・音量・再生・前後）はその上に重ねる。

ジャケットは切り取らず、窓に収まる最大の正方形に収める。
**窓のリサイズも正方形に縛る。** 縦横が崩れると絵の外側に地の色の帯が出て、
「ジャケットだけを見せる」という狙いから外れてしまうため。
それでも帯が出るとき（読み込み前など）は、ジャケットの主要色で塗る。

縛り方は 2 段構え。ふだんは `setAspectRatio`（OS 側の制約）が効いてドラッグ中も正方形のまま動き、
効かなかったときは手を離した時点で正方形へ戻す（`resized`）。
**ドラッグの最中には寸法を入れ直さない。** `will-resize` を preventDefault して差し替えると、
Windows ではリサイズのループを毎フレーム打ち消すことになり、掴んだ辺がカーソルに付いてこなくなる。

窓を掴んで動かす面（`-webkit-app-region: drag`）は、**窓の縁を 8px 空けて**敷いている。
面ごと drag にすると縁まで drag になり、端を掴んでもリサイズではなく移動になってしまう
（正方形はジャケットが窓いっぱいなので、どこを掴んでも移動になる）。

操作面はジャケットに重ねるので、普段は引っ込めておき、
**窓の範囲にマウスが入っているあいだ**だけ出す。
キーボードでたどっているあいだも出すが、条件は `:focus-visible` に限っている。
`:focus-within` にすると、ボタンを 1 度押しただけでフォーカスが操作面に残り、
マウスを外しても出しっぱなしになる（ジャケットの面は drag 領域なので、
そこを押してもフォーカスが移らない）。
ジャケットの面は掴んで窓を動かすための領域（`-webkit-app-region: drag`）で、
その上ではページにマウスイベントが届かない。CSS の `:hover` に任せると
「操作面そのものに触れたときしか出ない」ことになるので、
カーソルの位置は main 側で見て知らせている（[windows.js](../src/main/windows.js) の watchMiniHover）。

**切り替えても音は途切れない。** 音を鳴らしている `<audio>` はメインウィンドウにひとつだけ置き、
ミニに切り替えるときもメインウィンドウは隠すだけで壊さない設計にしてある。
ミニ側は状態を受け取って描き、操作を送り返すリモコンに徹している。

## ディレクトリ構成

```
build/
├── source/                    アイコンの元絵
│   ├── app-icon.jpg           配布アイコンの元（白地に、マークの形の写真）
│   └── brandmark.png          マーク単色版（図形を起こすときの原寸見本）
├── make-icon.cjs              app-icon.jpg の角を丸めて icon.png / icon.ico を作る
├── icon.svg                   マークの図形版（アプリ内のブランドマークと同じ形）
├── icon.png                   写真版アイコン 512px
└── icon.ico                   配布用。16〜256px を束ねたもの

src/
├── main/                      Electron メインプロセス
│   ├── index.js               起動の入口
│   ├── windows.js             メイン / ミニの生成と切り替え
│   ├── ipc.js                 レンダラーからの入口 + ウィンドウ間の中継
│   ├── library-store.js       保存場所と library.json の読み書き
│   ├── library-service.js     取り込み / 削除 / プレイリスト操作
│   ├── metadata.js            music-metadata でタグとジャケットを抽出
│   └── media-protocol.js      hamon-media:// で配信（Range 対応）
├── preload/
│   └── index.js               window.hamon として API を公開
├── shared/
│   └── ipc-channels.js        main / preload 共通の定数
└── renderer/
    ├── index.html             メインウィンドウ
    ├── mini.html              ミニプレイヤー
    └── src/
        ├── main.js            メインウィンドウの組み立てとイベント配線
        ├── mini.js            ミニプレイヤー（音は鳴らさないリモコン）
        ├── core/              ★ DOM に触らないロジック
        │   ├── Emitter.js     最小のイベントエミッタ
        │   ├── Track.js       1 曲分の情報モデル
        │   ├── Playlist.js    プレイリスト（id の並びだけを持つ）
        │   ├── Collections.js プレイリスト / アルバム / シングルへの束ね方
        │   ├── Library.js     ライブラリの状態と main への操作
        │   ├── PlayQueue.js   再生キュー
        │   ├── AudioEngine.js <audio> のラッパ（再生制御）
        │   ├── Theme.js       ライト / ナイトの切り替え
        │   └── Settings.js    透過度・アクセント色・ぼかしの保存と反映
        ├── ui/                DOM 更新だけを担当
        │   ├── NowPlaying.js  ジャケット・曲情報・シーク・音量
        │   ├── TrackList.js   右カラムの一覧
        │   ├── CollectionShelf.js 下段の棚と右クリックのポップアップ
        │   ├── TrackEditor.js 楽曲情報の編集ダイアログ
        │   ├── NameDialog.js  名前入力ダイアログ
        │   ├── AboutPanel.js  ブランドマークから出るバージョン情報
        │   ├── ArtistLinks.js 連名を分解して、名前ごとの検索リンクにする
        │   ├── Tooltip.js     data-tip の吹き出し
        │   ├── DropZones.js   ウィンドウ全体とゴミ箱のドロップ
        │   ├── drag.js        ドラッグ&ドロップの共通処理
        │   └── dom.js         DOM ヘルパー
        ├── utils/time.js
        └── styles/            テーマ + パーツ別 CSS
```

アイコンは 2 系統ある。

| 用途 | 実体 | 直し方 |
| --- | --- | --- |
| 配布するアプリアイコン | `build/icon.ico` / `icon.png` | `build/source/app-icon.jpg` を差し替えて `node build/make-icon.cjs` |
| アプリ内のブランドマーク（左上・バージョン情報） | `index.html` に直接書いた SVG | パスを書き換える。`build/icon.svg` も同じ形に揃える |

`make-icon.cjs` は元絵を正方形に収めて角を丸め、サイズ違いを束ねて `.ico` にするだけ。
**白い下敷きはデザインなのでそのまま残す**（透過にしない）。実行にはライブラリが要る。

```bash
npm install --no-save sharp png-to-ico
```

マークの図形は 3 か所（`index.html` の 2 つと `build/icon.svg`）に同じものが書いてある。
形を変えるときは全部そろえたうえで、`build/source/app-icon.jpg` も描き直すこと。

## 設計メモ

### ローカルファイルの再生方法

dev 中のレンダラーは `http://localhost:5173` で動くため、`file://` を直接は読めない。
そこで独自スキーム `hamon-media://library/audio/xxx.mp3` を登録し、
main プロセスがストリーム配信している（[media-protocol.js](../src/main/media-protocol.js)）。

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

- 全体のトーンを変える → [theme.css](../src/renderer/src/styles/theme.css) の CSS 変数
  （ライトが `:root`、ナイトが `[data-theme='night']`）
- 余白や寸法 → 同じく theme.css の `--page-gutter` / `--block-gap` / `--control-size`。
  ブロックごとに数値を散らかさず、この 3 つから引くようにしている
- 個別パーツ → `styles/components/*.css`
- 再生状態は `.app[data-state="playing"]` のように CSS から参照できる
  （`idle` / `loading` / `playing` / `paused` / `stopped`）

### すりガラスの濃さ

ウィンドウは Windows 11 のアクリル素材で、その上に半透明の面を重ねている。
**透け具合と明るさはトレードオフ**で、暗い壁紙ほど透かすと沈む。
以前はスライダーで変えられるようにしていたが、実際に使うと動かす必要が無かったので
[Settings.js](../src/renderer/src/core/Settings.js) の `APPEARANCE` に固定値として戻した。

面は 2 種類あり、扱いが違う。

| | 何 | 決め方 |
| --- | --- | --- |
| 本体の面 | ウィンドウ全体 | `--surface-alpha`（既定 0.25）。背後のぼかしは OS のアクリル |
| 重なる面 | 右クリックメニュー・ダイアログ・ドロップ時の覆い・ミニの操作面 | `--panel-bg`。**不透明** |

重なる面は以前すりガラス（`backdrop-filter`）にしていたが、
背景によって読みやすさが大きく変わってしまうのでやめた。
いまは本体と同じ質感の不透明なパネルをそのまま重ねている。

本体の透け具合と重なる面の濃さを分けているのは、
本体は薄く透かしたい一方で、上に出るものは必ず読めてほしいから。
値は [Settings.js](../src/renderer/src/core/Settings.js) の `APPEARANCE` と
[theme.css](../src/renderer/src/styles/theme.css) を直接書き換えて調整する。

**本体のぼかしの強さは変えられない。** ウィンドウの背後（デスクトップや他アプリ）を
ぼかしているのは Windows のアクリルで、その半径は OS が持っていてアプリからは指定できない。
背後の文字がどれだけ隠れるかは `--surface-alpha` で決まる。

アクリル自体の明暗はアプリのテーマに合わせて `nativeTheme.themeSource` を切り替えている
（システムがダークのままだと、ライトテーマでも背景が灰色に沈むため）。
また Windows は非アクティブなウィンドウのアクリルを切ってしまうので、
`blur` / `focus` で `setBackgroundMaterial('acrylic')` を貼り直して透過を維持している。

### ライブラリの保存先を変える

`P_ON_LIBRARY_DIR`（旧名の `HAMON_LIBRARY_DIR` も受け付ける）に絶対パスを渡すと
保存先を差し替えられる。動作確認のときに本番のライブラリを触らずに済ませるための逃げ道。

未指定なら ドキュメント/P-on を使う。ただし、そこがまだ無くて
改名前の ドキュメント/HAMON が残っているときは、そちらを使い続ける。

```bash
$env:P_ON_LIBRARY_DIR = "D:\tmp\p-on-test"; npm run dev
```

### 書体

`Bahnschrift`（Windows 標準の DIN 1451 系）を先頭に置き、和文グリフを持たないので
日本語は自動的に游ゴシックへフォールバックする。数字・欧文は DIN、日本語は游ゴシックになる。

## 開発時の小ネタ

`npm run dev` 中は DevTools のコンソールから
`window.__hamon`（`engine` / `library` / `queue` / `theme` / `views`）を触れる。
本番ビルドでは除去される。
