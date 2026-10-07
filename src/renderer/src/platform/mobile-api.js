import { parseBlob } from 'music-metadata'
import { createMobileStore } from './mobile-store.js'
import { DISPLAY_VERSION } from '../../../shared/version.js'
import { AUDIO_EXTENSIONS, IMAGE_EXTENSIONS } from '../../../shared/ipc-channels.js'

const audioAccept = AUDIO_EXTENSIONS.map((ext) => `.${ext}`).join(',')
const imageAccept = IMAGE_EXTENSIONS.map((ext) => `.${ext}`).join(',')
const key = () => crypto.randomUUID()
const trim = (text) => String(text ?? '').trim() || null
const fileExtension = (file) => file.name?.split('.').pop().toLowerCase()

function pickFiles(accept, multiple = false) {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.multiple = multiple
    input.hidden = true
    const finish = (files) => { input.remove(); resolve(files) }
    input.addEventListener('change', () => finish([...input.files]), { once: true })
    input.addEventListener('cancel', () => finish([]), { once: true })
    document.body.append(input)
    input.click()
  })
}

export function createMobileApi({ store = createMobileStore(), picker = pickFiles, contentLoader } = {}) {
  let contentError = null
  const ready = contentLoader ? contentLoader(store).catch((error) => { contentError = error.message }) : Promise.resolve()
  const urls = new Map()
  const droppedFiles = new Map()
  const mediaUrl = (media) => {
    if (!media) return null
    if (!urls.has(media.key)) urls.set(media.key, URL.createObjectURL(media.blob))
    return urls.get(media.key)
  }
  const resolveFile = (file) => typeof file === 'string' ? droppedFiles.get(file) : file
  const track = (state, id) => {
    const value = state.tracks.find((item) => item.id === id)
    if (!value) throw new Error('トラックが見つかりません')
    return value
  }
  const playlist = (state, id) => {
    const value = state.playlists.find((item) => item.id === id)
    if (!value) throw new Error('プレイリストが見つかりません')
    return value
  }
  async function snapshot() {
    await ready
    const state = await store.read()
    return {
      libraryPath: 'アプリ内ライブラリ',
      contentError,
      tracks: state.tracks.map(({ audio, cover, ...item }) => ({
        ...item, audioFile: audio.name, audioUrl: mediaUrl(audio),
        coverFile: cover?.name ?? null, ownCoverUrl: mediaUrl(cover),
        albumCoverUrl: mediaUrl(state.albumCovers[item.album])
      })),
      playlists: state.playlists.map(({ cover, ...item }) => ({ ...item, coverUrl: mediaUrl(cover) })),
      albumCovers: Object.fromEntries(Object.entries(state.albumCovers).map(([name, media]) =>
        [name, { coverUrl: mediaUrl(media), coverFile: media?.name ?? null }])),
      albumArtists: state.albumArtists
    }
  }
  const mutate = async (change) => { await store.update(change); return snapshot() }
  async function metadata(file) {
    try { return await parseBlob(file, { duration: true }) }
    catch { return { common: {}, format: {} } }
  }
  function image(file) {
    if (!file) return null
    file = resolveFile(file)
    if (!file || !IMAGE_EXTENSIONS.includes(fileExtension(file))) throw new Error('対応していない画像形式です')
    return { key: key(), name: file.name, blob: file }
  }
  async function importFiles(files) {
    const added = [], skipped = [], prepared = []
    for (const candidate of files) {
      const file = resolveFile(candidate)
      if (!file || !AUDIO_EXTENSIONS.includes(fileExtension(file))) {
        skipped.push(file?.name ?? String(candidate)); continue
      }
      const { common, format } = await metadata(file)
      const id = key(), picture = common.picture?.[0]
      prepared.push({
        id, title: common.title || file.name.replace(/\.[^.]+$/, ''), artist: trim(common.artist),
        album: trim(common.album), duration: format.duration ?? null, format,
        addedAt: new Date().toISOString(),
        audio: { key: key(), name: file.name, blob: file },
        cover: picture ? { key: key(), name: 'embedded', blob: new Blob([picture.data], { type: picture.format }) } : null
      })
      added.push(id)
    }
    await store.update((state) => state.tracks.push(...prepared))
    droppedFiles.clear()
    return { snapshot: await snapshot(), added, skipped }
  }
  async function replaceAudio(id, file) {
    file = resolveFile(file)
    if (!file) return { snapshot: await snapshot(), replaced: false }
    if (!AUDIO_EXTENSIONS.includes(fileExtension(file))) throw new Error('対応していない音声形式です')
    const { format } = await metadata(file)
    await store.update((state) => Object.assign(track(state, id), {
      audio: { key: key(), name: file.name, blob: file }, duration: format.duration ?? null, format
    }))
    return { snapshot: await snapshot(), replaced: true }
  }
  const setCover = (id, file) => mutate((state) => { track(state, id).cover = image(file) })
  const setAlbumCover = (name, file) => mutate((state) => {
    if (file) state.albumCovers[name] = image(file)
    else delete state.albumCovers[name]
  })
  const setPlaylistCover = (id, file) => mutate((state) => { playlist(state, id).cover = image(file) })
  const pickedCover = async (fn, id) => {
    const [file] = await picker(imageAccept)
    return file ? fn(id, file) : snapshot()
  }
  const noop = () => {}, subscribe = () => noop
  return {
    platform: 'mobile',
    library: {
      snapshot, import: importFiles,
      pickFiles: async () => importFiles(await picker(audioAccept, true)),
      updateTrack: (id, patch) => mutate((state) => {
        const target = track(state, id)
        for (const field of ['title', 'artist', 'album']) {
          if (Object.hasOwn(patch, field)) target[field] = trim(patch[field])
        }
      }),
      setCover, pickCover: (id) => pickedCover(setCover, id),
      setAlbumCover, pickAlbumCover: (name) => pickedCover(setAlbumCover, name),
      setAlbumArtist: (name, artist) => mutate((state) => {
        if (trim(artist)) state.albumArtists[name] = trim(artist)
        else delete state.albumArtists[name]
      }),
      renameAlbum: (oldName, newName) => mutate((state) => {
        newName = trim(newName)
        if (!newName || newName === oldName) return
        for (const item of state.tracks) if (item.album === oldName) item.album = newName
        for (const map of [state.albumCovers, state.albumArtists]) {
          if (Object.hasOwn(map, oldName)) { map[newName] = map[oldName]; delete map[oldName] }
        }
      }),
      setAlbum: (ids, album) => mutate((state) => ids.forEach((id) => { track(state, id).album = trim(album) })),
      setArtist: (ids, artist) => mutate((state) => ids.forEach((id) => { track(state, id).artist = trim(artist) })),
      reorderTracks: (ids) => mutate((state) => {
        const selected = [...new Set(ids)].map((id) => track(state, id))
        const known = new Set(ids)
        state.tracks = state.tracks.map((item) => known.has(item.id) ? selected.shift() : item)
      }),
      replaceAudio, pickAudio: async (id) => replaceAudio(id, (await picker(audioAccept))[0]),
      deleteTrack: (id) => mutate((state) => {
        state.tracks = state.tracks.filter((item) => item.id !== id)
        for (const item of state.playlists) item.trackIds = item.trackIds.filter((value) => value !== id)
      }),
      backfillFormats: async () => ({ snapshot: await snapshot(), filled: 0 }),
      openFolder: async () => {}, chooseLocation: async () => null,
      applyLocation: async () => { throw new Error('モバイルではアプリ内に保存します') }
    },
    playlists: {
      create: async (name) => {
        const playlistId = key()
        await store.update((state) => state.playlists.push({ id: playlistId, name: trim(name) || '新しいプレイリスト', trackIds: [], createdAt: new Date().toISOString() }))
        return { snapshot: await snapshot(), playlistId }
      },
      rename: (id, name) => mutate((state) => { playlist(state, id).name = trim(name) || '新しいプレイリスト' }),
      remove: (id) => mutate((state) => { state.playlists = state.playlists.filter((item) => item.id !== id) }),
      addTracks: (id, ids) => mutate((state) => {
        const target = playlist(state, id)
        for (const value of ids) {
          track(state, value)
          if (!target.trackIds.includes(value)) target.trackIds.push(value)
        }
      }),
      removeTrack: (id, trackId) => mutate((state) => {
        const target = playlist(state, id)
        target.trackIds = target.trackIds.filter((value) => value !== trackId)
      }),
      reorder: (id, ids) => mutate((state) => {
        const target = playlist(state, id)
        target.trackIds = [...new Set([...ids.filter((value) => target.trackIds.includes(value)), ...target.trackIds])]
      }),
      setCover: setPlaylistCover, pickCover: (id) => pickedCover(setPlaylistCover, id)
    },
    confirm: async ({ message, detail }) => window.confirm([message, detail].filter(Boolean).join('\n\n')),
    app: {
      info: async () => ({ version: DISPLAY_VERSION, supported: false, reason: 'アプリの更新は配布元から行ってください。' }),
      checkUpdate: async () => ({ status: 'unsupported', message: 'アプリの更新は配布元から行ってください。' })
    },
    player: { publishState: noop, onState: subscribe, sendCommand: noop, onCommand: subscribe, requestState: noop, onStateRequested: subscribe },
    windows: { openMini: noop, closeMini: noop, quit: noop, setMiniAlwaysOnTop: noop, onMiniHover: subscribe, setTitleBar: noop },
    pathForFile(file) {
      const path = `${key()}/${file.name}`
      droppedFiles.set(path, file)
      return path
    },
    async dispose() { urls.forEach((url) => URL.revokeObjectURL(url)); urls.clear(); await store.close() }
  }
}
