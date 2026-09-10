import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { GESTURE_VARIANT_GROUPS, resolveGestureVariant, defaultGestureTimeScale, clipPlaybackDurationMs, formatClipDuration } from './gesture-variants.ts'

describe('sit variants', () => {
  it('does not treat sit_wave as a sit rest-loop variant', () => {
    assert.deepEqual(GESTURE_VARIANT_GROUPS.sit, ['sit'])
    assert.ok(!GESTURE_VARIANT_GROUPS.sit?.includes('sit_wave'))
  })

  it('resolves sit to sit when loaded', () => {
    const available = ['sit', 'sit_wave', 'idle']
    for (let i = 0; i < 20; i++) {
      assert.equal(resolveGestureVariant('sit', available, { preferExact: true }), 'sit')
    }
  })
})

describe('nod variants', () => {
  it('does not pick agree (double nod) for nod', () => {
    assert.deepEqual(GESTURE_VARIANT_GROUPS.nod, ['nod', 'nod_soft'])
    const available = ['nod', 'nod_soft', 'agree']
    for (let i = 0; i < 40; i++) {
      const id = resolveGestureVariant('nod', available)
      assert.ok(id === 'nod' || id === 'nod_soft', id)
    }
  })
})

describe('defaultGestureTimeScale', () => {
  it('slows nods to 0.7 and leaves other clips at 1', () => {
    assert.equal(defaultGestureTimeScale('nod'), 0.7)
    assert.equal(defaultGestureTimeScale('nod_soft'), 0.7)
    assert.equal(defaultGestureTimeScale('agree'), 0.7)
    assert.equal(defaultGestureTimeScale('wave'), 1)
  })
})

describe('clipPlaybackDurationMs', () => {
  it('returns null for looping or invalid clips', () => {
    assert.equal(clipPlaybackDurationMs(1.2, { loop: true }), null)
    assert.equal(clipPlaybackDurationMs(0), null)
    assert.equal(clipPlaybackDurationMs(Number.NaN), null)
  })

  it('scales wall-clock ms by timeScale', () => {
    assert.equal(clipPlaybackDurationMs(0.5, { timeScale: 1 }), 500)
    assert.equal(clipPlaybackDurationMs(0.5, { timeScale: 0.5 }), 1000)
  })
})

describe('formatClipDuration', () => {
  it('labels loops and missing lengths', () => {
    assert.equal(formatClipDuration(null, true), 'loop')
    assert.equal(formatClipDuration(null), '—')
    assert.equal(formatClipDuration(0), '—')
  })

  it('uses ms under a second and compact seconds after', () => {
    assert.equal(formatClipDuration(450), '450ms')
    assert.equal(formatClipDuration(1200), '1.2s')
    assert.equal(formatClipDuration(3890), '3.9s')
    assert.equal(formatClipDuration(11680), '12s')
  })
})
