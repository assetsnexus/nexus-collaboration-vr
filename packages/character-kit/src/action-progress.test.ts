import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { actionTimedProgress } from './action-progress.ts'

describe('actionTimedProgress', () => {
  it('is null without a fixed duration', () => {
    assert.equal(actionTimedProgress({ at: 0, status: 'playing' }, 100), null)
    assert.equal(actionTimedProgress({ at: 0, status: 'playing', durationMs: 0 }, 100), null)
  })

  it('fills from start time while playing', () => {
    const p = actionTimedProgress({ at: 1000, durationMs: 500, status: 'playing' }, 1250)
    assert.equal(p?.canceled, false)
    assert.equal(p?.ratio, 0.5)
  })

  it('clamps to 1 when done', () => {
    const p = actionTimedProgress(
      { at: 0, durationMs: 400, endedAt: 400, status: 'done' },
      800,
    )
    assert.equal(p?.canceled, false)
    assert.equal(p?.ratio, 1)
  })

  it('freezes at the cancel point', () => {
    const p = actionTimedProgress(
      { at: 0, durationMs: 1000, endedAt: 250, status: 'canceled' },
      5000,
    )
    assert.equal(p?.canceled, true)
    assert.equal(p?.ratio, 0.25)
  })

  it('marks discarded pending as canceled at 0', () => {
    const p = actionTimedProgress(
      { at: 10, durationMs: 800, endedAt: 10, status: 'discarded' },
      100,
    )
    assert.equal(p?.canceled, true)
    assert.equal(p?.ratio, 0)
  })
})
