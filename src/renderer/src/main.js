import './styles/index.css'
import { AudioEngine } from './core/AudioEngine.js'
import { Library } from './core/Library.js'
import { PlayQueue } from './core/PlayQueue.js'
import { Theme } from './core/Theme.js'
import { applyAppearance } from './core/Settings.js'
import { CollectionType, buildCollections, findCollection } from './core/Collections.js'
import { CollectionShelf } from './ui/CollectionShelf.js'
import { DropZones } from './ui/DropZones.js'
import { NameDialog } from './ui/NameDialog.js'
import { NowPlaying } from './ui/NowPlaying.js'
import { SettingsDialog } from './ui/SettingsDialog.js'
import { TrackEditor } from './ui/TrackEditor.js'
import { TrackList } from './ui/TrackList.js'
import { pick } from './ui/dom.js'

const root = document.querySelector('#app')

const theme = new Theme()
applyAppearance()
const engine = new AudioEngine({ volume: 0.8 })
const library = new Library()
const queue = new PlayQueue()

const nowPlaying = new NowPlaying(root, { engine }).mount()
const trackList = new TrackList(root).mount()
const shelf = new CollectionShelf(root).mount()
const editor = new TrackEditor(root).mount()
const nameDialog = new NameDialog(root).mount()
const settingsDialog = new SettingsDialog(root, { theme }).mount()
const dropZones = new DropZones(root).mount()

/** @type {import('./core/Collections.js').Collection[]} */
let collections = []
/** いま再生している単位（アルバム / プレイリスト / シングル） */
let activeCollectionId = null

// ---- 表示 ----------------------------------------------------------------

function activeCollection() {
  return findCollection(collections, activeCollectionId)
}

/**
 * リストのプレビュー。
 * キューに曲が入っていれば、シングル 1 曲でも開く。
 * （1 曲のときも、そこから編集や削除ができたほうが都合がよい）
 */
function shouldShowList() {
  return queue.tracks.length > 0
}

function render() {
  collections = buildCollections(library)

  if (activeCollectionId && !activeCollection()) activeCollectionId = null

  const current = activeCollection()
  const listVisible = shouldShowList()

  root.dataset.list = listVisible ? 'visible' : 'hidden'
  pick(root, 'context-label').textContent = current ? current.name : ''
  pick(root, 'shelf-empty').hidden = collections.length > 0

  if (listVisible) {
    trackList.render({
      title: current?.name ?? '再生キュー',
      mode: current?.type === CollectionType.PLAYLIST ? 'playlist' : 'library',
      tracks: queue.tracks,
      emptyMessage: ''
    })
    trackList.setActive(queue.current?.id ?? null)
  }

  shelf.render(collections, { activeCollectionId })
  nowPlaying.setNavigation({ hasPrevious: queue.hasPrevious, hasNext: queue.hasNext })
  publishPlayerState()
}

let statusTimer = null
function setStatus(message, { tone = 'info', duration = 4000 } = {}) {
  const status = pick(root, 'status')
  clearTimeout(statusTimer)

  if (!message) {
    status.hidden = true
    return
  }
  status.textContent = message
  status.dataset.tone = tone
  status.hidden = false
  statusTimer = setTimeout(() => {
    status.hidden = true
  }, duration)
}

// ---- 再生 ----------------------------------------------------------------

function playTrack(track, { autoplay = true } = {}) {
  if (!track) return
  engine.load(track, { autoplay })
  trackList.setActive(track.id)
  render()
}

/** 棚のカード（またはポップアップの曲）から再生を始める */
function playCollection(collectionId, trackId = null) {
  const collection = findCollection(collections, collectionId)
  if (!collection || collection.tracks.length === 0) return

  const index = trackId ? collection.tracks.findIndex((track) => track.id === trackId) : 0
  activeCollectionId = collectionId
  playTrack(queue.replace(collection.tracks, Math.max(index, 0)))
}

// ---- ミニプレイヤーとの同期 ------------------------------------------------

/** 音を鳴らしているのはこの画面だけ。状態をミニプレイヤーへ流す */
function publishPlayerState() {
  const track = engine.track
  window.hamon.player.publishState({
    trackId: track?.id ?? null,
    title: track?.displayTitle ?? '',
    artist: track?.displayArtist ?? '',
    coverUrl: track?.coverUrl ?? null,
    isPlaying: engine.isPlaying,
    currentTime: engine.currentTime,
    duration: engine.duration,
    progress: engine.progress,
    volume: engine.volume,
    hasNext: queue.hasNext,
    hasPrevious: queue.hasPrevious
  })
}

