import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { Readable } from 'node:stream'
import { protocol } from 'electron'
import { resolveInLibrary } from './library-store.js'

/**
 * ライブラリ内のファイルをレンダラーへ配信するための独自スキーム。
 *
 * dev サーバー (http://localhost) 上のページからは file:// を直接読めないため、
 * `hamon-media://library/audio/xxx.mp3` のような URL でストリーム配信する。
 * 配信できるのはライブラリフォルダ配下だけで、外を指す URL は 403 で弾く。
 */
export const MEDIA_SCHEME = 'hamon-media'

const MIME_TYPES = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.webm': 'audio/webm',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp'
}

/**
 * ライブラリ相対パスを再生 / 表示用の URL に変換する。
 * @param {string|null|undefined} relativePath 例: 'audio/foo.mp3'
 */
export function toMediaUrl(relativePath) {
  if (!relativePath) return null
  const encoded = relativePath.split(/[\\/]/).map(encodeURIComponent).join('/')
  // 差し替え後もキャッシュが残らないよう、更新時に変わるクエリを足せるようにしてある
  return `${MEDIA_SCHEME}://library/${encoded}`
}

/** app.whenReady() より前に呼ぶ必要がある */
export function registerMediaScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        // これが無いと <audio> のシーク (Range リクエスト) が動かない
        stream: true,
        corsEnabled: true
      }
    }
  ])
}

/** app.whenReady() の後に一度だけ呼ぶ */
export function registerMediaProtocol() {
  protocol.handle(MEDIA_SCHEME, handleMediaRequest)
}

async function handleMediaRequest(request) {
  const url = new URL(request.url)
  const relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, '')
  const filePath = resolveInLibrary(relativePath)

  if (!filePath) {
    return new Response('Outside of library', { status: 403 })
  }

  let size
  try {
    ;({ size } = await stat(filePath))
  } catch {
    return new Response('File not found', { status: 404 })
  }

  const headers = {
    'Content-Type': MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store'
  }

  const range = parseRangeHeader(request.headers.get('range'), size)

  if (range === 'unsatisfiable') {
    return new Response(null, {
      status: 416,
      headers: { ...headers, 'Content-Range': `bytes */${size}` }
    })
  }

  if (!range) {
    return new Response(streamFile(filePath), {
      status: 200,
      headers: { ...headers, 'Content-Length': String(size) }
    })
  }

  const { start, end } = range
  return new Response(streamFile(filePath, start, end), {
    status: 206,
    headers: {
      ...headers,
      'Content-Length': String(end - start + 1),
      'Content-Range': `bytes ${start}-${end}/${size}`
    }
  })
}

function streamFile(filePath, start, end) {
  return Readable.toWeb(createReadStream(filePath, { start, end }))
}

/**
 * `Range: bytes=100-200` 形式を解釈する。
 * @returns {null | 'unsatisfiable' | {start: number, end: number}}
 *          null = Range 指定なし (全体を返す)
 */
function parseRangeHeader(header, size) {
  if (!header) return null

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match) return null

  const [, rawStart, rawEnd] = match
  let start
  let end

  if (rawStart === '') {
    // 末尾から N バイト (`bytes=-500`)
    const suffixLength = Number(rawEnd)
    if (!suffixLength) return 'unsatisfiable'
    start = Math.max(0, size - suffixLength)
    end = size - 1
  } else {
    start = Number(rawStart)
    end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1)
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
    return 'unsatisfiable'
  }

  return { start, end }
}
