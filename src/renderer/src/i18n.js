/**
 * 表示の言語（English / 日本語）。
 *
 * 画面の文言はもともと英語で書いてあり、ソースもそのまま英語を正とする。
 * 日本語を選んだときは、DOM に出た文字（本文・data-tip・aria-label・placeholder・title）を
 * 下の辞書で置き換える。MutationObserver で見張っているので、あとから JS が書き込んだ文言
 * （ツールチップやトーストなど）もその場で訳される。
 *
 * 訳すのは辞書に載っている「画面の文言」だけ。曲名・アーティスト名などの中身は辞書に無いので
 * そのまま残る。訳したくない所は data-i18n-skip を付けた要素の中に置く。
 *
 * 選んだ言語は localStorage に残し、メインとミニの両方の窓で共有する（storage イベントで追従）。
 */

const STORAGE_KEY = 'pmp1.language'
export const LANGUAGES = ['en', 'ja']

/** 完全に一致する文言の訳 */
const JA = {
  // 上部バー
  'About': 'バージョン情報',
  'About PMP1': 'PMP1 について',
  'Volume': '音量',
  'Volume (0–100)': '音量（0–100）',
  'Double-click to type a value': 'ダブルクリックで数値を入力',
  'Normalize': 'ノーマライズ',
  'Loudness normalization: off': 'ラウドネスノーマライズ: オフ',
  'Loudness normalization off': 'ラウドネスノーマライズをオフにしました',
  'Click to turn off': 'クリックでオフ',
  'Click to turn on': 'クリックでオン',
  'Add music': '曲を追加',
  'Switch to mini player': 'ミニプレイヤーに切り替え',
  'Toggle night mode': 'ナイトモードの切り替え',
  'Switch to light mode': 'ライトモードに切り替え',
  'Switch to night mode': 'ナイトモードに切り替え',
  'Trash': 'ゴミ箱',
  'Drag tracks here to delete their audio and artwork': '曲をここにドラッグすると、音源とジャケットを削除します',
  'Settings': '設定',
  'Minimize': '最小化',
  'Maximize': '最大化',
  'Close': '閉じる',

  // 設定・バージョン情報
  'Language': '言語',
  'Library': 'ライブラリ',
  'Open folder': 'フォルダを開く',
  'Open library folder': 'ライブラリのフォルダを開く',
  'Move library': '保存先を移す',
  'Change library location': 'ライブラリの保存先を変えて、曲をそこへ移します',
  'Moving the library…': 'ライブラリを移しています…',
  'Version': 'バージョン',
  'Check for updates': '更新を確認',
  'Check whether a new version is available.': '新しいバージョンがあるか確認します。',
  'Checking…': '確認しています…',
  'You’re up to date.': '最新のバージョンです。',
  'Couldn’t check for updates.': '更新を確認できませんでした。',
  'Updates can’t be checked here.': 'この環境では更新を確認できません。',

  // 再生
  'Choose a track': '曲を選んでください',
  'Choose a track first': '先に曲を選んでください',
  'Click or drop an image to set this track’s artwork': 'クリックか画像のドロップで、この曲のジャケットを設定します',
  'Position': '再生位置',
  'Previous': '前の曲',
  'Next': '次の曲',
  'Play': '再生',
  'Pause': '一時停止',
  'Play (Space)': '再生（Space）',
  'Pause (Space)': '一時停止（Space）',
  'Stop': '停止',
  'Repeat off': 'リピート: オフ',
  'Repeat all': 'リピート: 全曲',
  'Repeat one': 'リピート: 1 曲',
  'Repeating the queue': '再生キューをリピートします',
  'Repeating this track': 'この曲をリピートします',
  'Shuffle on': 'シャッフル: オン',
  'Shuffle off': 'シャッフル: オフ',
  'Measuring this track’s loudness…': 'この曲のラウドネスを測っています…',
  'This track couldn’t be measured, so it plays at its own level': 'この曲は測れなかったので、元の音量で鳴らします',
  'This track is almost silent, so it plays at its own level': 'この曲はほぼ無音なので、元の音量で鳴らします',
  'This track is too long to measure, so it plays at its own level': 'この曲は長すぎて測れないので、元の音量で鳴らします',
  'Play a track first, then drop the artwork': '先に曲を再生してから、ジャケットをドロップしてください',
  'Reached the end of the queue': '再生キューの最後まで再生しました',
  'Unknown artist': 'アーティスト不明',
  'Untitled track': '無題の曲',
  'Untitled playlist': '無題のプレイリスト',
  'Lossless': 'ロスレス',
  'Stereo': 'ステレオ',
  'Mono': 'モノラル',

  // 曲の一覧
  'List': 'リスト',
  'Queue': '再生キュー',
  'Clear': '空にする',
  'Clear the queue': '再生キューを空にします',
  'Queue cleared': '再生キューを空にしました',
  'Edit': '編集',
  'Done': '完了',
  'Edit titles, artists and albums in place': 'タイトル・アーティスト・アルバムをその場で編集します',
  'Edit track info': '曲の情報を編集',
  'Drag to reorder': 'ドラッグで並べ替え',
  'Remove': '外す',
  'Remove from the queue': '再生キューから外す',
  'Remove from this playlist': 'このプレイリストから外す',
  'Reordered the queue': '再生キューを並べ替えました',
  'Drop cards from the library here to add them to the queue': 'ライブラリのカードをここにドロップすると、再生キューに足します',
  'Audio info': '音源の情報',
  'Unknown': '不明',
  'Loudness: measuring…': 'ラウドネス: 測定中…',
  'Loudness: couldn’t read this audio': 'ラウドネス: この音源は読めませんでした',
  'Loudness: tracks over 20 minutes aren’t measured': 'ラウドネス: 20 分を超える曲は測りません',
  'Title': 'タイトル',
  'Artist': 'アーティスト',
  'Album': 'アルバム',
  'Album (empty for a single)': 'アルバム（空ならシングル）',

  // 棚
  'Search': '検索',
  'Search albums, tracks, artists': 'アルバム・曲名・アーティストで検索',
  'Clear search': '検索を消す',
  'Types to show': '並べる種類',
  'View': '表示',
  'Grid view': 'グリッド表示',
  'List view': 'リスト表示',
  'Show more': 'もっと見る',
  'Show less': '閉じる',
  '+ Playlist': '+ プレイリスト',
  'Playlist': 'プレイリスト',
  'Single': 'シングル',
  'Make album': 'アルバムにする',
  'Make playlist': 'プレイリストにする',
  'Make a playlist from these': 'これでプレイリストを作る',
  'Delete': '削除',
  'Clear selection': '選択を解除',
  'Drag audio files into the window to import them': '音源ファイルを窓にドラッグすると取り込みます',
  'No results': '見つかりませんでした',
  'Nothing of the selected types yet': '選んだ種類のものはまだありません',
  'No types selected (use the buttons next to the search box to show playlists, albums or singles)':
    '種類が選ばれていません（検索欄の横のボタンで、プレイリスト・アルバム・シングルを選んでください）',
  'Play from the start': '最初から再生',
  'Add to queue': '再生キューに足す',
  'Add this track to the queue': 'この曲を再生キューに足す',
  'Rename': '名前を変える',
  'Rename album': 'アルバム名を変える',
  'Rename playlist': 'プレイリスト名を変える',
  'Change album artist': 'アルバムのアーティストを変える',
  'Change all track artists': 'すべての曲のアーティストを変える',
  'Change album artwork': 'アルバムのジャケットを変える',
  'Change playlist artwork': 'プレイリストのジャケットを変える',
  'Remove artwork': 'ジャケットを外す',
  'Artwork removed. The tracks’ own artwork will be used': 'ジャケットを外しました。曲それぞれのジャケットを使います',
  'Delete album': 'アルバムを削除',
  'Delete playlist': 'プレイリストを削除',
  'Delete track': '曲を削除',
  'Everything is already in the playlist': 'すべてプレイリストに入っています',
  'Everything is already in the queue': 'すべて再生キューに入っています',
  'That track is already in the playlist': 'その曲はもうプレイリストに入っています',
  'No tracks to group': 'まとめる曲がありません',
  'No files could be imported': 'ファイルを取り込めませんでした',
  'Import canceled': '取り込みを取りやめました',
  'Couldn’t read the opened file': '開いたファイルを読めませんでした',

  // 取り込み
  'Drop to import': 'ドロップで取り込み',
  'MP3, WAV, FLAC and more are saved to your library and added to the queue':
    'MP3・WAV・FLAC などをライブラリに保存して、再生キューに足します',

  // ダイアログ
  'Track info': '曲の情報',
  'Drop an image': '画像をドロップ',
  'Track artwork': '曲のジャケット',
  'Audio file': '音源ファイル',
  'Replace': '差し替え',
  'Not set': '未設定',
  'Leave empty to treat it as a single': '空にするとシングルとして扱います',
  'Showing the album artwork. Setting one here changes it for this track only.':
    'アルバムのジャケットを表示しています。ここで設定すると、この曲だけが変わります。',
  'Cancel': 'キャンセル',
  'Save': '保存',
  'OK': 'OK',
  'Playlist name': 'プレイリストの名前',
  'New playlist': '新しいプレイリスト',
  'Name': '名前',
  'Create': '作成',
  'Set': '設定',
  'The tracks stay in your library.': '曲はライブラリに残ります。',
  'This can’t be undone.': '元に戻せません。',
  'The audio file and artwork will be permanently deleted from your library. This can’t be undone.':
    '音源ファイルとジャケットをライブラリから完全に削除します。元に戻せません。',

  // ミニプレイヤー
  'No track selected': '曲が選ばれていません',
  'Always on top': '常に手前に表示',
  'Always on top (click to turn off)': '常に手前に表示（クリックでオフ）',
  'Back to main window': 'メインの窓に戻る',
  'Quit PMP1': 'PMP1 を終了'
}

