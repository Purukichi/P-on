import sharp from 'sharp'
import { writeFile, mkdir, readdir } from 'node:fs/promises'

// Reuse the desktop artwork. This only exports native platform icon sizes.
const source = 'build/source/app-icon.jpg'
await sharp(source).resize(1024, 1024, { fit: 'cover' }).flatten({ background: '#ffffff' }).png()
  .toFile('ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png')
for (const [density, size] of Object.entries({ mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 })) {
  const dir = `android/app/src/main/res/mipmap-${density}`
  await mkdir(dir, { recursive: true })
  const icon = await sharp(source).resize(size, size, { fit: 'cover' }).png().toBuffer()
  await writeFile(`${dir}/ic_launcher.png`, icon)
  await writeFile(`${dir}/ic_launcher_round.png`, icon)
  // Adaptive icons reserve an outer margin for the system's mask and motion.
  const foreground = await sharp(source).resize(size, size, { fit: 'cover' })
    .extend({ top: Math.round(size * .625), bottom: Math.round(size * .625), left: Math.round(size * .625), right: Math.round(size * .625), background: '#ffffff' }).png().toBuffer()
  await writeFile(`${dir}/ic_launcher_foreground.png`, foreground)
}
console.log('P-on artwork exported for iOS and Android')

// Replace the generated Capacitor splash artwork with the existing brand artwork.
const mark = await sharp(source).resize(320, 320, { fit: 'cover' }).png().toBuffer()
const splash = await sharp({ create: { width: 2732, height: 2732, channels: 3, background: '#ffffff' } })
  .composite([{ input: mark, gravity: 'centre' }]).png().toBuffer()
const iosSplash = 'ios/App/App/Assets.xcassets/Splash.imageset'
for (const file of await readdir(iosSplash)) {
  if (file.endsWith('.png')) await writeFile(`${iosSplash}/${file}`, splash)
}
for (const dir of await readdir('android/app/src/main/res')) {
  if (!dir.startsWith('drawable')) continue
  const files = await readdir(`android/app/src/main/res/${dir}`)
  if (files.includes('splash.png')) await writeFile(`android/app/src/main/res/${dir}/splash.png`, splash)
}
