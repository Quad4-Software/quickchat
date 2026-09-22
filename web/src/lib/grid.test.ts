// SPDX-License-Identifier: 0BSD
import { describe, expect, it } from 'vitest'
import { gridLayout, TILE_ASPECT } from './grid'

describe('gridLayout', () => {
  it('never overflows the container', () => {
    // the core invariant: every tile fits without scrolling
    for (const [w, h] of [
      [1200, 600],
      [390, 500],
      [800, 300],
      [300, 300],
    ]) {
      for (let n = 1; n <= 24; n++) {
        const { cols, tileW, tileH } = gridLayout(n, w, h)
        const rows = Math.ceil(n / cols)
        const gap = 12
        expect(cols * tileW + (cols - 1) * gap).toBeLessThanOrEqual(w + 0.01)
        expect(rows * tileH + (rows - 1) * gap).toBeLessThanOrEqual(h + 0.01)
      }
    }
  })

  it('keeps the tile aspect ratio', () => {
    const { tileW, tileH } = gridLayout(4, 1000, 600)
    expect(tileW / tileH).toBeCloseTo(TILE_ASPECT, 5)
  })

  it('adapts columns to the container shape', () => {
    // 4 tiles on 1600x600: 2x2 gives 522px tiles, bigger than 1x4 at 391
    expect(gridLayout(4, 1600, 600).cols).toBe(2)
    // only very wide stages prefer a single row
    expect(gridLayout(4, 2400, 600).cols).toBe(4)
    // portrait containers stack vertically
    expect(gridLayout(4, 400, 800).cols).toBe(1)
  })

  it('maximizes tile area', () => {
    const w = 1000
    const h = 700
    const n = 5
    const best = gridLayout(n, w, h)
    for (let cols = 1; cols <= n; cols++) {
      const rows = Math.ceil(n / cols)
      const altW = Math.min(
        (w - 12 * (cols - 1)) / cols,
        ((h - 12 * (rows - 1)) / rows) * TILE_ASPECT,
      )
      expect(best.tileW).toBeGreaterThanOrEqual(altW - 0.01)
    }
  })

  it('handles degenerate input', () => {
    expect(gridLayout(0, 100, 100).tileW).toBe(0)
    expect(gridLayout(3, 0, 100).tileW).toBe(0)
  })
})
