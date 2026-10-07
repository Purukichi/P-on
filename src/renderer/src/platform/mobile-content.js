import { contentTrackId, validateContent, pendingContent, mergeContent } from '../../../shared/bundled-content.js'

/** Same package as desktop; no remote source and no credentials. */
export async function importMobileContent(store, { baseUrl = new URL('content/', document.baseURI), fetchImpl = fetch } = {}) {
  const response = await fetchImpl(new URL('manifest.json', baseUrl))
  if (!response.ok) throw new Error('同梱音源の一覧を読み込めませんでした')
  const manifest = validateContent(await response.json(), { prepared: true })
  const incoming = pendingContent(await store.read(), manifest)
  const tracks = []
  async function media(path, expectedHash) {
    if (!path) return null
    const response = await fetchImpl(new URL(path, baseUrl))
    if (!response.ok) throw new Error('同梱音源のファイルを読み込めませんでした')
    const blob = await response.blob()
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
    const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
    if (hash !== expectedHash) throw new Error('同梱音源の検証に失敗しました')
    return { key: `content-${hash}`, name: path.split('/').pop(), blob }
  }
  for (const item of incoming) {
    tracks.push({ id: contentTrackId(item.id), title: item.title, artist: item.artist ?? 'Purukichi', album: item.album ?? null,
      duration: item.duration ?? null, format: null, addedAt: new Date().toISOString(),
      audio: await media(item.audio, item.audioSha256), cover: await media(item.cover, item.coverSha256) })
  }
  if (tracks.length) await store.update((state) => mergeContent(state, tracks))
  return tracks.length
}
