/*
 * アプリアイコンを作る。
 *
 *   build/source/app-icon.jpg  … 配布アイコンの元絵。そのまま使う
 *        ↓ 正方形に収めて、角だけ少し丸める
 *   build/icon.png (512)  … 確認用・Linux 用
 *   build/icon.ico        … Windows 用。16〜256px を 1 ファイルにまとめたもの
 *
 * 元絵の白い下敷きはデザインの一部なので残す（透過にしない）。
 * 手を入れるのは角の丸みだけ。
 *
 * 実行にはライブラリが要る（普段のビルドには不要なので devDependencies には入れていない）:
 *   npm install --no-save sharp png-to-ico
 *   node build/make-icon.cjs
 */
const { readFile, writeFile } = require('node:fs/promises')
const { join } = require('node:path')
const sharp = require('sharp')
// png-to-ico は ESM 由来なので、CommonJS からは default を取り出す
const pngToIco = require('png-to-ico').default

/** 出来上がりの一辺 */
const SIZE = 512

/** 角の丸み。一辺に対する割合で持つので、小さいサイズでも見た目の丸みが揃う */
const CORNER_RATIO = 0.1

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]

const root = join(__dirname, '..')
const source = join(root, 'build/source/app-icon.jpg')

/** 角を丸めた正方形。これをアルファとしてかぶせて四隅を落とす */
function roundedMask(size) {
  const radius = size * CORNER_RATIO
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
      `<rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="#fff"/>` +
      `</svg>`
  )
}

/**
 * 元絵を 1 辺 size の正方形に収め、角を丸める。
 * 各サイズを元絵から作り直すのは、大きい版を縮めるより角がなめらかに出るため。
 */
async function render(photo, size) {
  return sharp(photo)
    .resize(size, size, { fit: 'cover' })
    .ensureAlpha()
    .composite([{ input: await sharp(roundedMask(size)).png().toBuffer(), blend: 'dest-in' }])
    .png()
    .toBuffer()
}

async function main() {
  const photo = await readFile(source)

  await writeFile(join(root, 'build/icon.png'), await render(photo, SIZE))

  const frames = []
  for (const size of ICO_SIZES) frames.push(await render(photo, size))
  await writeFile(join(root, 'build/icon.ico'), await pngToIco(frames))

  console.log(`icon.png (${SIZE}px) と icon.ico (${ICO_SIZES.join(', ')}) を作りました`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
