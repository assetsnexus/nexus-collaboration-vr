import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createMoodFacePulse, stepMoodFacePulse } from './face-pulse.ts'

function seqRng(values: number[]): () => number {
  let i = 0
  return () => values[i++ % values.length]!
}

describe('stepMoodFacePulse', () => {
  it('stays near rest intensity and within a modest band', () => {
    const rng = seqRng([0.2, 0.5, 0.8, 0.1, 0.9, 0.4])
    const state = createMoodFacePulse(rng)
    const rest = 0.4
    const samples: number[] = []
    for (let i = 0; i < 400; i++) {
      samples.push(stepMoodFacePulse(state, 0.05, rest, rng))
    }
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length
    const min = Math.min(...samples)
    const max = Math.max(...samples)
    assert.ok(mean > rest - 0.12 && mean < rest + 0.12, `mean ${mean}`)
    assert.ok(min >= 0.06 && min < rest, `min ${min}`)
    assert.ok(max <= 0.92 && max > rest, `max ${max}`)
    assert.ok(max - min > 0.04, `range ${max - min}`)
  })

  it('does not jump to 0 or 1 even at high rest', () => {
    const rng = seqRng([0.99, 0.01, 0.5])
    const state = createMoodFacePulse(rng)
    for (let i = 0; i < 80; i++) {
      const w = stepMoodFacePulse(state, 0.05, 0.85, rng)
      assert.ok(w >= 0.06 && w <= 0.92, `w ${w}`)
    }
  })
})
