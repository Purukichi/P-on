import './styles/index.css'
import { AudioEngine } from './core/AudioEngine.js'
import { Library } from './core/Library.js'
import { PlayQueue } from './core/PlayQueue.js'
import { Theme } from './core/Theme.js'
import { CollectionType, buildCollections, findCollection } from './core/Collections.js'
import { CollectionShelf } from './ui/CollectionShelf.js'
import { DropZones } from './ui/DropZones.js'
import { NameDialog } from './ui/NameDialog.js'
import { NowPlaying } from './ui/NowPlaying.js'
import { TrackEditor } from './ui/TrackEditor.js'
import { TrackList } from './ui/TrackList.js'
import { pick } from './ui/dom.js'

const root = document.querySelector('#app')

const theme = new Theme()
const engine = new AudioEngine({ volume: 0.8 })
const library = new Library()
const queue = new PlayQueue()

const nowPlaying = new NowPlaying(root, { engine }).mount()
const trackList = new TrackList(root).mount()
const shelf = new CollectionShelf(root).mount()
const editor = new TrackEditor(root).mount()
const nameDialog = new NameDialog(root).mount()
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
 * リストのプレビューは既定では出さない。
 * アルバム / プレイリストを鳴らしているとき、
 * あるいはドロップで複数曲がキューに入っているときだけ開く。
 */
function shouldShowList() {
  return Boolean(activeCollection()?.showsTrackList) || queue.tracks.length > 1
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

shelf.on('add-track', async ({ playlistId, trackId }) => {
  const playlist = library.getPlaylist(playlistId)
  if (playlist?.includes(trackId)) {
    setStatus('その曲はすでに追加されています')
    return
  }
  await library.addToPlaylist(playlistId, [trackId])
  setStatus(`「${playlist?.name ?? 'プレイリスト'}」に追加しました`)
})

// ---- 配線: 取り込み / 削除 ------------------------------------------------

pick(root, 'add-tracks').addEventListener('click', async () => {
  handleImported(await library.pickFiles())
})

pick(root, 'open-folder').addEventListener('click', () => library.openFolder())

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

dropZones.on('trash-track', async (trackId) => {
  const track = library.getTrack(trackId)
  if (!track) return

  const ok = await window.hamon.confirm({
    message: `「${track.displayTitle}」を削除しますか？`,
    detail: '音源ファイルとジャケット画像がライブラリから完全に削除されます。元に戻せません。',
    confirmLabel: '削除'
  })
  if (!ok) return

  const wasPlaying = engine.track?.id === trackId
  await library.deleteTrack(trackId)
  queue.remove(trackId)

  if (wasPlaying) {
    engine.unload()
    const next = queue.current
    if (next) playTrack(next, { autoplay: false })
  }
  setStatus(`「${track.displayTitle}」を削除しました`)
})

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
  const trackId = engine.track?.id
  if (!trackId) {
    setStatus('先に曲を再生してから、ジャケットをドロップしてください', { tone: 'error' })
    return
  }
  await library.setCoverFromPath(trackId, imagePath)
  setStatus('ジャケットを設定しました')
})

// ---- 配線: テーマ / キーボード --------------------------------------------

const themeButton = pick(root, 'theme-toggle')
function renderTheme() {
  themeButton.setAttribute('aria-pressed', String(theme.isNight))
  themeButton.title = theme.isNight ? 'ライトモードに戻す' : 'ナイトモードにする'

  // OS が描くタイトルバーのボタン area も本文と同じ色にする
  const styles = getComputedStyle(document.documentElement)
  window.hamon.windows.setTitleBar({
    color: toHex(styles.getPropertyValue('--color-bg')),
    symbolColor: toHex(styles.getPropertyValue('--color-text'))
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
    views: { nowPlaying, trackList, shelf, editor, nameDialog }
  }
}
