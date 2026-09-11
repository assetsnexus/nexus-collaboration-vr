import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { resolveEffectClip, normalizeEffectClip, BUILTIN_EFFECTS } from './effects.ts'

describe('effects', () => {
  it('resolves builtins', () => {
    assert.ok(resolveEffectClip('glow'))
    assert.equal(Object.keys(BUILTIN_EFFECTS).includes('pulse'), true)
  })

  it('accepts custom clips', () => {
    const clip = normalizeEffectClip({
      id: 'spark',
      ops: [{ op: 'glow', color: '#fff', durationMs: 500 }],
    })
    assert.equal(clip?.id, 'spark')
  })
})
