import './styles/index.css'
import { AudioEngine } from './core/AudioEngine.js'
import { TrackLibrary } from './core/TrackLibrary.js'
import { PlayerView } from './ui/PlayerView.js'

const root = document.querySelector('#app')

const engine = new AudioEngine({ volume: 0.8 })
const library = new TrackLibrary()
const view = new PlayerView(root, { engine }).mount()

// ファイルを開く -> ライブラリに追加 -> 追加された曲を再生
view.on('open-request', async () => {
  const [track] = await library.pickFiles()
  if (track) engine.load(track, { autoplay: true })
})

library.on('error', (error) => {
  view.setStatus(error.message, { tone: 'error' })
})

// 曲が終わったときの挙動。プレイリストを足すならここで次の曲へ進める
engine.on('ended', () => {
  view.setStatus('再生が終了しました')
})

// dev 時だけコンソールからいじれるようにしておく (本番ビルドでは除去される)
if (import.meta.env.DEV) {
  window.__hamon = { engine, library, view }
}
