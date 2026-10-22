/*
 * アプリアイコンを作る。
 *
 *   build/icon.png (512)  … 確認用・Linux / macOS 用
 *   build/icon.ico        … Windows 用。16〜256px を 1 ファイルにまとめたもの
 *
 * 絵は P のマーク（build/icon.svg と同じ図形）を信号オレンジ（#FF4D0F）で塗り、
 * cell のグレー（#E8E9E5）の角丸の地に置いたもの。地に縁取りは付けない。
 * アプリの中のロゴ（PMP1 のドット）とは別に、アイコンだけは P のマークを使う。
 *
 * 実行: node build/make-icon.cjs（sharp は devDependencies に入っている）
 * スマホ版のアイコン（scripts/mobile-icons.mjs）は、まだ旧 P-on の build/source/app-icon.jpg から作っている。
 */
const { writeFile } = require('node:fs/promises')
const { join } = require('node:path')
const sharp = require('sharp')

/** 出来上がりの一辺 */
const SIZE = 512

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]

const COLORS = { tile: '#e8e9e5', mark: '#ff4d0f' }

/** P のマーク。素の viewBox は 0 0 100 108.67（build/icon.svg と同じ） */
const MARK =
  'M0 50 L0 105.6 C0 107.5 1.3 108.7 3.1 108.7 C3.9 108.7 4.6 108.4 5.2 108 C7.5 103.5 14 98.5 25.5 93.6 ' +
  'A50 50 0 1 0 0 50 Z M23.5 58 A34.3 34.3 0 1 1 92.1 58 A34.3 34.3 0 1 1 23.5 58 Z'
const MARK_WIDTH = 100
const MARK_HEIGHT = 108.67

/** 地の角丸。一辺に対する割合で持つ（16px では角を立てて、1 ピクセルの丸みでぼけないようにする） */
const CORNER_RATIO = 0.1

/** マークの高さ。一辺に対する割合 */
const MARK_RATIO = 0.6

const root = join(__dirname, '..')

function iconSvg(size) {
  const radius = size >= 32 ? size * CORNER_RATIO : 0
  const scale = (size * MARK_RATIO) / MARK_HEIGHT
  const x = (size - MARK_WIDTH * scale) / 2
  const y = (size - MARK_HEIGHT * scale) / 2
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
      `<rect width="${size}" height="${size}" rx="${radius}" fill="${COLORS.tile}"/>` +
      `<path transform="translate(${x} ${y}) scale(${scale})" fill="${COLORS.mark}" fill-rule="evenodd" d="${MARK}"/>` +
      `</svg>`
  )
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
  await writeFile(join(root, 'build/icon.png'), await sharp(iconSvg(SIZE)).png().toBuffer())

  const frames = []
  for (const size of ICO_SIZES) frames.push({ size, data: await sharp(iconSvg(size)).png().toBuffer() })
  await writeFile(join(root, 'build/icon.ico'), toIco(frames))

  console.log(`icon.png (${SIZE}px) と icon.ico (${ICO_SIZES.join(', ')}) を作りました`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