window.hamon.player.onCommand(({ type, value } = {}) => {
  switch (type) {
    case 'toggle':
      engine.toggle()
      break
    case 'next':
      playTrack(queue.next())
      break
    case 'previous':
      if (engine.currentTime > 3) engine.seek(0)
      else playTrack(queue.previous())
      break
    case 'seek-progress':
      engine.seekToProgress(value)
      break
    case 'volume':
      engine.volume = value
      break
  }
})

window.hamon.player.onStateRequested(() => publishPlayerState())

pick(root, 'open-mini').addEventListener('click', () => {
  publishPlayerState()
  window.hamon.windows.openMini()
})

// ---- 配線: トランスポート ------------------------------------------------

nowPlaying.on('toggle', () => engine.toggle())
nowPlaying.on('stop', () => engine.stop())
nowPlaying.on('next', () => playTrack(queue.next()))
nowPlaying.on('previous', () => {
  // 3秒以上再生していたら曲頭に戻す（よくあるプレイヤーの挙動）
  if (engine.currentTime > 3) engine.seek(0)
  else playTrack(queue.previous())
})

engine.on('ended', () => {
  const next = queue.next()
  if (next) playTrack(next)
  else setStatus('キューの最後まで再生しました')
})

engine.on('error', (error) => setStatus(error.message, { tone: 'error' }))
engine.on('state-change', () => publishPlayerState())
engine.on('time-update', () => publishPlayerState())
engine.on('volume-change', () => publishPlayerState())

// タグに長さが入っていなかった曲は、再生時に判明した値を library.json へ書き戻す
engine.on('duration-change', ({ track, duration }) => {
  if (!track || !Number.isFinite(duration) || duration <= 0) return
  const stored = library.getTrack(track.id)
  if (stored && !Number.isFinite(stored.duration)) library.updateTrack(track.id, { duration })
})

queue.on('change', () => {
  nowPlaying.setNavigation({ hasPrevious: queue.hasPrevious, hasNext: queue.hasNext })
})

// ---- 配線: リスト / 棚 ---------------------------------------------------

trackList.on('play', (trackId) => playTrack(queue.jumpTo(trackId)))

trackList.on('edit', (trackId) => {
  const track = library.getTrack(trackId)
  if (track) editor.open(track)
})

// 編集モードで入力欄から離れたとき
trackList.on('update', async ({ trackId, patch }) => {
  await library.updateTrack(trackId, patch)
})

trackList.on('detach', async (trackId) => {
  const collection = activeCollection()
  if (collection?.type !== CollectionType.PLAYLIST) return
  await library.removeFromPlaylist(collection.sourceId, trackId)
})

shelf.on('play-collection', ({ collectionId, trackId }) => playCollection(collectionId, trackId))

shelf.on('create-playlist', async () => {
  const name = await nameDialog.ask({ heading: '新しいプレイリスト', confirmLabel: '作成' })
  if (!name) return
  await library.createPlaylist(name)
})

shelf.on('rename-playlist', async (playlistId) => {
  const playlist = library.getPlaylist(playlistId)
  if (!playlist) return
  const name = await nameDialog.ask({
    heading: 'プレイリスト名を変更',
    value: playlist.name,
    confirmLabel: '変更'
  })
  if (name) await library.renamePlaylist(playlistId, name)
})

shelf.on('delete-playlist', async (playlistId) => {
  const playlist = library.getPlaylist(playlistId)
  if (!playlist) return
  const ok = await window.hamon.confirm({
    message: `プレイリスト「${playlist.name}」を削除しますか？`,
    detail: '曲そのものはライブラリに残ります。',
    confirmLabel: '削除'
  })
  if (ok) await library.deletePlaylist(playlistId)
})

// アルバム共通のジャケット。曲ごとの設定とは独立している
shelf.on('album-cover', async (albumName) => {
  await library.pickAlbumCover(albumName)
})

