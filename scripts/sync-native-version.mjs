import { readFile, writeFile } from 'node:fs/promises'
import { NATIVE_VERSION } from '../src/shared/version.js'
const { version } = JSON.parse(await readFile('package.json', 'utf8'))
const gradle = 'android/app/build.gradle'
await writeFile(gradle, (await readFile(gradle, 'utf8')).replace(/versionName "[^"]+"/, `versionName "${version}"`))
const xcode = 'ios/App/App.xcodeproj/project.pbxproj'
await writeFile(xcode, (await readFile(xcode, 'utf8')).replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${NATIVE_VERSION};`))
console.log(`Native version: Android ${version}, iOS ${NATIVE_VERSION} (β channel)`)
