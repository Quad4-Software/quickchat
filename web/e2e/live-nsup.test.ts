// SPDX-License-Identifier: 0BSD
import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

// needs the same livekit dev server as live.test.ts, see that file for
// the podman command and env vars

test.beforeEach(() => {
  test.skip(!process.env.LIVEKIT_URL, 'livekit not configured')
})

async function join(page: Page, name: string) {
  await page.goto('/', { waitUntil: 'commit' })
  await page.getByRole('button', { name: 'new room' }).click()
  await page.getByLabel('display name').fill(name)
  await page.getByRole('button', { name: 'join room' }).click()
  await expect(page.getByRole('log')).toBeVisible()
}

test('ai noise suppression toggles on a published mic', async ({ page, browserName }) => {
  // only chromium ran this spec, webkit and firefox are unverified
  test.skip(browserName !== 'chromium', 'verified on chromium only')
  test.setTimeout(120_000)

  await join(page, 'alice')
  const mic = page.getByRole('button', { name: 'microphone' })
  await expect(mic).toBeVisible({ timeout: 20_000 })
  // the enable can race the sfu connect on slow runners, retry the
  // click a few times before giving up
  await expect(async () => {
    if ((await mic.getAttribute('aria-pressed')) !== 'true') await mic.click()
    await expect(mic).toHaveAttribute('aria-pressed', 'true')
  }).toPass({ timeout: 30_000 })

  await page.getByRole('button', { name: 'media settings' }).click()
  const menu = page.getByRole('dialog', { name: 'media settings' })
  const toggle = menu.getByLabel('noise suppression ai')
  await expect(toggle).toBeVisible()
  await toggle.click()

  // loading the ~22 mb of wasm and model and reaching ready takes a
  // moment, the box checks only once the worklet is live
  await expect(toggle).toBeChecked({ timeout: 60_000 })
  await expect(page.getByRole('alert').filter({ hasText: 'failed' })).toHaveCount(0)
  // the mic publication survives the processor swap
  await expect(mic).toHaveAttribute('aria-pressed', 'true')

  await toggle.click()
  await expect(toggle).not.toBeChecked()
  await expect(mic).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('alert').filter({ hasText: 'failed' })).toHaveCount(0)
})
