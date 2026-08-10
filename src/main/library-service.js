import { basename, extname, join, resolve, sep } from 'node:path'
import { copyFile, cp, mkdir, rm, rmdir, unlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { AUDIO_EXTENSIONS } from '../shared/ipc-channels.js'
import { isSupportedImageExtension, readFormat, readMetadata } from './metadata.js'
import { toMediaUrl } from './media-protocol.js'
import {
  AUDIO_DIR,
  COVER_DIR,
  audioDir,
  coverDir,
  ensureDirectories,
  flushWrites,
  libraryFile,
  libraryRoot,
  load,
  resolveInLibrary,
  setLibraryRoot,
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
  const albumCovers = Object.fromEntries(
    Object.entries(data.albumCovers).map(([album, file]) => [
      album,
      { coverFile: file, coverUrl: toMediaUrl(file) }
    ])
  )

  return {
    libraryPath: libraryRoot(),
    tracks: data.tracks.map((track) => toTrackDto(track, data.albumCovers)),
    playlists: data.playlists.map(toPlaylistDto),
    albumCovers,
    /** アルバム名 -> アルバムのアーティスト。曲ごとの artist とは別管理 */
    albumArtists: { ...data.albumArtists }
  }
}

function toTrackDto(track, albumCovers) {
  const albumCoverFile = track.album ? (albumCovers[track.album] ?? null) : null
  return {
    ...track,
    audioUrl: toMediaUrl(track.audioFile),
    /** その曲だけのジャケット（シングル用）。無ければ null */
    ownCoverUrl: toMediaUrl(track.coverFile),
    /** 所属アルバムのジャケット。無ければ null */
    albumCoverUrl: toMediaUrl(albumCoverFile)
  }
}

function toPlaylistDto(playlist) {
  return {
    ...playlist,
    trackIds: [...playlist.trackIds],
    /** プレイリストに直接設定したジャケット。無ければ収録曲のものが使われる */
    coverUrl: toMediaUrl(playlist.coverFile)
  }
}

// ---- 保存先 --------------------------------------------------------------

/** いまライブラリを置いている場所 */
export function libraryLocation() {
  return libraryRoot()
}

/**
 * 選ばれたフォルダを保存先にできるか調べる。
 * ダイアログの出し分けに使うので、投げずに理由を返す。
 *
 * @returns {{ok: boolean, reason?: string, hasLibrary: boolean}}
 */
export function inspectLocation(target) {
  const current = libraryRoot()
  const hasLibrary = existsSync(join(target, 'library.json'))

  if (isSamePath(current, target)) {
    return { ok: false, reason: 'いまと同じ場所です', hasLibrary }
  }
  /*
   * 入れ子だと、移動元のフォルダを消すときに移動先ごと巻き添えにしたり、
   * コピーが自分自身を飲み込んで終わらなくなったりする。
   */
  if (isInside(target, current) || isInside(current, target)) {
    return {
      ok: false,
      reason: 'いまの保存先と入れ子になっているフォルダは選べません',
      hasLibrary
    }
  }

  return { ok: true, hasLibrary }
}

/**
 * 保存先を切り替える。
 *
 * mode:
 *   'move' … 中身を移してから元を消す
 *   'copy' … 中身を写して元も残す
 *   'none' … ファイルは動かさず、見る場所だけ変える
 *
 * 順番が肝。先に写しきってから切り替えるので、
 * 途中で失敗しても元のライブラリは無傷のまま残る。
 *
 * @returns {Promise<{snapshot: object, libraryPath: string, warning: string|null}>}
 */
export async function changeLibraryLocation(nextRoot, mode) {
  const current = libraryRoot()
  const check = inspectLocation(nextRoot)
  if (!check.ok) throw new Error(check.reason)

  // 書きかけの library.json を移動元に取り残さない
  await flushWrites()
  await mkdir(nextRoot, { recursive: true })

  if (mode !== 'none') {
    if (check.hasLibrary) {
      throw new Error('選んだフォルダにはすでに P-on のライブラリがあります')
    }
    await copyLibraryContents(current, nextRoot)
  }

  setLibraryRoot(nextRoot)
  await ensureDirectories()

  const warning = mode === 'move' ? await removeLibraryContents(current) : null
  return { snapshot: await snapshot(), libraryPath: nextRoot, warning }
}

/** library.json / audio / covers を丸ごと写す。無いものは黙って飛ばす */
async function copyLibraryContents(from, to) {
  const source = libraryFile()
  if (existsSync(source)) await copyFile(source, join(to, 'library.json'))

  for (const directory of [AUDIO_DIR, COVER_DIR]) {
    const origin = join(from, directory)
    if (!existsSync(origin)) continue
    await cp(origin, join(to, directory), { recursive: true })
  }
}

/**
 * 移動元の中身を片づける。
 * 消せなかった場合でも切り替え自体は済んでいるので、投げずに文言で返す。
 * （再生していたファイルを OS が掴んだままだと、Windows は削除を断る）
 */
async function removeLibraryContents(root) {
  const leftovers = []

  for (const entry of ['library.json', AUDIO_DIR, COVER_DIR]) {
    try {
      await rm(join(root, entry), { recursive: true, force: true })
    } catch {
      leftovers.push(entry)
    }
  }

  // 空になっていれば入れ物ごと消す。rmdir は中身が残っていれば失敗するので、
  // 同居している他のファイルを巻き添えにする心配がない
  try {
    await rmdir(root)
  } catch {
    /* 空でなければ残しておく。中身は上で消してある */
  }

  if (leftovers.length === 0) return null
  return `移動は済みましたが、元のフォルダの ${leftovers.join(' / ')} を削除できませんでした（${root}）`
}

function normalizePath(value) {
  // Windows 向け。大文字小文字と末尾の区切りの違いを吸収する
  return resolve(value).replace(/[\\/]+$/, '').toLowerCase()
}

function isSamePath(a, b) {
  return normalizePath(a) === normalizePath(b)
}

/** child が parent の中にあるか */
function isInside(child, parent) {
  const from = normalizePath(parent) + sep.toLowerCase()
  return normalizePath(child).startsWith(from)
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
  /** このインポートで決まったアルバムジャケット。album -> 相対パス */
  const stagedAlbumCovers = {}

  const existing = await load()
  // すでにジャケットが決まっているアルバムは、埋め込み画像を取り込まない
  const albumsWithCover = new Set(Object.keys(existing.albumCovers))

  for (const sourcePath of filePaths) {
    const extension = extname(sourcePath).toLowerCase()
    if (!AUDIO_EXTENSIONS.includes(extension.slice(1))) {
      skipped.push(basename(sourcePath))
      continue
    }

    try {
      const { track, coverFile } = await stageOne(sourcePath, extension, {
        wantsCover: (album) => !album || !albumsWithCover.has(album)
      })

      if (coverFile) {
        if (track.album) {
          /*
           * アルバムに属する曲の埋め込み画像は、曲個別ではなくアルバム共通として持つ。
           * こうしておくと「アルバムのジャケットを差し替える」操作が全曲に効き、
           * シングルとしても出ている曲だけを別画像にしたいときは
           * その曲に個別ジャケットを設定して上書きする、という住み分けになる。
           */
          stagedAlbumCovers[track.album] = coverFile
          albumsWithCover.add(track.album)
        } else {
          track.coverFile = coverFile
        }
      }

      staged.push(track)
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
      for (const [album, coverFile] of Object.entries(stagedAlbumCovers)) {
        data.albumCovers[album] ??= coverFile
      }
    })
  }

  return { snapshot: await snapshot(), added, skipped }
}

