/*
 * P-on に関連付けた音声ファイルの、エクスプローラーでのアイコンを作る。
 *
 *   build/file-icons/<拡張子>.ico   … 例: wav.ico, mp3.ico
 *
 * 印は「伸びる芽」。左右で大きさの違う 2 枚の葉と、少し曲がった茎で、片方の葉が伸びはじめた芽の形。
 * アプリアイコンの葉の写真とつながる、ボタニカルな印にしている。
 * 地や縁取りは付けず、印を拡張子ごとの色で塗るだけにする（種類をひと目で見分けられるように）。
 *
 * エクスプローラーの詳細表示は 16px で並ぶので、印は 16 四方の升目で設計し、
 * ほかのサイズはそれをそのまま拡大して使う。
 * 48px 以上（中アイコン以上）では、芽の下に拡張子（MP3 / WAV …）を同じ色で添える。
 *
 * 対象の拡張子は src/shared/ipc-channels.js の AUDIO_EXTENSIONS と揃えること。
 * electron-builder.yml の fileAssociations もここで作った .ico を参照している。
 *
 * 実行: node build/make-file-icons.cjs（sharp は devDependencies に入っている）
 */
const { mkdir, writeFile } = require('node:fs/promises')
const { join } = require('node:path')
const sharp = require('sharp')

const EXTENSIONS = ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'opus', 'webm']

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]

/** これ以上のサイズでは、芽の下に拡張子を添える */
const MIN_LABEL_SIZE = 48

/**
 * 拡張子ごとの色。明るい背景でも暗い背景でも見える中くらいの濃さにそろえ、原色は避けている。
 * MP3 はアプリのアクセント（src/renderer/src/styles/theme.css の --color-accent）と同じ深緑。
 */
const COLORS = {
  mp3: '#3b8c66',
  wav: '#3e6fb0',
  flac: '#7c56ad',
  m4a: '#b8604a',
  aac: '#a9742c',
  ogg: '#2c8593',
  opus: '#ad4f74',
  webm: '#5a626e'
}

const outDir = join(__dirname, 'file-icons')

/**
 * 伸びる芽（16 四方の座標）。
 *   茎 … 下から右上へ少し曲がりながら伸びる線
 *   大きい葉 … 茎の先から右上へ
 *   小さい葉 … 茎の途中から左へ
 */
function sprout(color) {
  return `
    <path d="M7.5 14 C7.5 11.5 7.9 9.4 9.2 7.8" fill="none" stroke="${color}" stroke-width="1.1" stroke-linecap="round"/>
    <path d="M9.2 7.8 C9.1 4.7 11.1 2.6 14.2 2.4 C14.3 5.6 12.3 7.7 9.2 7.8 Z" fill="${color}"/>
    <path d="M7.6 10.6 C5.5 10.7 3.9 9.5 3.4 7.4 C5.6 7.3 7.2 8.5 7.6 10.6 Z" fill="${color}"/>`
}

function iconSvg(extension, size) {
  const color = COLORS[extension]

  if (size < MIN_LABEL_SIZE) {
    return Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 16 16">${sprout(color)}
</svg>`)
  }

  const label = extension.toUpperCase()
  // 4 文字の拡張子（FLAC / OPUS / WEBM）は少し詰める
  const fontSize = label.length >= 4 ? 46 : 56

  return Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 256 256">
  <g transform="translate(128 92) scale(9.2) translate(-8.8 -8.2)">${sprout(color)}</g>
  <text x="128" y="222" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif"
        font-weight="600" font-size="${fontSize}" fill="${color}">${label}</text>
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
