import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

const r = (path) => fileURLToPath(new URL(path, import.meta.url))
export default defineConfig({
  root: r('./src/renderer'),
  base: './',
  publicDir: r('./generated'),
  define: { __P_ON_MOBILE__: 'true' },
  resolve: { alias: { '@shared': r('./src/shared'), '@': r('./src/renderer/src') } },
  build: {
    target: 'es2022',
    outDir: r('./dist/mobile'),
    emptyOutDir: true,
    rollupOptions: { input: r('./src/renderer/index.html') }
  }
})
