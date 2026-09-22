import { test, expect } from '@playwright/test'
import type { Browser, BrowserContext, Page } from '@playwright/test'

// these tests only run when LIVEKIT_URL is set; the playwright config
// forwards the credentials to the app under test. Run the bundled
// livekit container first:
//   podman run -d --name qc-livekit --net=host \
//     -e LIVEKIT_KEYS="devkey: secretsecretsecretsecretsecretsecretse" \
//     livekit/livekit-server:v1.13.7 --dev
//   LIVEKIT_URL=ws://127.0.0.1:7880 LIVEKIT_API_KEY=devkey \
//     LIVEKIT_API_SECRET=secretsecretsecretsecretsecretsecretse \
//     pnpm test:e2e

test.beforeEach(() => {
  test.skip(!process.env.LIVEKIT_URL, 'livekit not configured')
})

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

async function mediaContext(
  browser: Browser,
  browserName: string,
): Promise<BrowserContext> {
  // firefox media permission comes from the browser prefs instead
  if (browserName === 'firefox') return browser.newContext()
  return browser.newContext({ permissions: ['camera', 'microphone'] })
}

test('stage renders media controls and connects', async ({ page }) => {
  const roomUrl = await createRoom(page)
  await join(page, roomUrl, 'alice')
  await expect(page.getByRole('button', { name: 'microphone' })).toBeVisible({
    timeout: 20_000,
  })
  await expect(page.getByRole('button', { name: 'camera' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'share screen' })).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'fullscreen', exact: true }),
  ).toBeVisible()
})

test('microphone toggle publishes and toggles back', async ({ page }) => {
  const roomUrl = await createRoom(page)
  await join(page, roomUrl, 'alice')

  const mic = page.getByRole('button', { name: 'microphone' })
  await mic.click()
  await expect(mic).toHaveAttribute('aria-pressed', 'true', {
    timeout: 15_000,
  })
  await expect(page.getByRole('alert').filter({ hasText: 'failed' })).toHaveCount(0)

  await mic.click()
  await expect(mic).toHaveAttribute('aria-pressed', 'false')
})

test('unsupported browser warns that e2ee degrades', async ({ page, browserName }) => {
  // webkit has no insertable streams so media e2ee must degrade to
  // dtls-srtp with a visible warning instead of a dead room
  test.skip(browserName !== 'webkit', 'webkit-only fallback path')
  const roomUrl = await createRoom(page)
  await join(page, roomUrl, 'alice')
  await expect(page.getByRole('alert').filter({ hasText: 'dtls-srtp' })).toBeVisible({
    timeout: 20_000,
  })
  // the room still connects and controls render
  await expect(page.getByRole('button', { name: 'microphone' })).toBeVisible()
})

test('per participant volume control boosts remote audio', async ({
  browser,
  browserName,
}) => {
  // two livekit-connected contexts make this heavier than a single page
  test.setTimeout(60_000)
  const ctx1 = await mediaContext(browser, browserName)
  const ctx2 = await mediaContext(browser, browserName)
  const alice = await ctx1.newPage()
  const bob = await ctx2.newPage()

  const roomUrl = await createRoom(alice)
  await join(alice, roomUrl, 'alice')
  await join(bob, roomUrl, 'bob')
  await expect(alice.getByText('2 online')).toBeVisible()

  // bob publishes audio so alice gets a remote audio tile
  await bob.getByRole('button', { name: 'microphone' }).click()
  const volBtn = alice.getByRole('button', { name: /volume \d+ percent/ })
  await expect(volBtn.first()).toBeVisible({ timeout: 20_000 })
  await volBtn.first().click()

  const slider = alice.getByRole('slider', { name: 'participant volume' })
  await expect(slider).toBeVisible()
  // boost above 100 percent
  await slider.fill('150')
  await expect(alice.getByRole('button', { name: 'volume 150 percent' })).toBeVisible()

  // persisted across reload of the room page
  await alice.reload()
  await alice.getByLabel('display name').fill('alice')
  await alice.getByRole('button', { name: 'join room' }).click()
  await expect(
    alice.getByRole('button', { name: /volume 150 percent/ }).first(),
  ).toBeVisible({ timeout: 20_000 })

  await ctx1.close()
  await ctx2.close()
})

test('debug panel shows livekit media stats', async ({ page }) => {
  const roomUrl = await createRoom(page)
  await join(page, roomUrl, 'alice')

  await page.getByRole('button', { name: 'connection stats' }).first().click()
  const panel = page.getByRole('complementary', { name: 'connection debug' })
  await expect(panel.getByText('livekit media')).toBeVisible({
    timeout: 10_000,
  })
  await expect(panel.getByText('state')).toBeVisible()
  await expect(panel.getByText('connected').first()).toBeVisible()
  await expect(panel.getByText('encryption')).toBeVisible()
})
