import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { newId } from './id.ts'

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

describe('newId', () => {
  it('returns a UUID v4', () => {
    assert.match(newId(), UUID_V4)
  })

  it('falls back when randomUUID is missing (insecure HTTP origins)', () => {
    const a = newId({ getRandomValues: (buf) => crypto.getRandomValues(buf) })
    const b = newId({ getRandomValues: (buf) => crypto.getRandomValues(buf) })
    assert.match(a, UUID_V4)
    assert.match(b, UUID_V4)
    assert.notEqual(a, b)
  })
})
