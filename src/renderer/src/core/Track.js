/**
 * 1 曲分の情報を表すモデル。
 *
 * 今は「ファイル名から推測したタイトル」しか持たないが、
 * 将来 ID3 / Vorbis コメントを読むようになっても
 * ここに artist / album / artwork / trackNumber を足すだけで済むよう、
 * UI からは必ずこのクラス経由で曲情報を参照する。
 */
export class Track {
  /** @param {{id?: string, filePath: string, fileName: string, url: string, title?: string|null, artist?: string|null, album?: string|null, duration?: number|null}} init */
  constructor(init) {
    this.id = init.id ?? crypto.randomUUID()
    this.filePath = init.filePath
    this.fileName = init.fileName
    this.url = init.url
    this.title = init.title ?? null
    this.artist = init.artist ?? null
    this.album = init.album ?? null
    /** 秒。メタデータ読み込み前は null */
    this.duration = init.duration ?? null
  }

  /** preload が返す AudioFileRef から生成する */
  static fromFileRef(ref) {
    return new Track({
      filePath: ref.path,
      fileName: ref.fileName,
      url: ref.url,
      title: stripExtension(ref.fileName)
    })
  }

  /** 表示用タイトル (タグが無ければファイル名) */
  get displayTitle() {
    return this.title || stripExtension(this.fileName) || '不明なトラック'
  }

  /** 表示用サブタイトル (アーティスト / アルバム) */
  get displaySubtitle() {
    return [this.artist, this.album].filter(Boolean).join(' — ') || '不明なアーティスト'
  }

  /** 再生開始後に判明した長さを書き戻す */
  setDuration(seconds) {
    this.duration = Number.isFinite(seconds) ? seconds : null
    return this
  }

  /** プレイリストを JSON で保存するとき用。url はセッション毎に変わるので保存しない */
  toJSON() {
    return {
      id: this.id,
      filePath: this.filePath,
      fileName: this.fileName,
      title: this.title,
      artist: this.artist,
      album: this.album,
      duration: this.duration
    }
  }

  /** 保存した JSON + 再取得した url から復元する */
  static fromJSON(json, url) {
    return new Track({ ...json, url })
  }
}

function stripExtension(fileName) {
  return String(fileName ?? '').replace(/\.[^./\\]+$/, '')
}
