import { describe, expect, test } from 'vitest'
import { parseMd } from './markdown'

describe('parseMd', () => {
  test('plain text stays a single text node', () => {
    expect(parseMd('hello world')).toEqual([{ k: 'text', s: 'hello world' }])
  })

  test('inline code strips the ticks and ignores markup inside', () => {
    expect(parseMd('run `npm test` now')).toEqual([
      { k: 'text', s: 'run ' },
      { k: 'code', s: 'npm test' },
      { k: 'text', s: ' now' },
    ])
    expect(parseMd('`**not bold**`')).toEqual([{ k: 'code', s: '**not bold**' }])
  })

  test('bold and italic parse separately', () => {
    expect(parseMd('**bold** *ital*')).toEqual([
      { k: 'bold', s: 'bold' },
      { k: 'text', s: ' ' },
      { k: 'ital', s: 'ital' },
    ])
  })

  test('fenced blocks emit pre nodes and keep inline markup literal', () => {
    expect(parseMd('a\n```\nx *y* z\n```\nb')).toEqual([
      { k: 'text', s: 'a\n' },
      { k: 'pre', s: 'x *y* z' },
      { k: 'text', s: '\nb' },
    ])
  })

  test('bare urls become links', () => {
    expect(parseMd('see https://example.com/a?b=1 here')).toEqual([
      { k: 'text', s: 'see ' },
      { k: 'link', s: 'https://example.com/a?b=1', href: 'https://example.com/a?b=1' },
      { k: 'text', s: ' here' },
    ])
  })

  test('trailing punctuation stays out of the link', () => {
    const nodes = parseMd('https://example.com)')
    expect(nodes).toEqual([
      { k: 'link', s: 'https://example.com', href: 'https://example.com' },
      { k: 'text', s: ')' },
    ])
  })

  test('unclosed markers degrade to text', () => {
    expect(parseMd('this **never closes')).toEqual([
      { k: 'text', s: 'this **never closes' },
    ])
    expect(parseMd('```\nunclosed')).toEqual([{ k: 'text', s: '```\nunclosed' }])
  })
})
