// SPDX-License-Identifier: 0BSD

// chunk load failures happen when a deploy replaces hashed assets while a
// client still holds the old index.html. reloading once pulls the new
// index and the matching chunks. the sessionStorage guard stops a reload
// loop when the deploy itself is broken.
const CHUNK_RE =
  /dynamically imported module|importing a module script|chunkload|loading chunk|failed to fetch/i
const RELOAD_KEY = 'qc-chunk-reload'
const RELOAD_WINDOW_MS = 60_000

export function isChunkError(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err)
  return CHUNK_RE.test(msg)
}

// returns true when a reload was triggered. injectable reload for tests.
export function reloadForChunkError(
  err: unknown,
  reload: () => void = () => location.reload(),
): boolean {
  if (!isChunkError(err)) return false
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0)
    if (Date.now() - last < RELOAD_WINDOW_MS) return false
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
  } catch {
    // storage unavailable: reloading could loop forever, so stay down
    return false
  }
  reload()
  return true
}
