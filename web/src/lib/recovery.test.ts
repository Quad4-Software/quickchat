// SPDX-License-Identifier: 0BSD
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isChunkError, reloadForChunkError } from './recovery'

function stubStorage() {
  const map = new Map<string, string>()
  vi.stubGlobal('sessionStorage', {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => map.set(k, v),
    removeItem: (k: string) => map.delete(k),
  })
  return map
}

afterEach(() => vi.unstubAllGlobals())

describe('isChunkError', () => {
  it('matches bundler chunk load failures', () => {
    expect(
      isChunkError(
        new TypeError('Failed to fetch dynamically imported module: /assets/x.js'),
      ),
    ).toBe(true)
    expect(isChunkError(new Error('ChunkLoadError: loading chunk 3 failed'))).toBe(true)
    expect(isChunkError(new Error('error loading dynamically imported module'))).toBe(
      true,
    )
  })

  it('rejects unrelated errors', () => {
    expect(isChunkError(new Error('room not found'))).toBe(false)
    expect(isChunkError(new TypeError('undefined is not a function'))).toBe(false)
    expect(isChunkError('string failure')).toBe(false)
    expect(isChunkError(null)).toBe(false)
  })
})

describe('reloadForChunkError', () => {
  it('reloads once for a chunk error', () => {
    stubStorage()
    const reload = vi.fn()
    expect(
      reloadForChunkError(
        new Error('Failed to fetch dynamically imported module'),
        reload,
      ),
    ).toBe(true)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('never reloads for unrelated errors', () => {
    stubStorage()
    const reload = vi.fn()
    expect(reloadForChunkError(new Error('boom'), reload)).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })

  it('suppresses a second reload inside the window', () => {
    stubStorage()
    const reload = vi.fn()
    const err = new Error('Failed to fetch dynamically imported module')
    expect(reloadForChunkError(err, reload)).toBe(true)
    expect(reloadForChunkError(err, reload)).toBe(false)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('stays down when storage is unavailable', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {},
    })
    const reload = vi.fn()
    expect(
      reloadForChunkError(
        new Error('Failed to fetch dynamically imported module'),
        reload,
      ),
    ).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })
})