/** 英語の数え方（count() の出力）を日本語の助数詞に */
const UNITS = {
  track: '曲',
  file: 'ファイル',
  item: '件',
  'selected item': '件',
  playlist: 'プレイリスト',
  result: '件'
}
const UNIT_PATTERN = Object.keys(UNITS)
  .sort((a, b) => b.length - a.length)
  .map((word) => `${word}s?`)
  .join('|')
/** 「3 tracks」→「3 曲」 */
function units(text) {
  return text.replace(new RegExp(`(\\d+) (${UNIT_PATTERN})\\b`, 'g'), (_m, n, word) => {
    const key = word.endsWith('s') && !UNITS[word] ? word.slice(0, -1) : word
    return `${n} ${UNITS[key] ?? word}`
  })
}

/** 組み立てられた文言の訳。上から順に試す */
const PATTERNS = [
  [/^(\d+) (tracks?|files?|items?|playlists?|results?)$/, (m) => units(m[0])],
  [/^(\d+) selected$/, (m) => `${m[1]} 件を選択中`],
  [/^(.+) \(click to change\)$/, (m) => `${tr(m[1])}（クリックで切り替え）`],
  [/^Showing (\w+) \(click to hide\)$/, (m) => `${tr(m[1])}を表示中（クリックで隠す）`],
  [/^Hiding (\w+) \(click to show\)$/, (m) => `${tr(m[1])}を隠し中（クリックで表示）`],
  [/^Show (\w+)$/, (m) => `${tr(m[1])}を表示`],
  [/^Version (.+) is available\. Downloading…$/, (m) => `バージョン ${m[1]} があります。ダウンロードしています…`],
  [/^Version (.+) is ready\. Restart to apply it\.$/, (m) => `バージョン ${m[1]} の準備ができました。再起動すると反映されます。`],
  [/^Version (.*)$/, (m) => `バージョン ${m[1]}`],
  [/^Loudness normalization: on \(to (.+) LUFS\)$/, (m) => `ラウドネスノーマライズ: オン（${m[1]} LUFS に合わせる）`],
  [/^Album \((.+)\): (.+)$/, (m) => `アルバム（${m[1]}）: ${m[2]}`],
  [/^Track: (.+)$/, (m) => `曲: ${m[1]}`],
  [/^Format: (.+)$/, (m) => `形式: ${m[1]}`],
  [/^Loudness \(INT\): (.+)$/, (m) => `ラウドネス（INT）: ${m[1]}`],
  [/^Artwork of (.+)$/, (m) => `${m[1]} のジャケット`],
  [/^Couldn’t play this track \(code: (.+)\)$/, (m) => `この曲を再生できませんでした（コード: ${m[1]}）`],
  [/^Library location changed to (.+)$/, (m) => `ライブラリの保存先を ${m[1]} に変えました`],
  [/^Importing (.+)…$/, (m) => `${units(m[1])}を取り込んでいます…`],
  [/^Added (\d+ \w+) to the queue(?: \((\d+ \w+) skipped\))?$/, (m) =>
    `${units(m[1])}を再生キューに足しました${m[2] ? `（${units(m[2])}は飛ばしました）` : ''}`],
  [/^Added (\d+ \w+) to “(.+)”$/, (m) => `${units(m[1])}を「${m[2]}」に足しました`],
  [/^Playing (\d+ \w+)(?: \((\d+ \w+) skipped\))?$/, (m) =>
    `${units(m[1])}を再生します${m[2] ? `（${units(m[2])}は飛ばしました）` : ''}`],
  [/^Playing “(.+)”(?: \((\d+ \w+) skipped\))?$/, (m) =>
    `「${m[1]}」を再生します${m[2] ? `（${units(m[2])}は飛ばしました）` : ''}`],
  [/^Grouped into “(.+)” \((\d+ \w+)\)$/, (m) => `「${m[1]}」にまとめました（${units(m[2])}）`],
  [/^Created “(.+)” \((\d+ \w+)\)$/, (m) => `「${m[1]}」を作りました（${units(m[2])}）`],
  [/^Searched for “(.+)” \((\d+ \w+)\)$/, (m) => `「${m[1]}」を検索しました（${units(m[2])}）`],
  [/^No results for “(.+)”$/, (m) => `「${m[1]}」は見つかりませんでした`],
  [/^Read format info for (\d+ \w+)$/, (m) => `${units(m[1])}の形式を読み取りました`],
  [/^Deleted (.+)$/, (m) => `${units(m[1])}を削除しました`],
  [/^Delete (\d+ [\w ]+)\?$/, (m) => `${units(m[1])}を削除しますか？`],
  [/^Delete the playlist “(.+)”\?$/, (m) => `プレイリスト「${m[1]}」を削除しますか？`],
  [/^Delete the album “(.+)”\?$/, (m) => `アルバム「${m[1]}」を削除しますか？`],
  [/^Delete the track “(.+)”\?$/, (m) => `曲「${m[1]}」を削除しますか？`],
  [/^Delete “(.+)”\?$/, (m) => `「${m[1]}」を削除しますか？`],
  [/^Changes the artist of all (\d+ \w+)$/, (m) => `${units(m[1])}すべてのアーティストを変えます`],
  [/^The audio files and artwork of (\d+ \w+) will be permanently deleted\.$/, (m) =>
    `${units(m[1])}の音源ファイルとジャケットを完全に削除します。`],
  [/^The audio files and artwork of (\d+ \w+) will be permanently deleted from your library\. This can’t be undone\.$/, (m) =>
    `${units(m[1])}の音源ファイルとジャケットをライブラリから完全に削除します。元に戻せません。`],
  [/^(\d+ \w+) will be deleted \(the tracks stay\)\.$/, (m) => `${units(m[1])}を削除します（曲は残ります）。`],
  [/^(Playlist|Album|Single) · (\d+ \w+)$/, (m) => `${tr(m[1])} · ${units(m[2])}`],
  [/^True Peak: (.+)$/, (m) => `トゥルーピーク: ${m[1]}`]
]

