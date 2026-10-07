/*
 * P-on に関連付けた音声ファイルの、エクスプローラーでのアイコンを作る。
 *
 *   build/file-icons/<拡張子>.ico   … 例: wav.ico, mp3.ico
 *
 * 白い紙に折り返しの角を付け、下に拡張子（WAV / MP3 …）を緑の帯で載せただけの
 * シンプルな形にしてある。アプリのアイコン（写真入り）をそのまま使うと、
 * 一覧でファイルの種類が見分けにくく、名前の横で絵ばかりが目立つため。
 * 小さいサイズ（32px 未満）では文字が潰れるので、帯だけを残して文字は省く。
 *
 * 対象の拡張子は src/shared/ipc-channels.js の AUDIO_EXTENSIONS と揃えること。
 * electron-builder.yml の fileAssociations もここで作った .ico を参照している。
 *
 * 実行にはライブラリが要る（普段のビルドには不要なので devDependencies には入れていない）:
 *   npm install --no-save sharp
 *   node build/make-file-icons.cjs
 */
const { mkdir, writeFile } = require('node:fs/promises')
const { join } = require('node:path')
const sharp = require('sharp')

const EXTENSIONS = ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'opus', 'webm']

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]

/** これより小さいサイズでは拡張子の文字を描かない */
const MIN_LABEL_SIZE = 32

/** テーマの緑。build/icon.svg と同じ */
const ACCENT = '#72e887'

const outDir = join(__dirname, 'file-icons')

/**
 * 256 四方の座標で描き、sharp で各サイズへ縮める。
 * 紙は縦長にして、左右に余白を取る（Windows の他のファイルアイコンと並べて浮かないように）。
 */
function iconSvg(extension, size) {
  const label = extension.toUpperCase()
  const withLabel = size >= MIN_LABEL_SIZE
  // 4 文字の拡張子（FLAC / OPUS / WEBM）は少し詰める
  const fontSize = label.length >= 4 ? 50 : 60

  return Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 256 256">
  <!-- 紙 -->
  <path d="M44 16 H164 L212 64 V232 Q212 240 204 240 H52 Q44 240 44 232 Z"
        fill="#ffffff" stroke="#c9ced6" stroke-width="6" stroke-linejoin="round"/>
  <!-- 折り返した角 -->
  <path d="M164 16 V56 Q164 64 172 64 H212 Z"
        fill="#e6e9ee" stroke="#c9ced6" stroke-width="6" stroke-linejoin="round"/>
  <!-- 音符 -->
  <path d="M112 74 V138 A20 16 0 1 1 100 124 V74 Q100 66 108 66 H146 Q152 66 152 72 V82 Q152 88 146 88 H112 Z"
        fill="#3a3f47"/>
  <!-- 拡張子の帯 -->
  <rect x="28" y="${withLabel ? 160 : 176}" width="200" height="${withLabel ? 64 : 48}" rx="10" fill="${ACCENT}"/>
  ${
    withLabel
      ? `<text x="128" y="192" text-anchor="middle" dominant-baseline="central"
          font-family="Segoe UI, Arial, sans-serif" font-weight="700" font-size="${fontSize}"
          fill="#0f2a17">${label}</text>`
      : ''
  }
</svg>`)
}

/** PNG を詰め込んだだけの ICO を組み立てる（Windows Vista 以降はこれで読める） */
function toIco(pngs) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // 予約
  header.writeUInt16LE(1, 2) // 1 = アイコン
  header.writeUInt16LE(pngs.length, 4)

  const entries = []
  let offset = 6 + 16 * pngs.length
  for (const { size, data } of pngs) {
    const entry = Buffer.alloc(16)
    entry.writeUInt8(size >= 256 ? 0 : size, 0) // 幅（256 は 0 で表す）
    entry.writeUInt8(size >= 256 ? 0 : size, 1) // 高さ
    entry.writeUInt8(0, 2) // パレット数
    entry.writeUInt8(0, 3) // 予約
    entry.writeUInt16LE(1, 4) // カラープレーン
    entry.writeUInt16LE(32, 6) // ビット深度
    entry.writeUInt32LE(data.length, 8)
    entry.writeUInt32LE(offset, 12)
    entries.push(entry)
    offset += data.length
  }

  return Buffer.concat([header, ...entries, ...pngs.map(({ data }) => data)])
}

async function main() {
  await mkdir(outDir, { recursive: true })

  for (const extension of EXTENSIONS) {
    const pngs = []
    for (const size of ICO_SIZES) {
      pngs.push({ size, data: await sharp(iconSvg(extension, size)).png().toBuffer() })
    }
    await writeFile(join(outDir, `${extension}.ico`), toIco(pngs))
  }

  console.log(`${EXTENSIONS.map((e) => `${e}.ico`).join(', ')} を作りました`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
