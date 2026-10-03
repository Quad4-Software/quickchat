import { describe, expect, test } from 'vitest'
import { reactMutate } from './reactions'

describe('reactMutate', () => {
  test('adding a reaction on an empty map creates the emoji key', () => {
    expect(reactMutate(undefined, '👍', 'alice', true)).toEqual({
      '👍': ['alice'],
    })
  })

  test('the same name cannot appear twice under one emoji', () => {
    const once = reactMutate({ '👍': ['alice'] }, '👍', 'alice', true)
    expect(once).toEqual({ '👍': ['alice'] })
  })

  test('removing the last name drops the emoji key entirely', () => {
    const m = reactMutate({ '👍': ['alice'], '🔥': ['bob'] }, '👍', 'alice', false)
    expect(m).toEqual({ '🔥': ['bob'] })
  })

  test('removing one of several names keeps the rest', () => {
    const m = reactMutate({ '👍': ['alice', 'bob'] }, '👍', 'alice', false)
    expect(m).toEqual({ '👍': ['bob'] })
  })

  test('the input map is never mutated', () => {
    const src = { '👍': ['alice'] }
    reactMutate(src, '🔥', 'bob', true)
    expect(src).toEqual({ '👍': ['alice'] })
  })
})
