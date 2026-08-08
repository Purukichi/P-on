import { fileURLToPath, URL } from 'node:url'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

const r = (path) => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
  main: {
    // music-metadata は ESM 専用パッケージ。CJS で出力する main から require できないので、
    // 外部化せずにバンドルへ取り込む。
    plugins: [externalizeDepsPlugin({ exclude: ['music-metadata'] })]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    root: r('./src/renderer'),
    resolve: {
      alias: {
        '@': r('./src/renderer/src'),
        '@shared': r('./src/shared')
      }
    },
    build: {
      rollupOptions: {
        input: {
          index: r('./src/renderer/index.html'),
          // ミニプレイヤーは別ウィンドウなので、エントリも分けている
          mini: r('./src/renderer/mini.html')
        }
      }
    }
  }
})
