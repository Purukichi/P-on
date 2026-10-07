import { app } from 'electron'
import { join, extname } from 'node:path'
import { readFile, copyFile, rename, unlink } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { ensureDirectories, libraryRoot, load, update } from './library-store.js'
import { contentTrackId, pendingContent, mergeContent, validateContent } from '../shared/bundled-content.js'

const completed = new Set()
let pending = Promise.resolve()

async function copyVerified(source, relative, expectedHash, root) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(source)) hash.update(chunk)
  if (hash.digest('hex') !== expectedHash) throw new Error('同梱音源の検証に失敗しました')
  const target = join(root, relative), temporary = `${target}.${randomUUID()}.tmp`
  try { await copyFile(source, temporary); await rename(temporary, target) }
  finally { await unlink(temporary).catch((error) => { if (error.code !== 'ENOENT') throw error }) }
}

export function ensureBundledContent() {
  const root = libraryRoot()
  pending = pending.catch(() => {}).then(async () => {
    if (completed.has(root)) return
    const source = app.isPackaged ? join(process.resourcesPath, 'content') : join(app.getAppPath(), 'generated/content')
    let manifest
    try { manifest = validateContent(JSON.parse(await readFile(join(source, 'manifest.json'), 'utf8')), { prepared: true }) }
    catch (error) { if (error.code === 'ENOENT') { completed.add(root); return }; throw error }
    const incoming = pendingContent(await load(), manifest)
    await ensureDirectories()
    const tracks = []
    for (const item of incoming) {
      const audioFile = `audio/purukichi-${item.id}-${item.audioSha256}${extname(item.audio)}`
      const coverFile = item.cover ? `covers/purukichi-${item.coverSha256}${extname(item.cover)}` : null
      await copyVerified(join(source, item.audio), audioFile, item.audioSha256, root)
      if (coverFile) await copyVerified(join(source, item.cover), coverFile, item.coverSha256, root)
      tracks.push({ id: contentTrackId(item.id), title: item.title, artist: item.artist ?? 'Purukichi', album: item.album ?? null,
        duration: item.duration ?? null, audioFile, coverFile, format: null, addedAt: new Date().toISOString() })
    }
    if (libraryRoot() !== root) throw new Error('ライブラリ保存先が変更されました。もう一度開いてください')
    if (tracks.length) await update((state) => mergeContent(state, tracks))
    completed.add(root)
  })
  return pending
}
