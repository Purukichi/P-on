import './styles/index.css'
import { AudioEngine } from './core/AudioEngine.js'
import { Library } from './core/Library.js'
import { PlayQueue } from './core/PlayQueue.js'
import { Theme } from './core/Theme.js'
import { DropZones } from './ui/DropZones.js'
import { NameDialog } from './ui/NameDialog.js'
import { NowPlaying } from './ui/NowPlaying.js'
import { PlaylistShelf } from './ui/PlaylistShelf.js'
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
const shelf = new PlaylistShelf(root).mount()
const editor = new TrackEditor(root).mount()
const nameDialog = new NameDialog(root).mount()
const dropZones = new DropZones(root).mount()

/** 右カラムに何を出しているか @type {{type: 'library'} | {type: 'playlist', id: string}} */
let view = { type: 'library' }

// ---- 表示 ----------------------------------------------------------------

/** 今の view に対応する曲の並びを返す */
function tracksForView() {
  return view.type === 'library' ? library.tracks : library.tracksOfPlaylist(view.id)
}

function currentViewName() {
  if (view.type === 'library') return 'ライブラリ'
  return library.getPlaylist(view.id)?.name ?? 'プレイリスト'
}

function render() {
  // 選択中のプレイリストが消えていたらライブラリへ戻す
  if (view.type === 'playlist' && !library.getPlaylist(view.id)) view = { type: 'library' }

  const tracks = tracksForView()

  pick(root, 'context-label').textContent = currentViewName()

  trackList.render({
    title: currentViewName(),
    mode: view.type,
    tracks,
    emptyMessage:
      view.type === 'library'
        ? '音源ファイルをウィンドウにドラッグすると取り込めます'
        : '曲をこのプレイリストにドラッグすると追加されます'
  })
  trackList.setActive(queue.current?.id ?? null)

  shelf.render(library.playlists, {
    view,
    libraryCount: library.tracks.length,
    coverOf: (playlistId) =>
      library.tracksOfPlaylist(playlistId).find((track) => track.hasCover)?.coverUrl ?? null
  })

  nowPlaying.setNavigation({ hasPrevious: queue.hasPrevious, hasNext: queue.hasNext })
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
  nowPlaying.setNavigation({ hasPrevious: queue.hasPrevious, hasNext: queue.hasNext })
}

/** リストの曲をクリックしたとき：その一覧をまるごとキューにして、そこから再生する */
function playFromView(trackId) {
  const tracks = tracksForView()
  const index = tracks.findIndex((track) => track.id === trackId)
  if (index < 0) return
  playTrack(queue.replace(tracks, index))
}

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

// タグに長さが入っていなかった曲は、再生時に判明した値を library.json へ書き戻す
engine.on('duration-change', ({ track, duration }) => {
  if (!track || !Number.isFinite(duration) || duration <= 0) return
  const stored = library.getTrack(track.id)
  if (stored && !Number.isFinite(stored.duration)) library.updateTrack(track.id, { duration })
})

queue.on('change', () => {
  nowPlaying.setNavigation({ hasPrevious: queue.hasPrevious, hasNext: queue.hasNext })
})

// ---- 配線: リスト / プレイリスト ------------------------------------------

trackList.on('play', (trackId) => playFromView(trackId))

trackList.on('edit', (trackId) => {
  const track = library.getTrack(trackId)
  if (track) editor.open(track)
})

trackList.on('detach', async (trackId) => {
  if (view.type !== 'playlist') return
  await library.removeFromPlaylist(view.id, trackId)
})

shelf.on('select', (next) => {
  view = next
  render()
})

shelf.on('create', async () => {
  const name = await nameDialog.ask({ heading: '新しいプレイリスト', confirmLabel: '作成' })
  if (!name) return
  const id = await library.createPlaylist(name)
  if (id) {
    view = { type: 'playlist', id }
    render()
  }
})

shelf.on('rename', async (playlistId) => {
  const playlist = library.getPlaylist(playlistId)
  if (!playlist) return
  const name = await nameDialog.ask({
    heading: 'プレイリスト名を変更',
    value: playlist.name,
    confirmLabel: '変更'
  })
  if (name) await library.renamePlaylist(playlistId, name)
})

shelf.on('delete', async (playlistId) => {
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
  if (startedTrack) playTrack(startedTrack)

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
}
themeButton.addEventListener('click', () => theme.toggle())
theme.on('change', renderTheme)
renderTheme()

window.addEventListener('keydown', (event) => {
  if (event.code !== 'Space') return
  // 入力中やダイアログ操作中は邪魔しない
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
    views: { nowPlaying, trackList, shelf, editor, nameDialog }
  }
}
