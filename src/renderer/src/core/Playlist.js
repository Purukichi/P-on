/**
 * プレイリスト。曲そのものではなく id の並びだけを持つ。
 * 実体の解決は Library に任せることで、曲を消したときの整合性を 1 か所で保つ。
 */
export class Playlist {
  constructor(dto) {
    this.id = dto.id
    this.name = dto.name ?? '無題のプレイリスト'
    this.trackIds = [...(dto.trackIds ?? [])]
    /** プレイリストに直接設定したジャケット。無ければ収録曲のものを使う */
    this.coverUrl = dto.coverUrl ?? null
    this.createdAt = dto.createdAt ?? null
  }

  get size() {
    return this.trackIds.length
  }

  includes(trackId) {
    return this.trackIds.includes(trackId)
  }
}
