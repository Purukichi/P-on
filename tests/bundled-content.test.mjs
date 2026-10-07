import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { createHash } from 'node:crypto'
import 'fake-indexeddb/auto'
import { prepareContent } from '../scripts/prepare-content.mjs'
import { validateContent, safeContentPath, pendingContent, mergeContent, contentTrackId } from '../src/shared/bundled-content.js'
import { createMobileStore } from '../src/renderer/src/platform/mobile-store.js'
import { importMobileContent } from '../src/renderer/src/platform/mobile-content.js'

// Small, uncompressed ZIP fixtures, including adversarial paths and Unix symlinks.
function zip(files) {
  const local = [], central = []; let offset = 0
  for (const [name, value, attributes = 0] of files) {
    const data = Buffer.from(value), filename = Buffer.from(name)
    let crc = 0xffffffff
    for (const byte of data) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0) }
    crc = (crc ^ 0xffffffff) >>> 0
    const h = Buffer.alloc(30)
    h.writeUInt32LE(0x04034b50); h.writeUInt16LE(20, 4); h.writeUInt32LE(crc, 14)
    h.writeUInt32LE(data.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(filename.length, 26)
    local.push(h, filename, data)
    const c = Buffer.alloc(46)
    c.writeUInt32LE(0x02014b50); c.writeUInt16LE(0x0314, 4); c.writeUInt16LE(20, 6)
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24)
    c.writeUInt16LE(filename.length, 28); c.writeUInt32LE(attributes >>> 0, 38); c.writeUInt32LE(offset, 42)
    central.push(c, filename); offset += h.length + filename.length + data.length
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, directory, end])
}
const hash = (value) => createHash('sha256').update(value).digest('hex')
const manifest = (ids = ['song-1']) => ({ schemaVersion: 1, contentVersion: 'pack-1', tracks: ids.map((id) => ({
  id, title: `Title ${id}`, album: 'Album', audio: `audio/${id}.mp3`, cover: 'covers/art.png'
})) })
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'p-on-content-'))
  t.after(async () => {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep + 'p-on-content-'))
    await rm(root, { recursive: true, force: true })
  })
  return root
}

test('ZIP preparation verifies referenced files and retains previous delivery after invalid ZIP', async (t) => {
  const root = await fixture(t), input = join(root, 'delivery.zip'), output = join(root, 'generated')
  await writeFile(input, zip([['manifest.json', JSON.stringify(manifest())], ['audio/song-1.mp3', 'audio'], ['covers/art.png', 'image']]))
  const prepared = await prepareContent(input, output)
  assert.equal(prepared.tracks[0].audioSha256, hash('audio'))
  assert.equal(prepared.tracks[0].artist, 'Purukichi')
  const before = await readFile(join(output, 'content/manifest.json'), 'utf8')
  for (const files of [
    [['manifest.json', JSON.stringify(manifest())]],
    [['../outside.mp3', 'bad']],
    [['audio/link.mp3', '../bad', 0xa1ff0000]],
    [['audio/A.mp3', 'a'], ['audio/a.mp3', 'b']]
  ]) {
    await writeFile(input, zip(files))
    await assert.rejects(prepareContent(input, output))
    assert.equal(await readFile(join(output, 'content/manifest.json'), 'utf8'), before)
  }
})

test('version updates add only new tracks and preserve edits, playlists and deletion receipts', () => {
  const state = { tracks: [{ id: 'local', title: 'User song' }], playlists: [{ id: 'list', trackIds: ['local'] }] }
  const first = { id: contentTrackId('song-1'), title: 'Original' }
  mergeContent(state, [first]); first.title = 'User edited'
  assert.equal(pendingContent(state, manifest()).length, 0)
  mergeContent(state, [{ ...first, title: 'Publisher changed' }])
  assert.equal(state.tracks[1].title, 'User edited')
  state.tracks = state.tracks.filter((track) => track.id !== first.id)
  assert.equal(pendingContent(state, manifest()).length, 0)
  assert.deepEqual(pendingContent(state, manifest(['song-1', 'song-2'])).map((track) => track.id), ['song-2'])
  mergeContent(state, [{ id: contentTrackId('song-2'), title: 'New song' }])
  assert.equal(state.tracks[0].title, 'User song')
  assert.deepEqual(state.playlists[0].trackIds, ['local'])
})

test('mobile updates persist embedded audio and reject corrupt files without partial imports', async () => {
  const store = createMobileStore(`content-${crypto.randomUUID()}`)
  const baseUrl = new URL('https://app.local/content/')
  let version = manifest(), corrupt = false
  const fetchImpl = async (url) => {
    if (url.pathname.endsWith('manifest.json')) return Response.json({ ...version, tracks: version.tracks.map((track) => ({ ...track, audioSha256: hash('audio'), coverSha256: hash('image') })) })
    return new Response(url.pathname.includes('/audio/') ? (corrupt ? 'broken' : 'audio') : 'image')
  }
  assert.equal(await importMobileContent(store, { baseUrl, fetchImpl }), 1)
  assert.equal(await importMobileContent(store, { baseUrl, fetchImpl }), 0)
  assert.equal(await (await store.read()).tracks[0].audio.blob.text(), 'audio')
  version = manifest(['song-1', 'song-2']); corrupt = true
  await assert.rejects(importMobileContent(store, { baseUrl, fetchImpl }))
  assert.equal((await store.read()).tracks.length, 1)
  corrupt = false
  assert.equal(await importMobileContent(store, { baseUrl, fetchImpl }), 1)
  await store.update((state) => { state.tracks = [] })
  assert.equal(await importMobileContent(store, { baseUrl, fetchImpl }), 0)
  await store.close()
})

test('delivery paths and duplicate stable IDs are validated', () => {
  for (const path of ['../x', '/audio/a.mp3', 'C:/x', 'audio/x\\y', 'audio/NUL.mp3', 'audio/x%2f.mp3', 'audio/x.']) assert.equal(safeContentPath(path), false)
  assert.throws(() => validateContent(manifest(['Same', 'same'])))
  assert.throws(() => validateContent({ ...manifest(), schemaVersion: 99 }))
})
