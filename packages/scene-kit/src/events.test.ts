import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { SceneEventLog } from './events.ts'

describe('events', () => {
  it('dedups collisions', () => {
    const log = new SceneEventLog()
    const a = log.recordCollision('a', 'b', 0.4, 1000)
    const b = log.recordCollision('b', 'a', 0.4, 1100)
    assert.ok(a)
    assert.equal(b, null)
  })
})
