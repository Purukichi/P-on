import { readFile } from 'node:fs/promises'
import { validateContent } from '../src/shared/bundled-content.js'

const path = process.argv[2] ?? 'catalog/catalog.example.json'
try {
  const catalog = validateContent(JSON.parse(await readFile(path, 'utf8')))
  console.log(`音源パックのメタデータ検証成功: ${catalog.tracks.length}曲（ファイルの存在はcontent:prepareで確認します）`)
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
