import { app, BrowserWindow } from 'electron'
import { registerIpcHandlers } from './ipc.js'
import { registerMediaProtocol, registerMediaScheme } from './media-protocol.js'
import { ensureDirectories } from './library-store.js'
import { createMainWindow } from './windows.js'

// whenReady より前に呼ぶ必要がある
registerMediaScheme()

app.whenReady().then(async () => {
  registerMediaProtocol()
  registerIpcHandlers()
  await ensureDirectories()
  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
