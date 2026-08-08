import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { protocol } from 'electron'

/**
 * ローカルの音声ファイルをレンダラーへ配信するための独自スキーム。
 *
 * dev サーバー (http://localhost) 上のページからは file:// を直接読めないため、
 * `hamon-media://stream/<token>` という URL でストリーム配信する。
 * token はセッション内だけ有効な使い捨ての ID なので、
 * レンダラー側に生のファイルパスを URL として渡さずに済む。
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
  '.webm': 'audio/webm'
}

/** token -> 絶対パス */
const tokenToPath = new Map()
/** 絶対パス -> token (同じファイルに毎回別の URL を振らないため) */
const pathToToken = new Map()

/**
 * app.whenReady() より前に呼ぶ必要がある。
 * stream: true が無いと <audio> のシーク (Range リクエスト) が動かない。
 */
export function registerMediaScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: true
      }
    }
  ])
}

/** 絶対パスを再生可能な URL に変換する */
export function createMediaUrl(filePath) {
  const cached = pathToToken.get(filePath)
  if (cached) return toUrl(cached)

  const token = randomUUID()
  tokenToPath.set(token, filePath)
  pathToToken.set(filePath, token)
  return toUrl(token)
}

/** app.whenReady() の後に一度だけ呼ぶ */
export function registerMediaProtocol() {
  protocol.handle(MEDIA_SCHEME, handleMediaRequest)
}

function toUrl(token) {
  return `${MEDIA_SCHEME}://stream/${token}`
}

async function handleMediaRequest(request) {
  const token = new URL(request.url).pathname.replace(/^\/+/, '')
  const filePath = tokenToPath.get(token)

  if (!filePath) {
    return new Response('Unknown media token', { status: 404 })
  }

  let size
  try {
    ;({ size } = await stat(filePath))
  } catch (error) {
    console.error(`[media] cannot stat ${filePath}:`, error)
    return new Response('File not found', { status: 404 })
  }

  const headers = {
    'Content-Type': MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store'
  }

  const range = parseRangeHeader(request.headers.get('range'), size)

  if (range === 'unsatisfiable') {
    return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } })
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
