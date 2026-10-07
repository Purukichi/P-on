import { createReadStream, createWriteStream } from 'node:fs'
import { readFile, writeFile, mkdir, rename, rm, access } from 'node:fs/promises'
import { resolve, join, sep } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import { pathToFileURL } from 'node:url'
import yauzl from 'yauzl'
import { EMPTY_CONTENT, safeContentPath, validateContent } from '../src/shared/bundled-content.js'

export async function sha256File(file) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

async function unpack(input, destination) {
  const zip = await new Promise((resolve, reject) => yauzl.open(input, { lazyEntries: true, strictFileNames: true }, (error, value) => error ? reject(error) : resolve(value)))
  const entries = new Set()
  let bytes = 0, count = 0
  await new Promise((done, reject) => {
    const fail = (error) => { zip.close(); reject(error) }
    zip.on('error', fail)
    zip.on('end', done)
    zip.on('entry', (entry) => {
      ;(async () => {
        const directory = entry.fileName.endsWith('/')
        const name = directory ? entry.fileName.slice(0, -1) : entry.fileName
        if (!safeContentPath(name) || entries.has(name.toLowerCase())) throw new Error(`ZIP内のパスが不正または重複: ${name}`)
        entries.add(name.toLowerCase())
        if (((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000) throw new Error('ZIP内のシンボリックリンクは使えません')
        if (entry.generalPurposeBitFlag & 1) throw new Error('暗号化ZIPは使えません')
        bytes += entry.uncompressedSize
        if (++count > 5000 || bytes > 2 * 1024 ** 3 || entry.uncompressedSize > 512 * 1024 ** 2) throw new Error('ZIPの展開サイズ上限を超えています')
        if (name === 'manifest.json' && entry.uncompressedSize > 2 * 1024 ** 2) throw new Error('manifest.jsonが大きすぎます')
        const target = join(destination, name)
        if (directory) await mkdir(target, { recursive: true })
        else {
          if (name !== 'manifest.json' && !name.startsWith('audio/') && !name.startsWith('covers/')) throw new Error(`不要なファイルがZIPに含まれています: ${name}`)
          await mkdir(resolve(target, '..'), { recursive: true })
          const stream = await new Promise((resolve, reject) => zip.openReadStream(entry, (error, stream) => error ? reject(error) : resolve(stream)))
          await pipeline(stream, createWriteStream(target, { flags: 'wx' }))
        }
        zip.readEntry()
      })().catch(fail)
    })
    zip.readEntry()
  })
}

export async function prepareContent(input, outputRoot = resolve('generated')) {
  outputRoot = resolve(outputRoot)
  const stage = join(outputRoot, `.content-${randomUUID()}`)
  const previous = join(outputRoot, `.previous-${randomUUID()}`)
  const target = join(outputRoot, 'content')
  // Every recursive cleanup/rename target is confined to the named output directory.
  const checked = (path) => {
    const absolute = resolve(path)
    if (!absolute.startsWith(outputRoot + sep)) throw new Error('生成先ディレクトリの外には書き込めません')
    return absolute
  }
  const remove = (path) => rm(checked(path), { recursive: true, force: true })
  await mkdir(checked(stage), { recursive: true })
  let backedUp = false
  try {
    await unpack(input, stage)
    const manifest = validateContent(JSON.parse(await readFile(join(stage, 'manifest.json'), 'utf8')))
    const tracks = []
    for (const track of manifest.tracks) {
      tracks.push({
        id: track.id.toLowerCase(), title: track.title, artist: track.artist ?? 'Purukichi', album: track.album ?? null,
        duration: track.duration ?? null, audio: track.audio, cover: track.cover ?? null,
        audioSha256: await sha256File(join(stage, track.audio)),
        coverSha256: track.cover ? await sha256File(join(stage, track.cover)) : null
      })
    }
    const prepared = { schemaVersion: 1, contentVersion: manifest.contentVersion, tracks }
    prepared.contentHash = createHash('sha256').update(JSON.stringify(prepared)).digest('hex')
    await writeFile(join(stage, 'manifest.json'), JSON.stringify(prepared, null, 2) + '\n')
    try { await access(target); backedUp = true } catch (error) { if (error.code !== 'ENOENT') throw error }
    if (backedUp) await rename(checked(target), checked(previous))
    try { await rename(checked(stage), checked(target)) }
    catch (error) { if (backedUp) await rename(checked(previous), checked(target)); throw error }
    if (backedUp) await remove(previous)
    return prepared
  } finally { await remove(stage) }
}

export async function ensureContent() {
  const target = resolve('generated/content/manifest.json')
  try {
    const manifest = validateContent(JSON.parse(await readFile(target, 'utf8')), { prepared: true })
    for (const track of manifest.tracks) {
      for (const field of ['audio', 'cover']) {
        if (!track[field]) continue
        if (await sha256File(join(resolve(target, '..'), track[field])) !== track[`${field}Sha256`]) throw new Error(`同梱予定ファイルが変更されています: ${track[field]}。ZIPを再準備してください。`)
      }
    }
  }
  catch (error) {
    if (error.code !== 'ENOENT' || error.path !== target) throw error
    await mkdir(resolve(target, '..'), { recursive: true })
    await writeFile(target, JSON.stringify(EMPTY_CONTENT, null, 2) + '\n')
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv[2] === '--ensure') await ensureContent()
    else {
      if (!process.argv[2]) throw new Error('使い方: npm run content:prepare -- 音源パック.zip')
      const result = await prepareContent(resolve(process.argv[2]))
      console.log(`音源パックを準備しました: ${result.contentVersion} / ${result.tracks.length}曲。次にアプリをビルドしてください。`)
    }
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
