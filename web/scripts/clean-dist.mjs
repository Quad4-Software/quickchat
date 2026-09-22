// empties dist/ except .gitkeep, which keeps the go:embed directive
// resolvable on fresh checkouts before the first web build
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const dist = new URL('../dist', import.meta.url).pathname
mkdirSync(dist, { recursive: true })
for (const name of readdirSync(dist)) {
  if (name !== '.gitkeep') rmSync(join(dist, name), { recursive: true, force: true })
}
