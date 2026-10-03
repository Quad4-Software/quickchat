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

test('renaming updates the roster and new messages', async ({ browser, browserName }) => {
  noWebkitMesh(browserName)
  const ctx1 = await browser.newContext()
  const ctx2 = await browser.newContext()
  const alice = await ctx1.newPage()
  const bob = await ctx2.newPage()

  const roomUrl = await createRoom(alice)
  await join(alice, roomUrl, 'alice')
  await join(bob, roomUrl, 'bob')

  await alice.getByRole('button', { name: 'edit profile' }).click()
  const editor = alice.getByRole('dialog', { name: 'edit profile' })
  await expect(editor).toBeVisible()
  await editor.getByLabel('display name').fill('captain')
  await editor.getByRole('button', { name: 'save' }).click()

  // bob sees the rename in the roster line
  await expect(bob.getByText('captain').first()).toBeVisible()
  await sendText(alice, 'new name here')
  await expect(bob.getByRole('log').getByText('captain')).toBeVisible()

  await ctx1.close()
  await ctx2.close()
})

test('avatars broadcast to peers and render on messages', async ({
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

  // a 2px red png is enough for the avatar pipeline
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAADklEQVR42mP8z8AARLQBA/8AUwAAAAAASUVORK5CYII=',
    'base64',
  )
  await alice.getByRole('button', { name: 'edit profile' }).click()
  await alice.getByLabel('avatar image').setInputFiles({
    name: 'me.png',
    mimeType: 'image/png',
    buffer: png,
  })
  await alice.getByRole('button', { name: 'edit profile' }).click()

  await sendText(alice, 'avatar check')
  // bob sees the data url image on the message row
  await expect(
    bob.getByRole('log').getByRole('img', { name: 'alice' }).first(),
  ).toBeVisible({ timeout: 15_000 })

  await ctx1.close()
  await ctx2.close()
})

test('qr dialog renders a scannable svg and copy link', async ({ page }) => {
  const roomUrl = await createRoom(page)
  await join(page, roomUrl, 'alice')
  await page.getByRole('button', { name: 'share room' }).click()
  const dialog = page.getByRole('dialog', { name: 'room qr code' })
  await expect(dialog).toBeVisible()
  const svg = dialog.getByRole('img')
  await expect(svg).toBeVisible()
  const box = await svg.boundingBox()
  expect(box && box.width > 50).toBeTruthy()
  await expect(dialog.getByRole('button', { name: 'copy link' })).toBeVisible()
})

test('attachments menu offers file and voice', async ({ page }) => {
  const roomUrl = await createRoom(page)
  await join(page, roomUrl, 'alice')
  await page.getByRole('button', { name: 'attachments' }).click()
  const menu = page.getByRole('menu', { name: 'attachments' })
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'send file' })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'voice message' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(menu).not.toBeVisible()
})

test('shortcuts modal lists and rebinds actions', async ({ page }) => {
  const roomUrl = await createRoom(page)
  await join(page, roomUrl, 'alice')
  await page.getByRole('button', { name: 'keyboard shortcuts' }).click()
  const modal = page.getByRole('dialog', { name: 'keyboard shortcuts' })
  await expect(modal).toBeVisible()
  const mic = modal.getByRole('button', { name: 'shortcut for toggle microphone' })
  await expect(mic).toHaveText('m')
  await mic.click()
  await expect(mic).toHaveText('press keys')
  await page.keyboard.press('u')
  await expect(mic).toHaveText('u')
  await modal.getByRole('button', { name: 'reset to defaults' }).click()
  await expect(mic).toHaveText('m')
  await page.keyboard.press('Escape')
  await expect(modal).not.toBeVisible()
})
