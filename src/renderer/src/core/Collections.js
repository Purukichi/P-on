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
  /** @param {{type: string, id: string, name: string, subtitle: string, tracks: import('./Track.js').Track[], sourceId?: string, ownCoverUrl?: string|null, ownArtist?: string|null}} init */
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
    /** アルバムに直接設定されたアーティスト（収録曲の artist とは別物） */
    this.ownArtist = init.ownArtist ?? null
  }

  get size() {
    return this.tracks.length
  }

  /** 棚に出すジャケット。アルバム共通の指定が最優先、無ければ収録曲のもの */
  get coverUrl() {
    return this.ownCoverUrl ?? this.tracks.find((track) => track.hasCover)?.coverUrl ?? null
  }

  /**
   * 収録曲側のアーティストを重複なく並べたもの。
   * アルバムのアーティストが未設定のときの表示と、検索の照合に使う。
   */
  get trackArtists() {
    return [...new Set(this.tracks.flatMap((track) => track.artists))]
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

/**
 * 検索。アルバム名 / シングル名 / プレイリスト名 / 収録曲のタイトル / アーティスト名にあたる。
 * アーティストが「A, B, C」のように連名で入っている場合は分解して個別に照合するので、
 * 「B」だけでも引ける。
 */
export function filterCollections(collections, query) {
  const needle = query.trim().toLowerCase()
  if (!needle) return collections

  return collections.filter((collection) => {
    if (collection.name.toLowerCase().includes(needle)) return true
    if (collection.subtitle.toLowerCase().includes(needle)) return true

    return collection.tracks.some((track) => {
      if (track.displayTitle.toLowerCase().includes(needle)) return true
      if (track.album?.toLowerCase().includes(needle)) return true
      return track.artists.some((artist) => artist.toLowerCase().includes(needle))
    })
  })
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
        tracks: library.tracksOfPlaylist(playlist.id),
        ownCoverUrl: playlist.coverUrl
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
    /*
     * 表に出すのはアルバムのアーティスト。
     * 設定されていなければ収録曲のアーティストを全部ならべる。
     * 「A, B」のような連名は分解したうえで、同じ名前は 1 度だけ出す。
     * 「N組のアーティスト」と丸めると誰が入っているのか分からないため。
     */
    const ownArtist = library.albumArtist(album)
    const artists = [...new Set(tracks.flatMap((track) => track.artists))]
    const fallback = artists.length === 0 ? 'アーティスト未設定' : artists.join(', ')

    return new Collection({
      type: CollectionType.ALBUM,
      id: `album:${album}`,
      name: album,
      subtitle: ownArtist ?? fallback,
      tracks,
      ownCoverUrl: library.albumCoverUrl(album),
      ownArtist
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
