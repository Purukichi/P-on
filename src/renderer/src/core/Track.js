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
    /** その曲だけに設定されたジャケット（シングルとして出ている場合など） */
    this.ownCoverUrl = dto.ownCoverUrl ?? null
    /** 所属アルバムに設定された共通ジャケット */
    this.albumCoverUrl = dto.albumCoverUrl ?? null
    this.addedAt = dto.addedAt ?? null
  }

  /**
   * 実際に表示するジャケット。
   * 曲個別の指定があればそちらを優先し、無ければアルバム共通のものを使う。
   */
  get coverUrl() {
    return this.ownCoverUrl ?? this.albumCoverUrl
  }

  /** 曲個別のジャケットが設定されているか（編集ダイアログの「外す」の可否に使う） */
  get hasOwnCover() {
    return Boolean(this.ownCoverUrl)
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
