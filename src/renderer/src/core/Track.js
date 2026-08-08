/**
 * 1 曲分の情報を表すモデル。
 * main プロセスが返す DTO をそのまま包み、表示ルール（アルバム未設定なら「シングル」等）を
 * ここに集約する。UI からは必ずこのクラス経由で曲情報を参照する。
 */
export class Track {
  constructor(dto) {
    this.id = dto.id
    this.title = dto.title ?? ''
    this.artist = dto.artist ?? null
    this.album = dto.album ?? null
    /** 秒。未取得なら null */
    this.duration = dto.duration ?? null
    this.audioFile = dto.audioFile
    this.coverFile = dto.coverFile ?? null
    this.audioUrl = dto.audioUrl
    this.coverUrl = dto.coverUrl ?? null
    this.addedAt = dto.addedAt ?? null
  }

  get displayTitle() {
    return this.title || '無題のトラック'
  }

  get displayArtist() {
    return this.artist || 'アーティスト未設定'
  }

  /** アルバム名が無い曲はシングル扱いで表示する */
  get displayAlbum() {
    return this.album || 'シングル'
  }

  get hasCover() {
    return Boolean(this.coverUrl)
  }
}
