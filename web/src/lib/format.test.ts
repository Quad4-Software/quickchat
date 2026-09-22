import { describe, expect, it } from 'vitest'
import { fileSize, timestamp } from './format'

describe('fileSize', () => {
  it('formats bytes', () => {
    expect(fileSize(0)).toBe('0 B')
    expect(fileSize(512)).toBe('512 B')
    expect(fileSize(1024)).toBe('1.0 KB')
    expect(fileSize(1536)).toBe('1.5 KB')
    expect(fileSize(1 << 20)).toBe('1.0 MB')
    expect(fileSize(1 << 30)).toBe('1.0 GB')
  })
})

describe('timestamp', () => {
  it('returns HH:MM', () => {
    expect(timestamp(0)).toMatch(/^\d{1,2}:\d{2}/)
  })
})
