/**
 * ライブラリの曲を「棚に並べる単位」へ束ねる。
 *
 * - プレイリスト … ユーザーが作ったもの
 * - アルバム     … album が設定されている曲を、アルバム名でまとめたもの
 * - シングル     … album が無い曲。1 曲でひとつの単位として扱う
 *
 * Library は曲とプレイリストしか知らない。
 * 「アルバム」「シングル」という見せ方はここだけの都合なので、
 * 表示の分類を変えたくなったらこのファイルを直せば済む。
 */

export const CollectionType = {
  PLAYLIST: 'playlist',
  ALBUM: 'album',
  SINGLE: 'single'
}

export class Collection {
  /** @param {{type: string, id: string, name: string, subtitle: string, tracks: import('./Track.js').Track[], sourceId?: string, ownCoverUrl?: string|null}} init */
  constructor(init) {
    this.type = init.type
    this.id = init.id
    this.name = init.name
    this.subtitle = init.subtitle
    this.tracks = init.tracks
    /** プレイリストのときだけ、元の playlist.id が入る */
    this.sourceId = init.sourceId ?? null
    /** アルバムに直接設定されたジャケット */
    this.ownCoverUrl = init.ownCoverUrl ?? null
  }

  get size() {
    return this.tracks.length
  }

  /** 棚に出すジャケット。アルバム共通の指定が最優先、無ければ収録曲のもの */
  get coverUrl() {
    return this.ownCoverUrl ?? this.tracks.find((track) => track.hasCover)?.coverUrl ?? null
  }

  /** アルバムとプレイリストは中身が複数ある前提なので、再生中にリストを出す */
  get showsTrackList() {
    return this.type !== CollectionType.SINGLE
  }
}

/**
 * @param {import('./Library.js').Library} library
 * @returns {Collection[]} プレイリスト → アルバム → シングルの順
 */
export function buildCollections(library) {
  return [...playlistsOf(library), ...albumsOf(library), ...singlesOf(library)]
}

/** id からコレクションを引く */
export function findCollection(collections, collectionId) {
  return collections.find((collection) => collection.id === collectionId) ?? null
}

/** ある曲を含むコレクションのうち、再生の文脈として最も自然なものを返す */
export function collectionContaining(collections, trackId, preferredId = null) {
  if (preferredId) {
    const preferred = findCollection(collections, preferredId)
    if (preferred?.tracks.some((track) => track.id === trackId)) return preferred
  }
  return collections.find((collection) => collection.tracks.some((t) => t.id === trackId)) ?? null
}

function playlistsOf(library) {
  return library.playlists.map(
    (playlist) =>
      new Collection({
        type: CollectionType.PLAYLIST,
        id: `playlist:${playlist.id}`,
        sourceId: playlist.id,
        name: playlist.name,
        subtitle: `${playlist.trackIds.length}曲`,
        tracks: library.tracksOfPlaylist(playlist.id)
      })
  )
}

function albumsOf(library) {
  /** @type {Map<string, import('./Track.js').Track[]>} */
  const grouped = new Map()

  for (const track of library.tracks) {
    if (!track.album) continue
    if (!grouped.has(track.album)) grouped.set(track.album, [])
    grouped.get(track.album).push(track)
  }

  return [...grouped.entries()].map(([album, tracks]) => {
    const artists = [...new Set(tracks.map((track) => track.artist).filter(Boolean))]
    return new Collection({
      type: CollectionType.ALBUM,
      id: `album:${album}`,
      name: album,
      subtitle:
        artists.length === 0
          ? 'アーティスト未設定'
          : artists.length === 1
            ? artists[0]
            : `${artists.length}組のアーティスト`,
      tracks,
      ownCoverUrl: library.albumCoverUrl(album)
    })
  })
}

function singlesOf(library) {
  return library.tracks
    .filter((track) => !track.album)
    .map(
      (track) =>
        new Collection({
          type: CollectionType.SINGLE,
          id: `single:${track.id}`,
          name: track.displayTitle,
          subtitle: track.displayArtist,
          tracks: [track]
        })
    )
}