let language = readLanguage()
const listeners = new Set()

function readLanguage() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (LANGUAGES.includes(saved)) return saved
  } catch {
    // 読めないときは英語のまま
  }
  return 'en'
}

export function getLanguage() {
  return language
}

export function setLanguage(next) {
  if (!LANGUAGES.includes(next) || next === language) return
  language = next
  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch {
    // 保存できなくても今の窓は切り替える
  }
  applyLanguage()
}

/** 言語が変わったときに呼ばれる */
export function onLanguageChange(callback) {
  listeners.add(callback)
  return () => listeners.delete(callback)
}

/** 1 行ぶんの訳。辞書 → 組み立ての型の順に探し、無ければそのまま返す */
function tr(line) {
  if (JA[line] !== undefined) return JA[line]
  for (const [pattern, build] of PATTERNS) {
    const match = line.match(pattern)
    if (match) return build(match)
  }
  return line
}

/**
 * 英語の文言を、いまの言語にして返す。
 * 改行を含む文言（ツールチップの複数行など）は行ごとに訳す。前後の空白はそのまま残す。
 */
export function t(text) {
  if (language === 'en' || typeof text !== 'string' || text.trim() === '') return text
  const lead = text.match(/^\s*/)[0]
  const trail = text.match(/\s*$/)[0]
  const core = text.slice(lead.length, text.length - trail.length)
  return lead + core.split('\n').map((line) => tr(line)).join('\n') + trail
}

