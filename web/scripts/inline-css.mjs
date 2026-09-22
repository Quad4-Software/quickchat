// Inlines the emitted stylesheet into index.html so first paint does not
// wait on a render-blocking css request. The bundle is a single small css
// file (tailwind), so inlining it is a strict win for an app this size.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const dist = new URL('../dist', import.meta.url).pathname
const htmlPath = join(dist, 'index.html')
const html = readFileSync(htmlPath, 'utf8')

const linkRe = /<link rel="stylesheet"[^>]*href="\/(assets\/[^"]+\.css)"[^>]*\/?>/
const match = html.match(linkRe)
if (!match) {
  console.error('inline-css: no stylesheet link found in index.html')
  process.exit(1)
}

const css = readFileSync(join(dist, match[1]), 'utf8')
writeFileSync(htmlPath, html.replace(linkRe, `<style>\n${css}</style>`))
console.log(`inline-css: inlined ${match[1]} (${css.length} bytes)`)
