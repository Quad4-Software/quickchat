import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

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

test('debug panel opens, shows mesh stats, and closes', async ({ page }) => {
  const roomUrl = await createRoom(page)
  await join(page, roomUrl, 'alice')

  await page.getByRole('button', { name: 'connection stats' }).first().click()
  const panel = page.getByRole('complementary', { name: 'connection debug' })
  await expect(panel).toBeVisible()
  await expect(panel.getByText('p2p mesh')).toBeVisible()
  await expect(panel.getByText('signaling')).toBeVisible()
  await expect(panel.getByText('online')).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)
})

test('debug panel lists remote peer link state', async ({ browser }) => {
  const ctx1 = await browser.newContext()
  const ctx2 = await browser.newContext()
  const alice = await ctx1.newPage()
  const bob = await ctx2.newPage()

  const roomUrl = await createRoom(alice)
  await join(alice, roomUrl, 'alice')
  await join(bob, roomUrl, 'bob')
  await expect(alice.getByText('2 online')).toBeVisible()

  await alice.getByRole('button', { name: 'connection stats' }).first().click()
  const panel = alice.getByRole('complementary', { name: 'connection debug' })
  await expect(panel.getByText('bob')).toBeVisible()
  await expect(panel.getByText('ice')).toBeVisible()

  await ctx1.close()
  await ctx2.close()
})

test('chat panel resizes by dragging the divider', async ({ page, viewport }) => {
  test.skip(!viewport || viewport.width < 768, 'divider only renders on desktop widths')
  const roomUrl = await createRoom(page)
  await join(page, roomUrl, 'alice')

  const aside = page.getByRole('complementary', { name: 'chat' })
  const handle = page.getByRole('separator', { name: 'resize chat panel' })
  await expect(handle).toBeVisible()
  const before = (await aside.boundingBox())!.width
  const box = (await handle.boundingBox())!

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x - 120, box.y + box.height / 2, { steps: 5 })
  await page.mouse.up()

  const after = (await aside.boundingBox())!.width
  expect(after).toBeGreaterThan(before + 60)
})

test('notification toggle reflects the browser permission state', async ({
  page,
  browserName,
}) => {
  // headless chromium reports notifications as denied regardless of the
  // granted context permission, which exercises the blocked-state copy
  test.skip(browserName !== 'chromium', 'notification api varies by browser')
  const roomUrl = await createRoom(page)
  await join(page, roomUrl, 'alice')
  await expect(page.getByTitle('notifications blocked by the browser')).toBeVisible()
})