/** ファイルのコピーとタグ読み取りまでを済ませ、library.json に入れるレコードを組み立てる */
async function stageOne(sourcePath, extension, { wantsCover }) {
  const originalName = basename(sourcePath, extension)
  const meta = await readMetadata(sourcePath)

  // フォルダを開いたときに何の曲か分かるよう、元のファイル名を活かして保存する
  const audioName = await uniqueName(audioDir(), sanitize(originalName), extension)
  await copyFile(sourcePath, join(audioDir(), audioName))

  let coverFile = null
  if (meta.cover && wantsCover(meta.album)) {
    const base = meta.album ? `album - ${sanitize(meta.album)}` : sanitize(originalName)
    const coverName = await uniqueName(coverDir(), base, meta.cover.extension)
    await writeFile(join(coverDir(), coverName), meta.cover.data)
    coverFile = `${COVER_DIR}/${coverName}`
  }

  return {
    track: {
      id: randomUUID(),
      title: meta.title ?? originalName,
      artist: meta.artist,
      album: meta.album,
      duration: meta.duration,
      format: meta.format,
      audioFile: `${AUDIO_DIR}/${audioName}`,
      coverFile: null,
      addedAt: new Date().toISOString()
    },
    coverFile
  }
}

/**
 * format を持っていない古いレコードを埋める。
 * フォーマット表示を後から足したので、既存のライブラリにも効くようにしている。
 * 中身を消したり作り直したりはしない。
 */