// ---- DOM の文言の置き換え ---------------------------------------------------------------

const ATTRIBUTES = ['data-tip', 'aria-label', 'placeholder', 'title']
/** 置き換える前の英語（テキストノード / 属性ごと） */
const sourceText = new WeakMap()
const sourceAttrs = new WeakMap()
/** 自分で書き込んだ値。MutationObserver が自分の書き込みを新しい原文と取り違えないように */
const writtenText = new WeakMap()
const writtenAttrs = new WeakMap()

const roots = new Set()
let observer = null

function skipped(node) {
  const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement
  if (!el) return true
  if (el.closest('[data-i18n-skip], script, style, textarea')) return true
  // 編集中の入力欄の中身は触らない
  if (el.isContentEditable) return true
  return false
}

/**
 * 曲名・アーティスト名・アルバム名などを出す所。
 * 曲名が「Stop」や「Album」でも訳してしまわないよう、ここでは下の決まり文句だけを訳す
 * （曲を選んでいないときなどに、同じ所へ画面の文言が入るため）。
 */
const USER_CONTENT = [
  '.nowplaying__title', '.nowplaying__artist', '.mini__title', '.mini__artist',
  '.track__title', '.card__name', '.menu__name', '.menu__title', '.artistlink',
  '.cover__album-name', '.editor__audio-name'
].join(', ')
const PLACEHOLDERS = new Set(['Choose a track', 'No track selected', 'Unknown artist', 'Untitled track', 'Untitled playlist'])

