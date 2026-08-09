import { parseFile } from 'music-metadata'

const PICTURE_EXTENSIONS = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/bmp': '.bmp'
}

/**
 * 音源ファイルから埋め込みタグを読む。
 * タグが無い / 壊れていても再生自体はできるので、失敗しても例外は投げず空の結果を返す。
 *
 * @returns {Promise<{title: string|null, artist: string|null, album: string|null,
 *                    duration: number|null, cover: {data: Buffer, extension: string}|null}>}
 */
export async function readMetadata(filePath) {
  const empty = { title: null, artist: null, album: null, duration: null, cover: null, format: null }

  try {
    const { common, format } = await parseFile(filePath, { duration: true })
    const picture = common.picture?.[0] ?? null

    return {
      title: clean(common.title),
      artist: clean(common.artist) ?? clean(common.albumartist),
      album: clean(common.album),
      duration: Number.isFinite(format.duration) ? format.duration : null,
      cover: picture
        ? {
            data: Buffer.from(picture.data),
            extension: PICTURE_EXTENSIONS[picture.format?.toLowerCase()] ?? '.jpg'
          }
        : null,
      format: toFormatInfo(format)
    }
  } catch (error) {
    console.warn(`[metadata] ${filePath} のタグを読めませんでした:`, error.message)
    return empty
  }
}

/** 音質の表示に使う項目だけを抜き出す */
export async function readFormat(filePath) {
  try {
    const { format } = await parseFile(filePath, { duration: true })
    return toFormatInfo(format)
  } catch (error) {
    console.warn(`[metadata] ${filePath} のフォーマットを読めませんでした:`, error.message)
    return null
  }
}

function toFormatInfo(format) {
  if (!format) return null
  return {
    container: clean(format.container),
    codec: clean(format.codec),
    /** Hz */
    sampleRate: Number.isFinite(format.sampleRate) ? format.sampleRate : null,
    /** bit。可逆でないコーデックでは入らないことが多い */
    bitsPerSample: Number.isFinite(format.bitsPerSample) ? format.bitsPerSample : null,
    /** bps */
    bitrate: Number.isFinite(format.bitrate) ? format.bitrate : null,
    channels: Number.isFinite(format.numberOfChannels) ? format.numberOfChannels : null,
    lossless: typeof format.lossless === 'boolean' ? format.lossless : null
  }
}

/** 画像ファイルの拡張子として妥当かどうか */
export function isSupportedImageExtension(extension) {
  return Object.values(PICTURE_EXTENSIONS).includes(extension.toLowerCase())
}

function clean(value) {
  const text = typeof value === 'string' ? value.trim() : ''
  return text.length > 0 ? text : null
}
