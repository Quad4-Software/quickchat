import { describe, expect, it } from 'vitest'
import { generateKey, keyFromHash } from './e2ee'
import { newNonce } from './chat'

// generateKey emits url-safe base64 for the fragment, keyFromHash returns
// standard base64 for livekit setKey. Compare decoded bytes.
function decode(s: string): Uint8Array {
  const b64 = s.replaceAll('-', '+').replaceAll('_', '/')
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}

describe('e2ee key helpers', () => {
  it('round-trips a generated key through the hash', () => {
    const key = generateKey()
    const parsed = keyFromHash(`#e2ee=${key}`)
    expect(parsed).not.toBeNull()
    expect(decode(parsed!)).toEqual(decode(key))
  })

  it('accepts hash without leading #', () => {
    const key = generateKey()
    const parsed = keyFromHash(`e2ee=${key}`)
    expect(parsed).not.toBeNull()
    expect(decode(parsed!)).toEqual(decode(key))
  })

  it('rejects empty and malformed fragments', () => {
    expect(keyFromHash('')).toBeNull()
    expect(keyFromHash('#')).toBeNull()
    expect(keyFromHash('#other=abc')).toBeNull()
    expect(keyFromHash('#e2ee=')).toBeNull()
    expect(keyFromHash('#e2ee=not!valid!base64!')).toBeNull()
    // valid base64url but wrong length (16 bytes instead of 32)
    expect(keyFromHash('#e2ee=AAAAAAAAAAAAAAAAAAAAAA')).toBeNull()
  })

  it('generates unique keys', () => {
    const keys = new Set(Array.from({ length: 100 }, generateKey))
    expect(keys.size).toBe(100)
  })
})

describe('newNonce', () => {
  it('returns 32 hex chars within the server nonce cap', () => {
    const n = newNonce()
    expect(n).toMatch(/^[0-9a-f]{32}$/)
  })

  it('generates unique nonces', () => {
    const nonces = new Set(Array.from({ length: 1000 }, newNonce))
    expect(nonces.size).toBe(1000)
  })
})
