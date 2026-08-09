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
    /** @type {{container: string|null, codec: string|null, sampleRate: number|null, bitsPerSample: number|null, bitrate: number|null, channels: number|null, lossless: boolean|null}|null} */
    this.format = dto.format ?? null
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

  /**
   * 音質の要約。例: 「FLAC · 44.1 kHz · 16 bit · ステレオ」
   * 可逆でない形式ではビットレートを出す。
   */
  get formatSummary() {
    const f = this.format
    if (!f) return ''

    const parts = []
    const name = (f.container ?? f.codec ?? '').toUpperCase()
    if (name) parts.push(name.replace('MPEG 1 LAYER 3', 'MP3'))
    if (f.sampleRate) parts.push(`${round(f.sampleRate / 1000)} kHz`)
    if (f.bitsPerSample) parts.push(`${f.bitsPerSample} bit`)
    else if (f.bitrate) parts.push(`${Math.round(f.bitrate / 1000)} kbps`)
    if (f.channels) parts.push(channelLabel(f.channels))
    if (f.lossless === true) parts.push('ロスレス')

    return parts.join(' · ')
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

function round(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function channelLabel(channels) {
  if (channels === 1) return 'モノラル'
  if (channels === 2) return 'ステレオ'
  return `${channels}ch`
}