shelf.on('rename-album', async (albumName) => {
  const collection = findCollection(collections, `album:${albumName}`)
  if (!collection) return
  const name = await nameDialog.ask({
    heading: 'アルバム名を変更',
    value: albumName,
    confirmLabel: '変更'
  })
  if (!name || name === albumName) return
  await library.setAlbumForTracks(
    collection.tracks.map((track) => track.id),
    name
  )
  activeCollectionId = `album:${name}`
  setStatus(`「${name}」に変更しました`)
})

// 右クリックメニューの「編集」
shelf.on('edit-collection', (collectionId) => {
  const collection = findCollection(collections, collectionId)
  const track = collection?.tracks[0]
  if (track) editor.open(track)
})

// 右クリックメニュー / ゴミ箱からの削除
shelf.on('delete-collection', (collectionId) => deleteCollection(collectionId))

// 複数選択してアルバム化 / プレイリスト化
shelf.on('group-selection', async ({ collectionIds, as }) => {
  const chosen = collectionIds
    .map((id) => findCollection(collections, id))
    .filter((collection) => collection && collection.type !== CollectionType.PLAYLIST)
  const trackIds = [...new Set(chosen.flatMap((c) => c.tracks.map((track) => track.id)))]

  if (trackIds.length === 0) {
    setStatus('まとめられる曲がありません', { tone: 'error' })
    return
  }

  const suggestion = chosen[0]?.name ?? ''

  if (as === 'album') {
    const name = await nameDialog.ask({
      heading: 'アルバムにまとめる',
      value: suggestion,
      confirmLabel: 'まとめる'
    })
    if (!name) return
    await library.setAlbumForTracks(trackIds, name)
    shelf.clearSelection()
    activeCollectionId = `album:${name}`
    setStatus(`「${name}」にまとめました（${trackIds.length}曲）`)
    return
  }

  const name = await nameDialog.ask({
    heading: 'プレイリストにする',
    value: suggestion,
    confirmLabel: '作成'
  })
  if (!name) return
  const playlistId = await library.createPlaylist(name)
  if (!playlistId) return
  await library.addToPlaylist(playlistId, trackIds)
  shelf.clearSelection()
  activeCollectionId = `playlist:${playlistId}`
  setStatus(`「${name}」を作成しました（${trackIds.length}曲）`)
})

shelf.on('add-track', async ({ playlistId, trackId }) => {
  const playlist = library.getPlaylist(playlistId)
  if (playlist?.includes(trackId)) {
    setStatus('その曲はすでに追加されています')
    return
  }
  await library.addToPlaylist(playlistId, [trackId])
  setStatus(`「${playlist?.name ?? 'プレイリスト'}」に追加しました`)
})

// アルバム / シングルを別のアルバム / シングルに重ねる -> 2 つでプレイリストを作る
shelf.on('merge-collections', async ({ sourceId, targetId }) => {
  const source = findCollection(collections, sourceId)
  const target = findCollection(collections, targetId)
  if (!source || !target) return

  const name = await nameDialog.ask({
    heading: 'この 2 つでプレイリストを作る',
    value: `${target.name} + ${source.name}`,
    confirmLabel: '作成'
  })
  if (!name) return

  const playlistId = await library.createPlaylist(name)
  if (!playlistId) return

  // 落とされた側を先頭に、掴んできた側を後ろに並べる
  const trackIds = [...target.tracks, ...source.tracks].map((track) => track.id)
  await library.addToPlaylist(playlistId, trackIds)

  activeCollectionId = `playlist:${playlistId}`
  render()
  setStatus(`「${name}」を作成しました（${trackIds.length}曲）`)
})

// コレクションをプレイリストに重ねる -> 束ごと追加
shelf.on('add-collection', async ({ playlistId, collectionId }) => {
  const playlist = library.getPlaylist(playlistId)
  const source = findCollection(collections, collectionId)
  if (!playlist || !source) return

  const trackIds = source.tracks.map((track) => track.id)
  const added = trackIds.filter((id) => !playlist.includes(id))
  if (added.length === 0) {
    setStatus('すべて追加済みです')
    return
  }

  await library.addToPlaylist(playlistId, trackIds)
  setStatus(`「${playlist.name}」に${added.length}曲を追加しました`)
})

// ---- 配線: 取り込み / 削除 ------------------------------------------------

pick(root, 'add-tracks').addEventListener('click', async () => {
  handleImported(await library.pickFiles())
})

