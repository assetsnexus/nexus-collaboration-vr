import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  rmsFromFloat32,
  rmsFromTimeDomain,
  speechEnergy,
  waveBarHeights,
} from './audio-meter.ts'

describe('rmsFromFloat32', () => {
  it('returns 0 for empty or silence', () => {
    assert.equal(rmsFromFloat32([]), 0)
    assert.equal(rmsFromFloat32([0, 0, 0, 0]), 0)
  })

  it('is 1 for full-scale square wave', () => {
    assert.equal(rmsFromFloat32([1, -1, 1, -1]), 1)
  })
})

describe('rmsFromTimeDomain', () => {
  it('returns 0 for empty or center-line silence', () => {
    assert.equal(rmsFromTimeDomain([]), 0)
    assert.equal(rmsFromTimeDomain([128, 128, 128, 128]), 0)
  })

  it('peaks near 1 at full deflection', () => {
    const rms = rmsFromTimeDomain([0, 255, 0, 255])
    assert.ok(rms > 0.99)
  })
})

describe('speechEnergy', () => {
  it('clamps and gates by speech probability', () => {
    assert.equal(speechEnergy(0), 0)
    assert.ok(speechEnergy(0.2, 1) > speechEnergy(0.2, 0.1))
    assert.equal(speechEnergy(10, 1), 1)
  })
})

describe('waveBarHeights', () => {
  it('returns count bars in 0.08..1', () => {
    const bars = waveBarHeights(0.7, 5, 0.4)
    assert.equal(bars.length, 5)
    for (const h of bars) {
      assert.ok(h >= 0.16 && h <= 1)
    }
  })

  it('idle energy stays near the floor', () => {
    const bars = waveBarHeights(0, 7, 0)
    assert.ok(bars.every((h) => h <= 0.2))
  })
})
