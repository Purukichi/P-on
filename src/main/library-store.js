import { join, resolve } from 'node:path'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { app } from 'electron'

/**
 * ライブラリの実体（フォルダ構成 + library.json）を受け持つ層。
 *
 *   Documents/HAMON/
 *   ├── library.json   メタデータ
 *   ├── audio/         取り込んだ音源
 *   └── covers/        ジャケット画像
 *
 * ここは「読む・書く・置き場所を知っている」だけ。
 * 取り込みや削除といった操作は library-service.js が担当する。
 */

/**
 * albumCovers はアルバム名 -> ジャケットの相対パス。
 * 曲ごとの coverFile とは別に持つことで、
 * 「アルバムのジャケット」と「シングルとして出た曲だけのジャケット」を分けて扱える。
 *
 * albumArtists も同じ考え方で、アルバム名 -> アーティスト名。
 * 曲ごとの artist とは独立しているので、
 * 「アルバムとしての表記（例: V.A. や バンド名）」と
 * 「収録曲ごとの演奏者」を別々に持てる。
 */
const EMPTY = { version: 1, tracks: [], playlists: [], albumCovers: {}, albumArtists: {} }

let rootPath = null
/** @type {typeof EMPTY | null} */
let cache = null
/** 書き込みを直列化するためのチェーン */
let writeChain = Promise.resolve()

export function libraryRoot() {
  /*
   * 既定は ドキュメント/HAMON。
   * ユーザーが保存先を変えたときは、その場所を userData の config.json に覚えておく。
   * HAMON_LIBRARY_DIR を渡すと、どちらよりも優先して差し替えられる。
   * 動作確認のときに本番のライブラリを触らずに済ませるための逃げ道。
   */
  rootPath ??=
    process.env.HAMON_LIBRARY_DIR?.trim() || readStoredRoot() || join(app.getPath('documents'), 'HAMON')
  return rootPath
}

/**
 * 保存先を切り替える。次の起動でもここを見る。
 * 読み込み済みの library.json は別物になるので捨てる。
 * ファイルの移動そのものは library-service が受け持つ。
 */
export function setLibraryRoot(nextRoot) {
  rootPath = nextRoot
  cache = null
  writeStoredRoot(nextRoot)
}

/**
 * 進行中の書き込みが終わるまで待つ。
 * 保存先を切り替える前に呼ばないと、書きかけの library.json が
 * 移動元に取り残されることがある。
 */
export function flushWrites() {
  return writeChain.catch(() => {})
}

/**
 * 保存先の設定はライブラリの外（userData）に置く。
 * ライブラリごと移しても付いてこないので、「どこを見るか」の記録として壊れない。
 */
function configFile() {
  return join(app.getPath('userData'), 'config.json')
}

function readStoredRoot() {
  try {
    const parsed = JSON.parse(readFileSync(configFile(), 'utf8'))
    const dir = typeof parsed.libraryDir === 'string' ? parsed.libraryDir.trim() : ''
    return dir.length > 0 ? dir : null
  } catch {
    // 未設定でも初回起動でも、既定の場所に落とせばよい
    return null
  }
}

function writeStoredRoot(dir) {
  try {
    mkdirSync(app.getPath('userData'), { recursive: true })
    writeFileSync(configFile(), JSON.stringify({ libraryDir: dir }, null, 2), 'utf8')
  } catch (error) {
    console.error('[library] 保存先を記録できませんでした:', error)
  }
}

export const AUDIO_DIR = 'audio'
export const COVER_DIR = 'covers'

export function audioDir() {
  return join(libraryRoot(), AUDIO_DIR)
}

export function coverDir() {
  return join(libraryRoot(), COVER_DIR)
}

export function libraryFile() {
  return join(libraryRoot(), 'library.json')
}

/** ライブラリ内の相対パスを絶対パスへ。外を指していたら null */
export function resolveInLibrary(relativePath) {
  const root = libraryRoot()
  const absolute = resolve(root, relativePath)
  return absolute === root || absolute.startsWith(root + '\\') || absolute.startsWith(root + '/')
    ? absolute
    : null
}

export async function ensureDirectories() {
  await mkdir(audioDir(), { recursive: true })
  await mkdir(coverDir(), { recursive: true })
}

/** library.json を読む（無ければ空のライブラリ） */
export async function load() {
  if (cache) return cache

  try {
    const parsed = JSON.parse(await readFile(libraryFile(), 'utf8'))
    cache = {
      version: parsed.version ?? 1,
      tracks: Array.isArray(parsed.tracks) ? parsed.tracks : [],
      playlists: Array.isArray(parsed.playlists) ? parsed.playlists : [],
      albumCovers: isPlainObject(parsed.albumCovers) ? parsed.albumCovers : {},
      albumArtists: isPlainObject(parsed.albumArtists) ? parsed.albumArtists : {}
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('[library] library.json を読めませんでした。空の状態で起動します:', error)
    }
    cache = structuredClone(EMPTY)
  }

  return cache
}

/**
 * ライブラリを書き換える。
 * mutator が受け取ったオブジェクトを直接いじってよい。
 * @param {(data: typeof EMPTY) => void | Promise<void>} mutator
 */
export function update(mutator) {
  writeChain = writeChain.then(async () => {
    const data = await load()
    await mutator(data)
    await persist(data)
    return data
  })
  return writeChain
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function persist(data) {
  await ensureDirectories()
  // 書き込み途中で落ちても library.json が壊れないよう、一時ファイル経由で差し替える
  const target = libraryFile()
  const temporary = `${target}.tmp`
  await writeFile(temporary, JSON.stringify(data, null, 2), 'utf8')
  await rename(temporary, target)
}