pick(root, 'open-folder').addEventListener('click', () => library.openFolder())
pick(root, 'open-settings').addEventListener('click', () =>
  settingsDialog.open({ libraryPath: library.libraryPath })
)
settingsDialog.on('toggle-theme', () => theme.toggle())
settingsDialog.on('open-folder', () => library.openFolder())

dropZones.on('files-dropped', async (filePaths) => {
  setStatus(`${filePaths.length}件を取り込んでいます…`, { duration: 60000 })
  handleImported(await library.importFiles(filePaths))
})

/** 取り込み結果をキューに流し込む */
function handleImported({ added, skipped }) {
  if (added.length === 0) {
    setStatus(
      skipped.length > 0 ? '取り込めるファイルがありませんでした' : '取り込みをキャンセルしました',
      { tone: skipped.length > 0 ? 'error' : 'info' }
    )
    return
  }

  const startedTrack = queue.enqueue(added)
  if (startedTrack) {
    // ドロップで始まった再生は特定のコレクションに属さない
    activeCollectionId = null
    playTrack(startedTrack)
  } else {
    render()
  }

  const skippedNote = skipped.length > 0 ? `（${skipped.length}件はスキップ）` : ''
  setStatus(`${added.length}曲をキューに追加しました${skippedNote}`)
}

dropZones.on('trash-track', (trackId) => deleteTracks([trackId]))

// 棚のカードをゴミ箱へ落としたとき
dropZones.on('trash-collection', (collectionId) => deleteCollection(collectionId))

/**
 * コレクション単位の削除。
 * プレイリストは入れ物だけを消し、曲そのものは残す。
 * アルバム / シングルは収録曲の実ファイルごと消す。
 */
async function deleteCollection(collectionId) {
  const collection = findCollection(collections, collectionId)
  if (!collection) return

  if (collection.type === CollectionType.PLAYLIST) {
    const ok = await window.hamon.confirm({
      message: `プレイリスト「${collection.name}」を削除しますか？`,
      detail: '曲そのものはライブラリに残ります。',
      confirmLabel: '削除'
    })
    if (ok) await library.deletePlaylist(collection.sourceId)
    return
  }

  const label = collection.type === CollectionType.ALBUM ? 'アルバム' : '曲'
  const ok = await window.hamon.confirm({
    message: `${label}「${collection.name}」を削除しますか？`,
    detail: `${collection.size}曲の音源ファイルとジャケット画像がライブラリから完全に削除されます。元に戻せません。`,
    confirmLabel: '削除'
  })
  if (!ok) return

  await deleteTracks(
    collection.tracks.map((track) => track.id),
    { confirm: false, label: collection.name }
  )
}

/** 曲の実体を消す。再生中のものが含まれていたら空の状態に戻す */
async function deleteTracks(trackIds, { confirm = true, label = null } = {}) {
  const tracks = trackIds.map((id) => library.getTrack(id)).filter(Boolean)
  if (tracks.length === 0) return

  if (confirm) {
    const ok = await window.hamon.confirm({
      message: `「${tracks[0].displayTitle}」を削除しますか？`,
      detail: '音源ファイルとジャケット画像がライブラリから完全に削除されます。元に戻せません。',
      confirmLabel: '削除'
    })
    if (!ok) return
  }

  const hitPlaying = tracks.some((track) => track.id === engine.track?.id)

  for (const track of tracks) {
    await library.deleteTrack(track.id)
    queue.remove(track.id)
  }

  // 再生していたものを消したら、既定の空の状態に戻す
  if (hitPlaying) {
    engine.unload()
    queue.clear()
    activeCollectionId = null
    render()
  }

  setStatus(`「${label ?? tracks[0].displayTitle}」を削除しました`)
}

// ---- 配線: 楽曲情報の編集 -------------------------------------------------

editor.on('save', async ({ trackId, title, artist, album }) => {
  await library.updateTrack(trackId, { title, artist, album })
})

editor.on('pick-cover', async (trackId) => {
  await library.pickCover(trackId)
  editor.renderCover(library.getTrack(trackId))
})

editor.on('drop-cover', async ({ trackId, imagePath }) => {
  await library.setCoverFromPath(trackId, imagePath)
  editor.renderCover(library.getTrack(trackId))
})

editor.on('clear-cover', async (trackId) => {
  await library.clearCover(trackId)
  editor.renderCover(library.getTrack(trackId))
})

nowPlaying.on('cover-dropped', async ({ imagePath }) => {
  await setCoverOfCurrentTrack(imagePath)
})

