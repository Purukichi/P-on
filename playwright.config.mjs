import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests/browser',
  outputDir: './out/browser-tests',
  reporter: 'list',
  use: { channel: 'chrome', baseURL: 'http://127.0.0.1:5178', hasTouch: true },
  webServer: { command: 'npm run mobile:dev -- --host 127.0.0.1 --port 5178 --strictPort', url: 'http://127.0.0.1:5178', reuseExistingServer: false },
  projects: [
    { name: 'phone', use: { viewport: { width: 390, height: 844 } } },
    { name: 'tablet', use: { viewport: { width: 1024, height: 768 } } }
  ]
})
