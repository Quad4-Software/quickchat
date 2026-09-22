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

test('two clients exchange chat over websocket', async ({ browser }) => {
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

  // bob -> alice
  await bob.getByRole('textbox', { name: 'message' }).fill('hello alice')
  await bob.getByRole('textbox', { name: 'message' }).press('Enter')
  await expect(alice.getByRole('log').getByText('hello alice')).toBeVisible()

  // alice -> bob, optimistic render then echo
  await alice.getByRole('textbox', { name: 'message' }).fill('hi bob')
  await alice.getByRole('button', { name: 'send message' }).click()
  await expect(bob.getByRole('log').getByText('hi bob')).toBeVisible()
  // pending state resolves
  await expect(alice.getByRole('log').getByText('sending...')).toHaveCount(0)

  await ctx1.close()
  await ctx2.close()
})

test('typing indicator appears for the peer', async ({ browser }) => {
  const ctx1 = await browser.newContext()
  const ctx2 = await browser.newContext()
  const alice = await ctx1.newPage()
  const bob = await ctx2.newPage()

  const roomUrl = await createRoom(alice)
  await join(alice, roomUrl, 'alice')
  await join(bob, roomUrl, 'bob')
  await expect(alice.getByText('2 online')).toBeVisible()

  await bob.getByRole('textbox', { name: 'message' }).pressSequentially('typing')
  await expect(alice.getByText('bob is typing')).toBeVisible()

  await ctx1.close()
  await ctx2.close()
})

test('attachment upload posts a file card', async ({ page }) => {
  const roomUrl = await createRoom(page)
  await join(page, roomUrl, 'alice')

  await page.getByLabel('choose files to attach').setInputFiles({
    name: 'note.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('hi'),
  })
  await expect(page.getByRole('log').getByText('note.txt')).toBeVisible()
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
