import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  LOCO_AUTO_RUN_SEC,
  LOCO_GAIT_DEFAULT_CLIP,
  applyAutoRun,
  gaitFromSpeed,
  parseGaitArg,
  parseLocomotionOverrides,
  resolveLocomotionClipId,
  speedForGait,
} from './locomotion.ts'

describe('parseGaitArg / gaitFromSpeed', () => {
  it('parses aliases', () => {
    assert.equal(parseGaitArg('sneak'), 'careful')
    assert.equal(parseGaitArg('crouching'), 'crouch')
    assert.equal(parseGaitArg('RUN'), 'run')
    assert.equal(parseGaitArg('nope'), undefined)
  })

  it('maps speed bands', () => {
    assert.equal(gaitFromSpeed(0.4), 'crawl')
    assert.equal(gaitFromSpeed(0.7), 'crouch')
    assert.equal(gaitFromSpeed(1.0), 'careful')
    assert.equal(gaitFromSpeed(1.4), 'walk')
    assert.equal(gaitFromSpeed(2.5), 'run')
  })
})

describe('applyAutoRun', () => {
  it('upgrades long walks', () => {
    const dist = LOCO_AUTO_RUN_SEC * 1.4 + 0.5
    const r = applyAutoRun(dist, 1.4, 'walk')
    assert.equal(r.autoRan, true)
    assert.equal(r.gait, 'run')
    assert.ok(r.speed >= 2.4)
  })

  it('keeps short walks', () => {
    const r = applyAutoRun(2, 1.4, 'walk')
    assert.equal(r.autoRan, false)
    assert.equal(r.gait, 'walk')
  })

  it('respects explicit crawl', () => {
    const dist = 20
    const r = applyAutoRun(dist, 0.45, 'crawl', { gaitExplicit: true })
    assert.equal(r.autoRan, false)
    assert.equal(r.gait, 'crawl')
  })
})

describe('resolveLocomotionClipId', () => {
  it('uses overrides then defaults then fallback', () => {
    assert.equal(
      resolveLocomotionClipId('run', { run: 'sprint' }, ['sprint', 'walk']),
      'sprint',
    )
    assert.equal(resolveLocomotionClipId('run', {}, ['walk']), 'walk')
    assert.equal(
      resolveLocomotionClipId('crawl', {}, ['walk_crawl', 'walk']),
      LOCO_GAIT_DEFAULT_CLIP.crawl,
    )
  })
})

describe('parseLocomotionOverrides', () => {
  it('keeps known gait keys', () => {
    const o = parseLocomotionOverrides({ walk: 'my_walk', run: ' my_run ', junk: 'x' })
    assert.equal(o.walk, 'my_walk')
    assert.equal(o.run, 'my_run')
    assert.equal(o.crawl, undefined)
  })
})

describe('speedForGait', () => {
  it('returns nominals', () => {
    assert.equal(speedForGait('walk'), 1.4)
    assert.equal(speedForGait('run'), 2.4)
  })
})
