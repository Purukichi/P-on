import { fileURLToPath, URL } from 'node:url'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

const r = (path) => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
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
        input: r('./src/renderer/index.html')
      }
    }
  }
})
