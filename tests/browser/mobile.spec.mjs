import { test, expect } from '@playwright/test'
import { createHash } from 'node:crypto'

function wav() {
  const samples = 8000 * 3
  const b = Buffer.alloc(44 + samples * 2)
  b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8)
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22)
  b.writeUInt32LE(8000, 24); b.writeUInt32LE(16000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34)
  b.write('data', 36); b.writeUInt32LE(samples * 2, 40)
  return b
}

test('bundled songs arrive on app update without authentication and preserve local edits and deletions', async ({ page }) => {
  const audio = wav()
  const audioSha256 = createHash('sha256').update(audio).digest('hex')
  let ids = ['release-1']
  await page.route('**/content/**', async (route) => {
    if (route.request().url().endsWith('/manifest.json')) {
      await route.fulfill({ json: { schemaVersion: 1, contentVersion: String(ids.length), tracks: ids.map((id) => ({
        id, title: `Purukichi ${id}`, artist: 'Purukichi', audio: `audio/${id}.wav`, audioSha256
      })) } })
    } else await route.fulfill({ body: audio, contentType: 'audio/wav' })
  })
  await page.goto('/')
  await expect(page.locator('[data-el="shelf-list"]')).toContainText('Purukichi release-1')
  await page.evaluate(() => window.hamon.library.updateTrack('purukichi:release-1', { title: 'My edited title' }))
  ids = ['release-1', 'release-2']
  await page.reload()
  await expect(page.locator('[data-el="shelf-list"]')).toContainText('My edited title')
  await expect(page.locator('[data-el="shelf-list"]')).toContainText('Purukichi release-2')
  await page.locator('[data-collection-id]').filter({ hasText: 'Purukichi release-2' }).click()
  await expect(page.locator('#app')).toHaveAttribute('data-state', 'playing')
  await page.evaluate(() => window.hamon.library.deleteTrack('purukichi:release-1'))
  await page.reload()
  await expect(page.locator('[data-el="shelf-list"]')).toContainText('Purukichi release-2')
  await expect(page.locator('[data-el="shelf-list"]')).not.toContainText('release-1')
  await expect(page.locator('[data-el="shelf-list"]')).not.toContainText('My edited title')
  expect((await page.evaluate(() => window.hamon.library.snapshot())).tracks).toHaveLength(1)
})

test('shared player imports, plays, saves and reloads on a mobile viewport', async ({ page }, info) => {
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('data-platform', 'mobile')
  for (const selector of ['[data-el="trash"]', '[data-el="add-tracks"]', '[data-el="shelf-search"]']) {
    const box = await page.locator(selector).boundingBox()
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(info.project.use.viewport.width)
  }
  expect((await page.locator('[data-el="shelf-search"]').boundingBox()).width).toBeGreaterThan(120)
  await page.locator('[data-el="about-open"]').click()
  await expect(page.locator('[data-el="about-version"]')).toHaveText('β2.0.0')
  await page.locator('[data-el="about-open"]').click()
  const picker = page.waitForEvent('filechooser')
  await page.locator('[data-el="add-tracks"]').click()
  await (await picker).setFiles({ name: 'Test melody.wav', mimeType: 'audio/wav', buffer: wav() })
  await expect(page.locator('[data-el="shelf-list"]')).toContainText('Test melody')
  await page.locator('[data-el="shelf-add"]').click()
  await page.locator('[data-el="name-input"]').fill('My playlist')
  await page.locator('[data-el="name-submit"]').click()
  await expect(page.locator('[data-el="shelf-list"]')).toContainText('My playlist')
  const card = page.locator('[data-collection-id]').filter({ hasText: 'Test melody' })
  const bounds = await card.boundingBox()
  const session = await page.context().newCDPSession(page)
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: bounds.x + 40, y: bounds.y + 40 }] })
  // The interaction being tested is the 350ms hold-to-drag/menu threshold.
  await page.waitForTimeout(450)
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect(page.locator('[data-el="shelf-menu"]')).toBeVisible()
  await page.locator('[data-el="about-open"]').click()
  await page.reload()
  await expect(page.locator('[data-el="shelf-list"]')).toContainText('Test melody')
  await expect(page.locator('[data-el="shelf-list"]')).toContainText('My playlist')
  await page.locator('[data-collection-id]').filter({ hasText: 'Test melody' }).click()
  await expect(page.locator('#app')).toHaveAttribute('data-state', 'playing')
  await page.screenshot({ path: `out/browser-tests/${info.project.name}-player.png`, fullPage: true })
  await page.locator('[data-el="shelf-expand"]').click()
  const seek = await page.locator('.seekbar').boundingBox()
  expect(seek.width).toBeGreaterThan(120)
  expect((await page.locator('[data-el="about-open"]').boundingBox()).y).toBeGreaterThanOrEqual(0)
  await page.screenshot({ path: `out/browser-tests/${info.project.name}-expanded.png`, fullPage: true })
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  expect(overflow).toBe(false)
  expect(errors).toEqual([])
})
