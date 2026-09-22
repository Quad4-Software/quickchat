import { describe, expect, it } from 'vitest'
import { randomName } from './names'

describe('randomName', () => {
  it('matches adjective-noun-number', () => {
    for (let i = 0; i < 50; i++) {
      expect(randomName()).toMatch(/^[a-z]+-[a-z]+-\d{1,2}$/)
    }
  })

  it('produces varied names', () => {
    const names = new Set(Array.from({ length: 50 }, randomName))
    expect(names.size).toBeGreaterThan(30)
  })

  it('fits the 32 char name limit', () => {
    for (let i = 0; i < 50; i++) {
      expect(randomName().length).toBeLessThanOrEqual(32)
    }
  })
})
