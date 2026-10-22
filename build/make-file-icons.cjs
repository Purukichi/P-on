/*
 * PMP1 に関連付けた音声ファイルの、エクスプローラーでのアイコンを作る。
 *
 *   build/file-icons/<拡張子>.ico   … 例: wav.ico, mp3.ico
 *
 * 絵はジャケット（角を 1 画素落とした正方形）を正面に置いたピクセルアート。
 * 中に再生の三角と拡張子（3 × 5 のピクセル文字）を墨で描き、右上の角に 1 枚だけオレンジのシールを貼る。
 * 枠からはみ出すものを置かないので、16px でも輪郭が崩れない。
 * 拡張子ごとの色分けはしない（オレンジ以外の色を使わないため）。見分けは拡張子の文字に任せる。
 *
 * 升目は 2 種類。48px 以上は 32 升（拡張子を描く）、それより小さいサイズは 16 升（三角とシールだけ）。
 * 横に続く画素は 1 本の矩形にまとめるので、拡大してもつなぎ目が出ない。
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

/** これ以上のサイズでは 32 升で描き、拡張子を添える */
const MIN_LABEL_SIZE = 48

/** p 紙 / e 縁 / i 墨 / o オレンジ */
const COLORS = { p: '#f4f4f1', e: '#8f908b', i: '#111210', o: '#ff4d0f' }

/** 3 × 5 のピクセル文字。拡張子に出てくる字だけ */
const MICRO = {
  A: ['.#.', '#.#', '###', '#.#', '#.#'],
  B: ['##.', '#.#', '##.', '#.#', '##.'],
  C: ['.##', '#..', '#..', '#..', '.##'],
  E: ['###', '#..', '##.', '#..', '###'],
  F: ['###', '#..', '##.', '#..', '#..'],
  G: ['.##', '#..', '#.#', '#.#', '.##'],
  L: ['#..', '#..', '#..', '#..', '###'],
  M: ['#.#', '###', '###', '#.#', '#.#'],
  O: ['.#.', '#.#', '#.#', '#.#', '.#.'],
  P: ['##.', '#.#', '##.', '#..', '#..'],
  S: ['.##', '#..', '.#.', '..#', '##.'],
  U: ['#.#', '#.#', '#.#', '#.#', '###'],
  V: ['#.#', '#.#', '#.#', '#.#', '.#.'],
  W: ['#.#', '#.#', '###', '###', '#.#'],
  3: ['##.', '..#', '.#.', '..#', '##.'],
  4: ['#.#', '#.#', '###', '..#', '..#']
}

/** 再生の三角（9 画素と 5 画素） */
const TRIANGLE_9 = ['#.......', '###.....', '#####...', '#######.', '########', '#######.', '#####...', '###.....', '#.......']
const TRIANGLE_5 = ['#...', '###.', '####', '###.', '#...']

const outDir = join(__dirname, 'file-icons')

/** G × G の升目。色の記号を 1 升ずつ置いていく */
function createGrid(G) {
  const cells = Array.from({ length: G }, () => Array(G).fill(''))
  const set = (x, y, key) => {
    if (x >= 0 && y >= 0 && x < G && y < G) cells[y][x] = key
  }
  return {
    G,
    cells,
    set,
    rect(x0, y0, x1, y1, key) {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, key)
    },
    rows(rows, x0, y0, key) {
      rows.forEach((row, y) => [...row].forEach((ch, x) => ch === '#' && set(x0 + x, y0 + y, key)))
    }
  }
}

/** ジャケット: 角を 1 画素落とした正方形を紙で塗り、外周 1 画素を縁にする */
function sleeve(grid, x0, y0, x1, y1) {
  const inside = (x, y) =>
    x >= x0 && x <= x1 && y >= y0 && y <= y1 && !((x === x0 || x === x1) && (y === y0 || y === y1))
  for (let y = 0; y < grid.G; y++) {
    for (let x = 0; x < grid.G; x++) {
      if (!inside(x, y)) continue
      const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)
      grid.set(x, y, edge ? 'e' : 'p')
    }
  }
}

function draw(extension, big) {
  if (big) {
    const grid = createGrid(32)
    sleeve(grid, 3, 3, 28, 28)
    grid.rows(TRIANGLE_9, 7, 7, 'i')
    grid.rect(23, 7, 25, 9, 'o')
    const glyphs = [...extension.toUpperCase()].map((ch) => MICRO[ch])
    const label = glyphs[0].map((_, y) => glyphs.map((g) => g[y]).join('.'))
    grid.rows(label, 7, 21, 'i')
    return grid
  }
  const grid = createGrid(16)
  sleeve(grid, 1, 1, 14, 14)
  grid.rows(TRIANGLE_5, 4, 4, 'i')
  grid.rect(10, 4, 11, 5, 'o')
  return grid
}

function iconSvg(extension, size) {
  const grid = draw(extension, size >= MIN_LABEL_SIZE)
  const u = size / grid.G
  let body = ''
  for (const [key, color] of Object.entries(COLORS)) {
    let d = ''
    grid.cells.forEach((row, y) => {
      for (let x = 0; x < grid.G; ) {
        if (row[x] !== key) {
          x++
          continue
        }
        let run = 1
        while (row[x + run] === key) run++
        d += `M${x * u} ${y * u}h${run * u}v${u}h${-run * u}z`
        x += run
      }
    })
    if (d) body += `<path d="${d}" fill="${color}"/>`
  }
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
