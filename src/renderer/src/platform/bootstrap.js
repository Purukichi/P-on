// Electron supplies hamon through the isolated preload. Mobile uses the same API.
if (__P_ON_MOBILE__) {
  const { createMobileApi } = await import('./mobile-api.js')
  const { importMobileContent } = await import('./mobile-content.js')
  window.hamon = createMobileApi({ contentLoader: importMobileContent })
  const { polyfill } = await import('mobile-drag-drop')
  polyfill({ forceApply: true, holdToDrag: 350 })
  let held = null, suppressClickUntil = 0
  document.addEventListener('touchstart', (event) => {
    const target = event.target.closest('[data-collection-id], [data-track-id]')
    const touch = event.touches[0]
    held = target && event.touches.length === 1
      ? { target, x: touch.clientX, y: touch.clientY, time: Date.now() } : null
  }, { passive: true })
  document.addEventListener('touchmove', (event) => {
    const touch = event.touches[0]
    if (held && (!touch || Math.hypot(touch.clientX - held.x, touch.clientY - held.y) > 8)) held = null
  }, { passive: true })
  document.addEventListener('touchcancel', () => { held = null }, { passive: true })
  document.addEventListener('dragstart', () => { held = null })
  document.addEventListener('touchend', (event) => {
    if (held && Date.now() - held.time >= 350) {
      event.preventDefault()
      suppressClickUntil = Date.now() + 500
      held.target.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, clientX: held.x, clientY: held.y
      }))
    }
    held = null
  }, { passive: false })
  document.addEventListener('click', (event) => {
    if (Date.now() < suppressClickUntil && event.target.closest('[data-collection-id], [data-track-id]')) {
      event.preventDefault(); event.stopImmediatePropagation()
    }
  }, true)
  // Drop handlers already define valid targets; the polyfill also requires dragenter.
  document.addEventListener('dragenter', (event) => {
    if (event.target.closest('[data-el="shelf-list"], .tracklist, [data-el="trash"]')) event.preventDefault()
  })
}
if (!window.hamon) throw new Error('アプリの初期化に失敗しました。再起動してください。')
document.documentElement.dataset.platform = window.hamon.platform ?? 'desktop'
