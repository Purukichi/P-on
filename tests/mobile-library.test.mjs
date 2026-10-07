import test from 'node:test'
import assert from 'node:assert/strict'
import 'fake-indexeddb/auto'
import { createMobileStore } from '../src/renderer/src/platform/mobile-store.js'
import { createMobileApi } from '../src/renderer/src/platform/mobile-api.js'

test('mobile import, playlist, audio replacement, covers and restart retain user data', async () => {
  const name = `test-${crypto.randomUUID()}`
  let api = createMobileApi({ store: createMobileStore(name) })
  const file = new File([new Uint8Array(44)], 'my-song.wav', { type: 'audio/wav' })
  const imported = await api.library.import([file, new File(['x'], 'bad.txt')])
  assert.equal(imported.added.length, 1)
  assert.equal(imported.skipped.length, 1)
  const id = imported.added[0]
  await api.library.updateTrack(id, { title: 'Saved title', album: 'Album A' })
  const { playlistId } = await api.playlists.create('My list')
  await api.playlists.addTracks(playlistId, [id, id])
  await api.library.setAlbumCover('Album A', new File(['picture'], 'cover.png'))
  const before = await api.library.snapshot()
  assert.ok(before.tracks[0].albumCoverUrl.startsWith('blob:'))
  await api.library.renameAlbum('Album A', 'Album B')
  const replacement = await api.library.replaceAudio(id, new File([new Uint8Array(48)], 'replacement.wav'))
  assert.equal(replacement.replaced, true)
  assert.equal(replacement.snapshot.tracks[0].title, 'Saved title')
  await api.dispose()
  api = createMobileApi({ store: createMobileStore(name) })
  const reloaded = await api.library.snapshot()
  assert.equal(reloaded.tracks[0].album, 'Album B')
  assert.equal(reloaded.tracks[0].audioFile, 'replacement.wav')
  assert.ok(reloaded.tracks[0].albumCoverUrl)
  assert.deepEqual(reloaded.playlists[0].trackIds, [id])
  await api.library.deleteTrack(id)
  assert.deepEqual((await api.library.snapshot()).playlists[0].trackIds, [])
  await api.dispose()
})

test('concurrent writes serialize and failed edits roll back without poisoning later writes', async () => {
  const store = createMobileStore(`test-${crypto.randomUUID()}`)
  await Promise.all(Array.from({ length: 12 }, (_, i) => store.update((state) => state.tracks.push({ id: i }))))
  await assert.rejects(store.update((state) => { state.tracks = []; throw new Error('fail') }))
  await store.update((state) => state.tracks.push({ id: 12 }))
  assert.equal((await store.read()).tracks.length, 13)
  await store.close()
})

test('cancelling cover picker preserves cover; duplicate reorder IDs do not lose tracks', async () => {
  const api = createMobileApi({ store: createMobileStore(`test-${crypto.randomUUID()}`), picker: async () => [] })
  const { added } = await api.library.import(['a.wav', 'b.wav'].map((name) => new File([new Uint8Array(44)], name)))
  await api.library.setCover(added[0], new File(['picture'], 'cover.png'))
  assert.ok((await api.library.pickCover(added[0])).tracks[0].ownCoverUrl)
  const reordered = await api.library.reorderTracks([added[1], added[1], added[0]])
  assert.deepEqual(reordered.tracks.map((item) => item.id), [added[1], added[0]])
  await api.dispose()
})
