import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createIdleScalePulse, stepIdleTimeScalePulse } from './idle-pulse.ts'

function seqRng(values: number[]): () => number {
  let i = 0
  return () => values[i++ % values.length]!
}

describe('stepIdleTimeScalePulse', () => {
  it('stays near the mood center with a modest breath range', () => {
    const rng = seqRng([0.2, 0.5, 0.8, 0.1, 0.9, 0.4])
    const state = createIdleScalePulse(rng)
    const center = 0.85
    const samples: number[] = []
    for (let i = 0; i < 400; i++) {
      samples.push(stepIdleTimeScalePulse(state, 0.05, center, rng))
    }
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length
    const min = Math.min(...samples)
    const max = Math.max(...samples)
    assert.ok(mean > center - 0.08 && mean < center + 0.08, `mean ${mean}`)
    assert.ok(min >= center * 0.85, `min ${min}`)
    assert.ok(max <= center * 1.15, `max ${max}`)
    assert.ok(max - min > 0.01, `range ${max - min}`)
  })
})
