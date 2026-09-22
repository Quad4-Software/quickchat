// e2ee keys ride in the URL fragment so they are never sent to the server.
// Anyone opening the shared link joins with the same key. Joining without
// the fragment falls back to standard DTLS-SRTP.

function toBase64Url(b: Uint8Array): string {
  let s = ''
  for (const x of b) s += String.fromCharCode(x)
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replaceAll('-', '+').replaceAll('_', '/')
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function generateKey(): string {
  const b = new Uint8Array(32)
  crypto.getRandomValues(b)
  return toBase64Url(b)
}

// keyFromHash returns the base64 key from #e2ee=..., or null.
export function keyFromHash(hash: string): string | null {
  const m = /^#?e2ee=([A-Za-z0-9_-]+)$/.exec(hash)
  if (!m) return null
  try {
    const raw = fromBase64Url(m[1])
    if (raw.length !== 32) return null
    return btoa(String.fromCharCode(...raw))
  } catch {
    return null
  }
}
