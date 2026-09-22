import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { AxeBuilder } from '@axe-core/playwright'

async function createRoom(page: Page): Promise<string> {
  await page.goto('/')
  await page.getByRole('button', { name: 'new room' }).click()
  await expect(page).toHaveURL(/\/r\/[a-z0-9]+#e2ee=[A-Za-z0-9_-]+/)
  return page.url()
}

async function join(page: Page, url: string, name: string) {
  await page.goto(url)
  await page.getByLabel('display name').fill(name)
  await page.getByRole('button', { name: 'join room' }).click()
  await expect(page.getByRole('log')).toBeVisible()
}

test('home page renders and passes axe', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'quickchat' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'new room' })).toBeVisible()

  const results = await new AxeBuilder({ page }).analyze()
  expect(results.violations).toEqual([])
})

test('create room lands on join form with e2ee fragment', async ({ page }) => {
  await createRoom(page)
  await expect(page.getByLabel('display name')).toBeFocused()
  await expect(page.getByLabel('random name')).toBeVisible()
})

test('dice button fills a random name', async ({ page }) => {
  await createRoom(page)
  const input = page.getByLabel('display name')
  await page.getByLabel('random name').click()
  await expect(input).not.toHaveValue('')
})

// headless webkit cannot resolve the mdns ice candidates it emits, so
// datachannel peers in the same browser process never connect. This is a
// webkit platform limitation, not an app bug.
const noWebkitMesh = (browserName: string) =>
  test.skip(
    browserName === 'webkit',
    'webkit headless cannot resolve mdns ice candidates',
  )

test('two clients exchange chat over the p2p mesh', async ({ browser, browserName }) => {
  noWebkitMesh(browserName)
  const ctx1 = await browser.newContext()
  const ctx2 = await browser.newContext()
  const alice = await ctx1.newPage()
  const bob = await ctx2.newPage()

  const roomUrl = await createRoom(alice)
  await join(alice, roomUrl, 'alice')
  await join(bob, roomUrl, 'bob')

  // presence
  await expect(bob.getByText('2 online')).toBeVisible()
  await expect(alice.getByText('2 online')).toBeVisible()

  // bob -> alice over webrtc datachannel
  await bob.getByRole('textbox', { name: 'message' }).fill('hello alice')
  await bob.getByRole('textbox', { name: 'message' }).press('Enter')
  await expect(alice.getByRole('log').getByText('hello alice')).toBeVisible({
    timeout: 15_000,
  })

  // alice -> bob
  await alice.getByRole('textbox', { name: 'message' }).fill('hi bob')
  await alice.getByRole('button', { name: 'send message' }).click()
  await expect(bob.getByRole('log').getByText('hi bob')).toBeVisible()

  await ctx1.close()
  await ctx2.close()
})

test('typing indicator appears for the peer', async ({ browser, browserName }) => {
  noWebkitMesh(browserName)
  const ctx1 = await browser.newContext()
  const ctx2 = await browser.newContext()
  const alice = await ctx1.newPage()
  const bob = await ctx2.newPage()

  const roomUrl = await createRoom(alice)
  await join(alice, roomUrl, 'alice')
  await join(bob, roomUrl, 'bob')
  await expect(alice.getByText('2 online')).toBeVisible()

  await bob.getByRole('textbox', { name: 'message' }).pressSequentially('typing')
  await expect(alice.getByText('bob is typing')).toBeVisible({ timeout: 15_000 })

  await ctx1.close()
  await ctx2.close()
})

test('file transfers peer to peer', async ({ browser, browserName }) => {
  noWebkitMesh(browserName)
  const ctx1 = await browser.newContext()
  const ctx2 = await browser.newContext()
  const alice = await ctx1.newPage()
  const bob = await ctx2.newPage()

  const roomUrl = await createRoom(alice)
  await join(alice, roomUrl, 'alice')
  await join(bob, roomUrl, 'bob')
  await expect(alice.getByText('2 online')).toBeVisible()
  // let the datachannel finish negotiating before sending
  await bob.getByRole('textbox', { name: 'message' }).fill('ping')
  await bob.getByRole('textbox', { name: 'message' }).press('Enter')
  await expect(alice.getByRole('log').getByText('ping')).toBeVisible({
    timeout: 15_000,
  })

  await alice.getByLabel('choose files to send').setInputFiles({
    name: 'note.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('hello p2p world'),
  })

  // sender sees its own card immediately
  await expect(alice.getByRole('log').getByText('note.txt')).toBeVisible()
  // receiver gets the transfer and a blob link once complete
  const card = bob.getByRole('log').getByText('note.txt')
  await expect(card).toBeVisible({ timeout: 15_000 })
  const link = bob.getByRole('link', { name: /note\.txt/ })
  await expect(link).toHaveAttribute('href', /^blob:/, { timeout: 15_000 })

  await ctx1.close()
  await ctx2.close()
})

test('oversized file is rejected client side', async ({ page }) => {
  const roomUrl = await createRoom(page)
  await join(page, roomUrl, 'alice')

  // e2e server advertises a 1kb cap
  await page.getByLabel('choose files to send').setInputFiles({
    name: 'big.bin',
    mimeType: 'application/octet-stream',
    buffer: Buffer.alloc(2048),
  })
  await expect(page.getByRole('alert')).toContainText('exceeds')
  await expect(page.getByRole('log').getByText('big.bin')).toHaveCount(0)
})

test('slash key focuses the composer', async ({ page }) => {
  const roomUrl = await createRoom(page)
  await join(page, roomUrl, 'alice')
  await page.locator('body').click()
  await page.keyboard.press('/')
  await expect(page.getByRole('textbox', { name: 'message' })).toBeFocused()
})

test('room not found shows error state', async ({ page }) => {
  await page.goto('/r/zzzzzzzzzz')
  await expect(page.getByText('room not found')).toBeVisible()
})

test('room page passes axe after joining', async ({ page }) => {
  const roomUrl = await createRoom(page)
  await join(page, roomUrl, 'alice')

  const results = await new AxeBuilder({ page }).analyze()
  expect(results.violations).toEqual([])
})

test('pwa manifest and icons are served', async ({ page }) => {
  await page.goto('/')
  const manifest = page.locator('link[rel="manifest"]')
  await expect(manifest).toHaveAttribute('href', /manifest/)
  const res = await page.request.get('/manifest.webmanifest')
  expect(res.ok()).toBeTruthy()
  const body = await res.json()
  expect(body.name).toBe('quickchat')
  const icon = await page.request.get('/icon-192.png')
  expect(icon.ok()).toBeTruthy()
})

test('api docs page loads scalar', async ({ page }) => {
  await page.goto('/docs')
  // scalar renders the spec title once the reference mounts
  await expect(page.getByText('quickchat').first()).toBeVisible({
    timeout: 20_000,
  })
  const spec = await page.request.get('/api/openapi.yaml')
  expect(spec.ok()).toBeTruthy()
})
