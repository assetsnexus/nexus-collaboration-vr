import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DEFAULT_WALK_TRAIL,
  normalizeWalkTrailOptions,
  parseWalkTrailColor,
} from './walk-trail.ts'

describe('normalizeWalkTrailOptions', () => {
  it('defaults to enabled white 5s trail', () => {
    const opts = normalizeWalkTrailOptions()
    assert.equal(opts.enabled, true)
    assert.equal(opts.color, 0xffffff)
    assert.equal(opts.durationSec, 5)
  })

  it('clamps duration and respects enabled false', () => {
    assert.equal(normalizeWalkTrailOptions({ durationSec: 999 }).durationSec, 60)
    assert.equal(normalizeWalkTrailOptions({ enabled: false }).enabled, false)
  })
})

describe('parseWalkTrailColor', () => {
  it('parses hex strings and ints', () => {
    assert.equal(parseWalkTrailColor('#ff0000').getHex(), 0xff0000)
    assert.equal(parseWalkTrailColor(0x00ff00).getHex(), 0x00ff00)
    assert.equal(parseWalkTrailColor('nope').getHex(), 0xffffff)
  })
})
