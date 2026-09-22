// SPDX-License-Identifier: 0BSD
// captures showcase screenshots from the built app. the room shot uses
// the demo bundle so no server is needed and the scene is reproducible.
//
//   pnpm shots
//
// writes ../showcase/{home,room,room-mobile}.png and leaves dist in the
// normal production state when done.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, extname, resolve } from 'node:path'
import { chromium } from '@playwright/test'

const web = resolve(new URL('..', import.meta.url).pathname)
const dist = join(web, 'dist')
const outDir = resolve(web, '..', 'showcase')
mkdirSync(outDir, { recursive: true })

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain',
}

function serve() {
  return new Promise((ok) => {
    const server = createServer(async (req, res) => {
      try {
        // the demo bundle is built with base /quickchat/ so strip it
        let p = decodeURIComponent(new URL(req.url, 'http://x').pathname)
        p = p.replace(/^\/quickchat/, '') || '/'
        let file = join(dist, p)
        if (p === '/' || !existsSync(file) || statSync(file).isDirectory())
          file = join(dist, 'index.html')
        const body = await readFile(file)
        res.setHeader('content-type', MIME[extname(file)] ?? 'application/octet-stream')
        res.end(body)
      } catch {
        res.statusCode = 404
        res.end()
      }
    })
    server.listen(0, '127.0.0.1', () => ok(server))
  })
}

function build(demo) {
  execFileSync('pnpm', ['-C', web, demo ? 'build:demo' : 'build'], {
    stdio: 'inherit',
  })
}

const DESKTOP = { width: 1280, height: 800 }
const MOBILE = { width: 390, height: 844 }

async function shot(url, file, viewport, ready) {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport })
  await page.goto(url, { waitUntil: 'networkidle' })
  if (ready) await ready(page)
  await page.screenshot({ path: join(outDir, file) })
  await browser.close()
  console.log(`wrote showcase/${file}`)
}

// room shots first, from the demo bundle so peers are scripted
build(true)
let server = await serve()
const base = `http://127.0.0.1:${server.address().port}`
const seeded = (page) =>
  page.waitForSelector('img', { timeout: 15000 }).then(() => page.waitForTimeout(400))
await shot(`${base}/#/`, 'room.png', DESKTOP, seeded)
await shot(`${base}/#/`, 'room-mobile.png', MOBILE, seeded)
server.close()

// landing page from the production bundle
build(false)
server = await serve()
const base2 = `http://127.0.0.1:${server.address().port}`
await shot(`${base2}/`, 'home.png', DESKTOP, (page) => page.waitForTimeout(600))
server.close()
