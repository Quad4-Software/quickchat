// SPDX-License-Identifier: 0BSD
import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

async function createRoom(page: Page): Promise<string> {
  // commit, not load or domcontentloaded: firefox intermittently
  // stalls the navigation waiter though the page fully renders.
  // assertions wait on rendered elements anyway
  await page.goto('/', { waitUntil: 'commit' })
  await page.getByRole('button', { name: 'new room' }).click()
  await expect(page).toHaveURL(/\/r\/[a-z0-9]+#e2ee=[A-Za-z0-9_-]+/)
  return page.url()
}

async function join(page: Page, url: string, name: string) {
  await page.goto(url, { waitUntil: 'commit' })
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

async function sendText(page: Page, text: string) {
  await page.getByRole('textbox', { name: 'message' }).fill(text)
  await page.getByRole('button', { name: 'send message' }).click()
}

test('reactions ride the mesh and toggle off again', async ({ browser, browserName }) => {
  noWebkitMesh(browserName)
  const ctx1 = await browser.newContext()
  const ctx2 = await browser.newContext()
  const alice = await ctx1.newPage()
  const bob = await ctx2.newPage()

  const roomUrl = await createRoom(alice)
  await join(alice, roomUrl, 'alice')
  await join(bob, roomUrl, 'bob')
  await sendText(bob, 'hello alice')

  const row = alice.getByRole('log').getByText('hello alice')
  await expect(row).toBeVisible()
  await row.hover()
  await alice.getByRole('button', { name: 'react 👍' }).first().click()

  const chip = bob.getByRole('button', { name: '👍 1', exact: true })
  await expect(chip).toBeVisible()
  // bob stacks his own thumbs up and then removes alice's toggle
  await chip.click()
  await expect(bob.getByRole('button', { name: '👍 2', exact: true })).toBeVisible()

  await ctx1.close()
  await ctx2.close()
})

test('replies carry the quoted line to the peer', async ({ browser, browserName }) => {
  noWebkitMesh(browserName)
  const ctx1 = await browser.newContext()
  const ctx2 = await browser.newContext()
  const alice = await ctx1.newPage()
  const bob = await ctx2.newPage()

  const roomUrl = await createRoom(alice)
  await join(alice, roomUrl, 'alice')
  await join(bob, roomUrl, 'bob')
  await sendText(alice, 'ship it friday')

  await alice.getByRole('log').getByText('ship it friday').hover()
  await bob.getByRole('log').getByText('ship it friday').hover()
  await bob.getByRole('button', { name: 'reply' }).first().click()
  await sendText(bob, 'deal')

  // alice sees the quote block above bob's reply
  const quote = alice.getByRole('log').getByText('ship it friday').nth(1)
  await expect(quote).toBeVisible()
  await expect(alice.getByRole('log').getByText('deal')).toBeVisible()

  await ctx1.close()
  await ctx2.close()
})

test('unsend tombstones the message on both sides', async ({ browser, browserName }) => {
  noWebkitMesh(browserName)
  const ctx1 = await browser.newContext()
  const ctx2 = await browser.newContext()
  const alice = await ctx1.newPage()
  const bob = await ctx2.newPage()

  const roomUrl = await createRoom(alice)
  await join(alice, roomUrl, 'alice')
  await join(bob, roomUrl, 'bob')
  await sendText(bob, 'scratch that')

  await expect(alice.getByRole('log').getByText('scratch that')).toBeVisible()
  await bob.getByRole('log').getByText('scratch that').hover()
  await bob.getByRole('button', { name: 'unsend' }).first().click()

  await expect(alice.getByRole('log').getByText('bob deleted a message')).toBeVisible()
  await expect(alice.getByRole('log').getByText('scratch that')).not.toBeVisible()

  await ctx1.close()
  await ctx2.close()
})

test('markdown lite renders bold code and links', async ({ browser, browserName }) => {
  noWebkitMesh(browserName)
  const ctx = await browser.newContext()
  const solo = await ctx.newPage()

  const roomUrl = await createRoom(solo)
  await join(solo, roomUrl, 'solo')
  await sendText(solo, 'run `make test` **carefully** https://example.com')

  const log = solo.getByRole('log')
  await expect(log.locator('code').getByText('make test')).toBeVisible()
  await expect(log.locator('strong').getByText('carefully')).toBeVisible()
  await expect(log.getByRole('link', { name: 'https://example.com' })).toBeVisible()

  await ctx.close()
})

test('share button shows a qr code on desktop', async ({ page, browserName }) => {
  // webkit exposes navigator.share so the button opens the sheet instead
  test.skip(browserName === 'webkit', 'webkit uses the native share sheet')
  const roomUrl = await createRoom(page)
  await join(page, roomUrl, 'alice')
  await page.getByRole('button', { name: 'share room' }).click()
  await expect(page.getByRole('dialog', { name: 'room qr code' })).toBeVisible()
})

test('emoji picker inserts into the composer', async ({ page }) => {
  const roomUrl = await createRoom(page)
  await join(page, roomUrl, 'alice')
  await page.getByRole('button', { name: 'emoji' }).click()
  await expect(page.getByRole('dialog', { name: 'emoji picker' })).toBeVisible()
  await page
    .getByRole('dialog', { name: 'emoji picker' })
    .getByRole('button', { name: '🔥' })
    .click()
  await expect(page.getByRole('textbox', { name: 'message' })).toHaveValue('🔥')
})

test('typing shows the peer name and bouncing dots', async ({ browser, browserName }) => {
  noWebkitMesh(browserName)
  const ctx1 = await browser.newContext()
  const ctx2 = await browser.newContext()
  const alice = await ctx1.newPage()
  const bob = await ctx2.newPage()

  const roomUrl = await createRoom(alice)
  await join(alice, roomUrl, 'alice')
  await join(bob, roomUrl, 'bob')

  await bob.getByRole('textbox', { name: 'message' }).fill('still going')
  const line = alice.getByRole('log').getByText('bob is typing')
  await expect(line).toBeVisible()
  await expect(alice.locator('.typing-dot')).toHaveCount(3)

  await ctx1.close()
  await ctx2.close()
})

test('presenting a pdf opens the briefing on both sides', async ({
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
  await sendText(bob, 'ping')
  await expect(alice.getByRole('log').getByText('ping')).toBeVisible({
    timeout: 15_000,
  })

  // a stub pdf is enough: the briefing renders the blob url either way
  await alice.getByLabel('choose files to send').setInputFiles({
    name: 'deck.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.1\n1 0 obj<<>>endobj\ntrailer<<>>\n'),
  })

  await bob.getByRole('log').getByText('deck.pdf').hover()
  await alice.getByRole('log').getByText('deck.pdf').hover()
  await alice.getByRole('button', { name: 'present' }).first().click()

  await expect(alice.getByRole('dialog', { name: 'briefing' })).toBeVisible()
  await expect(
    alice.getByRole('dialog', { name: 'briefing' }).getByText('you are presenting'),
  ).toBeVisible()
  await expect(
    bob.getByRole('dialog', { name: 'briefing' }).getByText('alice is presenting'),
  ).toBeVisible()

  await alice.getByRole('button', { name: 'close briefing' }).click()
  await expect(bob.getByRole('dialog', { name: 'briefing' })).not.toBeVisible()

  await ctx1.close()
  await ctx2.close()
})
