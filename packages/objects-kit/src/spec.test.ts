import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { defaultSphereSpec, normalizeObjectSpec } from './spec.ts'

describe('ObjectSpec', () => {
  it('defaults to a sphere', () => {
    const s = normalizeObjectSpec(null)
    assert.equal(s.shape, 'sphere')
    assert.ok((s.radius || 0) > 0)
  })

  it('keeps color on defaultSphereSpec', () => {
    assert.equal(defaultSphereSpec('#f00').color, '#f00')
  })
})
