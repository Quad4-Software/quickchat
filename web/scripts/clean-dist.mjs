// empties dist/ except .gitkeep, which keeps the go:embed directive
// resolvable on fresh checkouts before the first web build
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

// fileURLToPath keeps the drive letter on windows, pathname would
// produce /D:/... which resolves as a nested drive path
const dist = fileURLToPath(new URL('../dist', import.meta.url))
mkdirSync(dist, { recursive: true })
for (const name of readdirSync(dist)) {
  if (name !== '.gitkeep') rmSync(join(dist, name), { recursive: true, force: true })
}
