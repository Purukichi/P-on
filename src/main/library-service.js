import { basename, extname, join } from 'node:path'
import { copyFile, unlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { AUDIO_EXTENSIONS } from '../shared/ipc-channels.js'
import { isSupportedImageExtension, readMetadata } from './metadata.js'
import { toMediaUrl } from './media-protocol.js'
import {
  AUDIO_DIR,
  COVER_DIR,
  audioDir,
  coverDir,
  ensureDirectories,
  libraryRoot,
  load,
  resolveInLibrary,
  update
} from './library-store.js'

/**
 * ライブラリの操作をまとめた層。
 * 変更系はすべて「操作したあと最新のスナップショットを返す」形にしてある。
 * レンダラー側は返ってきたスナップショットで状態を丸ごと差し替えるだけでよく、
 * 差分同期のズレを気にしなくて済む。
 */

// ---- 読み取り ------------------------------------------------------------

export async function snapshot() {
  const data = await load()
  return {
    libraryPath: libraryRoot(),
    tracks: data.tracks.map(toTrackDto),
    playlists: data.playlists.map(toPlaylistDto)
  }
}

function toTrackDto(track) {
  return {
    ...track,
    audioUrl: toMediaUrl(track.audioFile),
    coverUrl: toMediaUrl(track.coverFile)
  }
}

function toPlaylistDto(playlist) {
  return { ...playlist, trackIds: [...playlist.trackIds] }
}

// ---- 取り込み ------------------------------------------------------------

/**
 * 音源をライブラリフォルダへコピーし、タグを読んで登録する。
 *
 * @param {string[]} filePaths
 * @returns {Promise<{snapshot: object, added: string[], skipped: string[]}>}
 */
export async function importFiles(filePaths) {
  await ensureDirectories()

  const added = []
  const skipped = []
  const staged = []

  for (const sourcePath of filePaths) {
    const extension = extname(sourcePath).toLowerCase()
    if (!AUDIO_EXTENSIONS.includes(extension.slice(1))) {
      skipped.push(basename(sourcePath))
      continue
    }

    try {
      staged.push(await stageOne(sourcePath, extension))
    } catch (error) {
      console.error(`[library] ${sourcePath} の取り込みに失敗:`, error)
      skipped.push(basename(sourcePath))
    }
  }

  if (staged.length > 0) {
    await update((data) => {
      for (const track of staged) {
        data.tracks.push(track)
        added.push(track.id)
      }
    })
  }

  return { snapshot: await snapshot(), added, skipped }
}

/** ファイルのコピーとタグ読み取りまでを済ませ、library.json に入れるレコードを組み立てる */
async function stageOne(sourcePath, extension) {
  const originalName = basename(sourcePath, extension)
  const meta = await readMetadata(sourcePath)

  // フォルダを開いたときに何の曲か分かるよう、元のファイル名を活かして保存する
  const audioName = await uniqueName(audioDir(), sanitize(originalName), extension)
  await copyFile(sourcePath, join(audioDir(), audioName))

  let coverFile = null
  if (meta.cover) {
    const coverName = await uniqueName(coverDir(), sanitize(originalName), meta.cover.extension)
    await writeFile(join(coverDir(), coverName), meta.cover.data)
    coverFile = `${COVER_DIR}/${coverName}`
  }

  return {
    id: randomUUID(),
    title: meta.title ?? originalName,
    artist: meta.artist,
    album: meta.album,
    duration: meta.duration,
    audioFile: `${AUDIO_DIR}/${audioName}`,
    coverFile,
    addedAt: new Date().toISOString()
  }
}

// ---- 更新 ----------------------------------------------------------------

/** タイトル / アーティスト / アルバムの書き換え */
export async function updateTrack(trackId, patch) {
  await update((data) => {
    const track = data.tracks.find((t) => t.id === trackId)
    if (!track) throw new Error('トラックが見つかりません')

    if ('title' in patch) track.title = normalize(patch.title) ?? track.title
    if ('artist' in patch) track.artist = normalize(patch.artist)
    if ('album' in patch) track.album = normalize(patch.album)
    if ('duration' in patch && Number.isFinite(patch.duration)) track.duration = patch.duration
  })
  return snapshot()
}

/** ジャケット画像を差し替える。imagePath が null なら削除 */
export async function setCover(trackId, imagePath) {
  await ensureDirectories()

  const data = await load()
  const track = data.tracks.find((t) => t.id === trackId)
  if (!track) throw new Error('トラックが見つかりません')

  let nextCoverFile = null

  if (imagePath) {
    const extension = extname(imagePath).toLowerCase()
    if (!isSupportedImageExtension(extension)) {
      throw new Error('対応していない画像形式です (jpg / png / webp / gif / bmp)')
    }
    const base = sanitize(basename(track.audioFile, extname(track.audioFile)))
    const coverName = await uniqueName(coverDir(), base, extension)
    await copyFile(imagePath, join(coverDir(), coverName))
    nextCoverFile = `${COVER_DIR}/${coverName}`
  }

  const previousCoverFile = track.coverFile

  await update((current) => {
    const target = current.tracks.find((t) => t.id === trackId)
    if (target) target.coverFile = nextCoverFile
  })

  await removeFile(previousCoverFile)
  return snapshot()
}

// ---- 削除 ----------------------------------------------------------------

/** 音源とジャケットを実ファイルごと消し、プレイリストからも取り除く */
export async function deleteTrack(trackId) {
  const data = await load()
  const track = data.tracks.find((t) => t.id === trackId)
  if (!track) return snapshot()

  await update((current) => {
    current.tracks = current.tracks.filter((t) => t.id !== trackId)
    for (const playlist of current.playlists) {
      playlist.trackIds = playlist.trackIds.filter((id) => id !== trackId)
    }
  })

  await removeFile(track.audioFile)
  await removeFile(track.coverFile)

  return snapshot()
}

// ---- プレイリスト --------------------------------------------------------

export async function createPlaylist(name) {
  const playlist = {
    id: randomUUID(),
    name: normalize(name) ?? '新しいプレイリスト',
    trackIds: [],
    createdAt: new Date().toISOString()
  }
  await update((data) => {
    data.playlists.push(playlist)
  })
  return { snapshot: await snapshot(), playlistId: playlist.id }
}

export async function renamePlaylist(playlistId, name) {
  await update((data) => {
    const playlist = data.playlists.find((p) => p.id === playlistId)
    if (playlist) playlist.name = normalize(name) ?? playlist.name
  })
  return snapshot()
}

export async function deletePlaylist(playlistId) {
  await update((data) => {
    data.playlists = data.playlists.filter((p) => p.id !== playlistId)
  })
  return snapshot()
}

export async function addToPlaylist(playlistId, trackIds) {
  await update((data) => {
    const playlist = data.playlists.find((p) => p.id === playlistId)
    if (!playlist) throw new Error('プレイリストが見つかりません')
    for (const trackId of trackIds) {
      const exists = data.tracks.some((t) => t.id === trackId)
      if (exists && !playlist.trackIds.includes(trackId)) playlist.trackIds.push(trackId)
    }
  })
  return snapshot()
}

export async function removeFromPlaylist(playlistId, trackId) {
  await update((data) => {
    const playlist = data.playlists.find((p) => p.id === playlistId)
    if (playlist) playlist.trackIds = playlist.trackIds.filter((id) => id !== trackId)
  })
  return snapshot()
}

// ---- helpers -------------------------------------------------------------

function normalize(value) {
  const text = typeof value === 'string' ? value.trim() : ''
  return text.length > 0 ? text : null
}

const INVALID_FILENAME_CHARS = /["*/:<>?\\|]/g

/**
 * Windows のファイル名に使えない文字だけを落とす。
 * フォルダを開いたときに読めるよう、空白や日本語はそのまま残す。
 */
function sanitize(name) {
  const cleaned = String(name)
    .replace(INVALID_FILENAME_CHARS, '_')
    .replace(/[. ]+$/, '') // 末尾のドットと空白は Windows が嫌う
    .slice(0, 80)
    .trim()
  return cleaned.length > 0 ? cleaned : 'track'
}

/** 同名ファイルがあれば ` (2)` を足して衝突を避ける */
async function uniqueName(directory, base, extension) {
  let candidate = `${base}${extension}`
  let counter = 2
  while (existsSync(join(directory, candidate))) {
    candidate = `${base} (${counter})${extension}`
    counter += 1
  }
  return candidate
}

async function removeFile(relativePath) {
  if (!relativePath) return
  const absolute = resolveInLibrary(relativePath)
  if (!absolute) return
  try {
    await unlink(absolute)
  } catch (error) {
    if (error.code !== 'ENOENT') console.error(`[library] ${relativePath} を削除できません:`, error)
  }
}
