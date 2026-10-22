/*
 * アプリアイコンを作る。
 *
 *   build/icon.png (512)  … 確認用・Linux / macOS 用
 *   build/icon.ico        … Windows 用。16〜256px を 1 ファイルにまとめたもの
 *
 * 絵は PMP1 のロゴを 2 段に積んだ「PM / P1」。cell（#E8E9E5）の地に墨のドットで置き、
 * 最後の「1」だけ信号オレンジにする。字形はメイン画面左上のロゴ（src/renderer/index.html）と同じ 4 × 5
 * （M だけ 5 列）。消灯のドットは 48px 以上でだけ小さく描く。
 * 16 升の升目で設計し、16px では 1 ドット = 1 ピクセルにしてぼやけないようにしている。
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

const COLORS = { cell: '#e8e9e5', rule: '#c3c4bf', ink: '#111210', accent: '#ff4d0f', off: '#d3d4cf' }

const root = join(__dirname, '..')

const GLYPHS = {
  P: ['###.', '#..#', '###.', '#...', '#...'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#'],
  1: ['.#..', '##..', '.#..', '.#..', '###.']
}

/** 字形を 1 列あけて横に並べる */
const join2 = (a, b) => a.map((row, y) => `${row}.${b[y]}`)

/** 「PM」の段と「P1」の段（1 はオレンジ = 'o'）を 1 行あけて積む。幅は 10 列にそろえる */
const STACK = [
  ...join2(GLYPHS.P, GLYPHS.M),
  '..........',
  ...join2(GLYPHS.P, GLYPHS[1].map((row) => row.replace(/#/g, 'o'))).map((row) => row.padEnd(10, '.'))
]

function iconSvg(size) {
  const u = size / 16
  const radius = size >= 48 ? u * 2 : 0
  const stroke = Math.max(1, u * 0.12)
  let body =
    `<rect x="${u * 0.5}" y="${u * 0.5}" width="${u * 15}" height="${u * 15}" rx="${radius}" ` +
    `fill="${COLORS.cell}" stroke="${COLORS.rule}" stroke-width="${stroke}"/>`
  // 小さいサイズは 1 ドット = 1 升でぴったり置き、大きいサイズは升の 8 割にしてドットの間をあける
  const dot = size >= 32 ? u * 0.8 : u
  const left = 3
  const top = size >= 32 ? 2.5 : 2
  STACK.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      const X = (left + x) * u + (u - dot) / 2
      const Y = (top + y) * u + (u - dot) / 2
      if (ch === '#' || ch === 'o') {
        body += `<rect x="${X}" y="${Y}" width="${dot}" height="${dot}" fill="${ch === 'o' ? COLORS.accent : COLORS.ink}"/>`
      } else if (size >= 48 && y !== 5) {
        body += `<rect x="${X + dot * 0.3}" y="${Y + dot * 0.3}" width="${dot * 0.4}" height="${dot * 0.4}" fill="${COLORS.off}"/>`
      }
    })
  )
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">${body}</svg>`
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