function translateText(node, text) {
  const el = node.parentElement
  if (el?.closest(USER_CONTENT) && !PLACEHOLDERS.has(text.trim())) return text
  return t(text)
}

function localizeText(node) {
  if (skipped(node)) return
  const current = node.data
  if (writtenText.get(node) !== current) sourceText.set(node, current)
  const next = translateText(node, sourceText.get(node))
  if (next !== current) {
    writtenText.set(node, next)
    node.data = next
  } else {
    writtenText.set(node, current)
  }
}

function localizeAttributes(el) {
  if (skipped(el)) return
  let sources = sourceAttrs.get(el)
  let written = writtenAttrs.get(el)
  if (!sources) {
    sources = {}
    written = {}
    sourceAttrs.set(el, sources)
    writtenAttrs.set(el, written)
  }
  for (const name of ATTRIBUTES) {
    if (!el.hasAttribute(name)) continue
    const current = el.getAttribute(name)
    if (written[name] !== current) sources[name] = current
    const next = t(sources[name])
    written[name] = next
    if (next !== current) el.setAttribute(name, next)
  }
}

function localizeTree(root) {
  if (root.nodeType === Node.TEXT_NODE) {
    localizeText(root)
    return
  }
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return
  if (root.nodeType === Node.ELEMENT_NODE) localizeAttributes(root)
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE) localizeText(node)
    else localizeAttributes(node)
  }
}

function applyLanguage() {
  document.documentElement.lang = language
  for (const root of roots) localizeTree(root)
  for (const callback of listeners) callback(language)
}

/**
 * root の中の文言を訳し、以後の書き換えも見張る。
 * 窓ごとに 1 回呼ぶ（メインは main.js、ミニは mini.js）。
 */
export function localize(root = document.body) {
  roots.add(root)
  if (!observer) {
    observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'characterData') localizeText(record.target)
        else if (record.type === 'attributes') localizeAttributes(record.target)
        else record.addedNodes.forEach((node) => localizeTree(node))
      }
    })
  }
  observer.observe(root, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ATTRIBUTES
  })

  // ほかの窓（メイン / ミニ）で言語を変えたら、こちらも追従する
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) return
    const next = readLanguage()
    if (next === language) return
    language = next
    applyLanguage()
  })

  applyLanguage()
}
