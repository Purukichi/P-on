import { AUDIO_EXTENSIONS, IMAGE_EXTENSIONS } from './ipc-channels.js'

export const EMPTY_CONTENT = { schemaVersion: 1, contentVersion: 'empty', tracks: [] }

export function safeContentPath(path) {
  if (typeof path !== 'string' || !path || path.length > 220 || /[\\:*?"<>|%#\u0000-\u001f]/.test(path)) return false
  return path.split('/').every((part) => part && part !== '.' && part !== '..' &&
    !/[. ]$/.test(part) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))
}

export function validateContent(value, { prepared = false } = {}) {
  if (!value || value.schemaVersion !== 1 || typeof value.contentVersion !== 'string' || !value.contentVersion.trim() || !Array.isArray(value.tracks)) {
    throw new Error('manifest.jsonにはschemaVersion: 1、contentVersion、tracksが必要です')
  }
  if (value.tracks.length > 2000) throw new Error('1つの音源パックは2000曲までです')
  const ids = new Set()
  for (const track of value.tracks) {
    if (!track || !/^[a-zA-Z0-9_-]{1,80}$/.test(track.id ?? '') || ids.has(track.id.toLowerCase())) throw new Error('曲IDが不正、または重複しています')
    ids.add(track.id.toLowerCase())
    if (typeof track.title !== 'string' || !track.title.trim()) throw new Error(`${track.id}: 曲名が必要です`)
    for (const [field, prefix, extensions] of [['audio', 'audio/', AUDIO_EXTENSIONS], ['cover', 'covers/', IMAGE_EXTENSIONS]]) {
      const path = track[field]
      if (field === 'cover' && path == null) continue
      if (!safeContentPath(path) || !path.startsWith(prefix) || !extensions.includes(path.split('.').pop().toLowerCase())) {
        throw new Error(`${track.id}: ${field}のファイル指定が不正です`)
      }
      if (prepared && !/^[a-f0-9]{64}$/.test(track[`${field}Sha256`] ?? '')) throw new Error(`${track.id}: ${field}のハッシュがありません`)
    }
    for (const field of ['artist', 'album']) if (track[field] != null && typeof track[field] !== 'string') throw new Error(`${track.id}: ${field}が不正です`)
    if (track.duration != null && (!Number.isFinite(track.duration) || track.duration < 0)) throw new Error(`${track.id}: durationが不正です`)
  }
  return value
}

export const contentTrackId = (id) => `purukichi:${id.toLowerCase()}`

/** The receipt survives deletion, so app updates never resurrect user-deleted music. */
export function pendingContent(state, manifest) {
  const delivered = new Set(state.deliveredContent ?? [])
  for (const track of state.tracks) delivered.add(track.id)
  return manifest.tracks.filter((track) => !delivered.has(contentTrackId(track.id)))
}

export function mergeContent(state, tracks) {
  const received = new Set(state.deliveredContent ?? [])
  const existing = new Set(state.tracks.map((track) => track.id))
  let added = 0
  for (const track of tracks) {
    if (!received.has(track.id) && !existing.has(track.id)) {
      state.tracks.push(track)
      existing.add(track.id)
      added++
    }
    received.add(track.id)
  }
  state.deliveredContent = [...received]
  return added
}