export async function backfillFormats() {
  const data = await load()
  const missing = data.tracks.filter((track) => !track.format)
  if (missing.length === 0) return { snapshot: await snapshot(), filled: 0 }

  /** @type {Map<string, object|null>} */
  const results = new Map()
  for (const track of missing) {
    const absolute = resolveInLibrary(track.audioFile)
    results.set(track.id, absolute ? await readFormat(absolute) : null)
  }

  await update((current) => {
    for (const track of current.tracks) {
      const format = results.get(track.id)
      if (format) track.format = format
    }
  })

  return { snapshot: await snapshot(), filled: [...results.values()].filter(Boolean).length }
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

/**
 * 複数の曲にまとめて同じアルバム名を書き込む。
 * タグが入っていない音源はシングル扱いになるので、
 * 後から選んでアルバムにまとめ直すための入口。
 *
 * @param {string[]} trackIds
 * @param {string|null} albumName null を渡すとアルバムから外してシングルに戻す
 */
export async function setAlbumForTracks(trackIds, albumName) {
  const album = normalize(albumName)
  const ids = new Set(trackIds)

  await update((data) => {
    for (const track of data.tracks) {
      if (ids.has(track.id)) track.album = album
    }
  })

  return snapshot()
}

/**
 * 複数の曲にまとめて同じアーティストを書き込む。
 * アルバム単位でアーティストを付け直すための入口で、
 * 「A, B」のような連名もそのまま入れられる（表示や検索の側で分解される）。
 *
 * @param {string[]} trackIds
 * @param {string|null} artist null を渡すと未設定に戻す
 */
export async function setArtistForTracks(trackIds, artist) {
  const value = normalize(artist)
  const ids = new Set(trackIds)

  await update((data) => {
    for (const track of data.tracks) {
      if (ids.has(track.id)) track.artist = value
    }
  })

  return snapshot()
}

/**
 * アルバムのアーティストを設定する。
 * 収録曲の artist には一切触らない。
 * アルバムとしての表記（V.A. など）と、曲ごとの演奏者を別々に持たせるための入口。
 *
 * @param {string} albumName
 * @param {string|null} artist null を渡すと未設定に戻す（収録曲から拾い直した表示になる）
 */
export async function setAlbumArtist(albumName, artist) {
  const data = await load()
  if (!data.tracks.some((track) => track.album === albumName)) {
    throw new Error('アルバムが見つかりません')
  }

  const value = normalize(artist)

  await update((current) => {
    if (value) current.albumArtists[albumName] = value
    else delete current.albumArtists[albumName]
  })

  return snapshot()
}

/**
 * アルバム名を変える。
 * 収録曲の album を書き換えるだけでなく、
 * アルバム名をキーに持っているジャケットとアーティストも一緒に付け替える。
 * （曲だけ書き換えると、その 2 つが宙に浮いて設定が消えてしまう）
 */
export async function renameAlbum(oldName, newName) {
  const album = normalize(newName)
  if (!album) throw new Error('アルバム名を入力してください')

  await update((data) => {
    for (const track of data.tracks) {
      if (track.album === oldName) track.album = album
    }

    const cover = data.albumCovers[oldName]
    if (cover) {
      delete data.albumCovers[oldName]
      // 移動先にすでに設定があるときは、そちらを尊重して上書きしない
      data.albumCovers[album] ??= cover
    }

    const artist = data.albumArtists[oldName]
    if (artist) {
      delete data.albumArtists[oldName]
      data.albumArtists[album] ??= artist
    }
  })

  return snapshot()
}

/**
 * アルバムのジャケットを差し替える。imagePath が null なら削除。
 * 曲ごとの coverFile とは独立しているので、
 * アルバムに入っている曲がシングルとしても出ている場合は
 * その曲側に別のジャケットを設定できる。
 */
export async function setAlbumCover(albumName, imagePath) {
  await ensureDirectories()

  const data = await load()
  if (!data.tracks.some((track) => track.album === albumName)) {
    throw new Error('アルバムが見つかりません')
  }

  let nextCoverFile = null

  if (imagePath) {
    const extension = extname(imagePath).toLowerCase()
    if (!isSupportedImageExtension(extension)) {
      throw new Error('対応していない画像形式です (jpg / png / webp / gif / bmp)')
    }
    const coverName = await uniqueName(coverDir(), `album - ${sanitize(albumName)}`, extension)
    await copyFile(imagePath, join(coverDir(), coverName))
    nextCoverFile = `${COVER_DIR}/${coverName}`
  }

  const previousCoverFile = data.albumCovers[albumName] ?? null

  await update((current) => {
    if (nextCoverFile) current.albumCovers[albumName] = nextCoverFile
    else delete current.albumCovers[albumName]
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

  /** @type {string[]} */
  const orphanedCovers = []

  await update((current) => {
    current.tracks = current.tracks.filter((t) => t.id !== trackId)
    for (const playlist of current.playlists) {
      playlist.trackIds = playlist.trackIds.filter((id) => id !== trackId)
    }

    // アルバム最後の 1 曲が消えたら、そのアルバムのジャケットとアーティストも道連れにする
    if (track.album && !current.tracks.some((t) => t.album === track.album)) {
      const albumCover = current.albumCovers[track.album]
      if (albumCover) orphanedCovers.push(albumCover)
      delete current.albumCovers[track.album]
      delete current.albumArtists[track.album]
    }
  })

  await removeFile(track.audioFile)
  await removeFile(track.coverFile)
  for (const cover of orphanedCovers) await removeFile(cover)

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

/**
 * プレイリストのジャケットを差し替える。imagePath が null なら削除。
 * アルバムと違って名前ではなく id に紐づけているので、改名しても外れない。
 */
export async function setPlaylistCover(playlistId, imagePath) {
  await ensureDirectories()

  const data = await load()
  const playlist = data.playlists.find((p) => p.id === playlistId)
  if (!playlist) throw new Error('プレイリストが見つかりません')

  let nextCoverFile = null

  if (imagePath) {
    const extension = extname(imagePath).toLowerCase()
    if (!isSupportedImageExtension(extension)) {
      throw new Error('対応していない画像形式です (jpg / png / webp / gif / bmp)')
    }
    const coverName = await uniqueName(coverDir(), `playlist - ${sanitize(playlist.name)}`, extension)
    await copyFile(imagePath, join(coverDir(), coverName))
    nextCoverFile = `${COVER_DIR}/${coverName}`
  }

  const previousCoverFile = playlist.coverFile ?? null

  await update((current) => {
    const target = current.playlists.find((p) => p.id === playlistId)
    if (target) target.coverFile = nextCoverFile
  })

  await removeFile(previousCoverFile)
  return snapshot()
}

export async function deletePlaylist(playlistId) {
  const data = await load()
  // 入れ物を消したらジャケットも道連れにする（曲そのものは残す）
  const coverFile = data.playlists.find((p) => p.id === playlistId)?.coverFile ?? null

  await update((current) => {
    current.playlists = current.playlists.filter((p) => p.id !== playlistId)
  })

  await removeFile(coverFile)
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