// ジャケット未設定の枠をクリック -> 画像選択ダイアログ
nowPlaying.on('cover-request', async () => {
  const trackId = engine.track?.id
  if (!trackId) {
    setStatus('先に曲を選んでください', { tone: 'error' })
    return
  }
  await library.pickCover(trackId)
})

// ジャケット枠の外に画像が落ちたときも、再生中の曲のジャケットとして受け取る
dropZones.on('images-dropped', async (imagePaths) => {
  await setCoverOfCurrentTrack(imagePaths[0])
})

/**
 * ジャケット枠へのドロップ。
 * アルバムを鳴らしているときはアルバム共通のジャケットとして登録し、
 * それ以外はその曲だけのジャケットにする。
 */
async function setCoverOfCurrentTrack(imagePath) {
  const current = activeCollection()
  if (current?.type === CollectionType.ALBUM) {
    await library.setAlbumCoverFromPath(current.name, imagePath)
    setStatus(`「${current.name}」のジャケットを設定しました`)
    return
  }

  const trackId = engine.track?.id
  if (!trackId) {
    setStatus('先に曲を再生してから、ジャケットをドロップしてください', { tone: 'error' })
    return
  }
  await library.setCoverFromPath(trackId, imagePath)
  setStatus('ジャケットを設定しました')
}

// ---- 配線: テーマ / キーボード --------------------------------------------

const themeButton = pick(root, 'theme-toggle')
function renderTheme() {
  themeButton.setAttribute('aria-pressed', String(theme.isNight))
  themeButton.title = theme.isNight ? 'ライトモードに戻す' : 'ナイトモードにする'

  // ボタン領域は透明にしてアクリルを透かし、記号の色だけ本文に合わせる
  const styles = getComputedStyle(document.documentElement)
  window.hamon.windows.setTitleBar({
    color: '#00000000',
    symbolColor: toHex(styles.getPropertyValue('--color-text')),
    // アクリルの明暗もアプリのテーマに揃える（暗いままだと背景が灰色に沈む）
    theme: theme.isNight ? 'dark' : 'light'
  })
}

/** setTitleBarOverlay は #rrggbb しか受け付けないので変換する */
function toHex(cssColor) {
  const value = cssColor.trim()
  if (value.startsWith('#')) return value.length === 4 ? expandShortHex(value) : value.slice(0, 7)

  const match = value.match(/-?\d+(\.\d+)?/g)
  if (!match || match.length < 3) return '#ffffff'
  return `#${match
    .slice(0, 3)
    .map((n) => Math.round(Number(n)).toString(16).padStart(2, '0'))
    .join('')}`
}

function expandShortHex(value) {
  return `#${[...value.slice(1)].map((c) => c + c).join('')}`
}
themeButton.addEventListener('click', () => theme.toggle())
theme.on('change', renderTheme)
renderTheme()

window.addEventListener('keydown', (event) => {
  if (event.code !== 'Space') return
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
  if (document.querySelector('dialog[open]')) return
  event.preventDefault()
  engine.toggle()
})

// ---- ライブラリの更新を画面に反映 ------------------------------------------

library.on('change', () => {
  // キューが持っている Track を新しい実体へ貼り替える（ジャケット差し替えなどを反映するため）
  queue.refresh((id) => library.getTrack(id))

  const playing = engine.track ? library.getTrack(engine.track.id) : null
  if (playing) nowPlaying.renderTrack(playing)

  if (editor.isOpen && editor.trackId) editor.renderCover(library.getTrack(editor.trackId))

  render()
})

library.on('error', (error) => setStatus(error.message, { tone: 'error' }))

// ---- 起動 ----------------------------------------------------------------

await library.load()
render()

// フォーマット表示を後から足したので、既存のライブラリにも埋めて回る（データは消さない）
library.backfillFormats().then((filled) => {
  if (filled > 0) setStatus(`${filled}曲のフォーマット情報を読み込みました`)
})

// dev 時だけコンソールからいじれるようにしておく (本番ビルドでは除去される)
if (import.meta.env.DEV) {
  window.__hamon = {
    engine,
    library,
    queue,
    theme,
    dropZones,
    get collections() {
      return collections
    },
    playCollection,
    deleteTracks,
    deleteCollection,
    views: { nowPlaying, trackList, shelf, editor, nameDialog, settingsDialog }
  }
}
