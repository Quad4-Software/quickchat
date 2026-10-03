// SPDX-License-Identifier: 0BSD
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

// headless webkit cannot resolve the mdns ice candidates it emits, so
// datachannel peers in the same browser process never connect
const noWebkitMesh = (browserName: string) =>
  test.skip(
    browserName === 'webkit',
    'webkit headless cannot resolve mdns ice candidates',
  )

test('joins and leaves are recorded in the chat log', async ({
  browser,
  browserName,
}) => {
  noWebkitMesh(browserName)
  const ctx1 = await browser.newContext()
  const ctx2 = await browser.newContext()
  const alice = await ctx1.newPage()
  const bob = await ctx2.newPage()

  const roomUrl = await createRoom(alice)
  await join(alice, roomUrl, 'alice')
  await join(bob, roomUrl, 'bob')

  await expect(alice.getByRole('log').getByText('bob joined')).toBeVisible()
  await ctx2.close()
  await expect(alice.getByRole('log').getByText('bob left')).toBeVisible()

  await ctx1.close()
})

test('offline state is surfaced and the room recovers', async ({
  page,
  context,
  browserName,
}) => {
  test.skip(browserName === 'firefox', 'firefox does not emulate navigator.onLine')
  const roomUrl = await createRoom(page)
  await join(page, roomUrl, 'alice')

  await context.setOffline(true)
  await expect(page.getByText('you are offline')).toBeVisible()

  await context.setOffline(false)
  await expect(page.getByText('you are offline')).toBeHidden({ timeout: 15_000 })
  await expect(
    page.getByRole('status').filter({ hasText: 'online' }).first(),
  ).toBeVisible()
})

test('manual retry redials signaling immediately', async ({
  page,
  context,
  browserName,
}) => {
  test.skip(browserName === 'firefox', 'firefox does not emulate navigator.onLine')
  const roomUrl = await createRoom(page)
  await join(page, roomUrl, 'alice')

  await context.setOffline(true)
  await expect(page.getByText('you are offline')).toBeVisible()
  // retry while still offline: the dial fails fast and the banner stays
  await page.getByRole('button', { name: 'retry' }).click()
  await expect(page.getByText('you are offline')).toBeVisible()

  await context.setOffline(false)
  await expect(page.getByText('you are offline')).toBeHidden({ timeout: 15_000 })
})

test('mobile focus toggle swaps stage and chat and badges unread', async ({
  browser,
  browserName,
  viewport,
}) => {
  noWebkitMesh(browserName)
  test.skip(!viewport || viewport.width >= 768, 'focus toggle only renders below md')
  const ctx1 = await browser.newContext()
  const ctx2 = await browser.newContext()
  const alice = await ctx1.newPage()
  const bob = await ctx2.newPage()

  const roomUrl = await createRoom(alice)
  await join(alice, roomUrl, 'alice')
  await join(bob, roomUrl, 'bob')
  await expect(alice.getByText('2 online')).toBeVisible()

  await alice.getByRole('button', { name: 'show stage' }).click()
  await expect(alice.getByRole('log')).toBeHidden()

  // a message arriving while the stage has focus badges the toggle
  await bob.getByRole('textbox', { name: 'message' }).fill('ping')
  await bob.getByRole('textbox', { name: 'message' }).press('Enter')
  await expect(alice.getByRole('button', { name: 'show chat' })).toContainText('1')

  await alice.getByRole('button', { name: 'show chat' }).click()
  await expect(alice.getByRole('log')).toBeVisible()
  await expect(alice.getByRole('log').getByText('ping')).toBeVisible()

  await ctx1.close()
  await ctx2.close()
})
