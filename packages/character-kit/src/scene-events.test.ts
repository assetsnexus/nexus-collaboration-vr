import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { formatSceneDigest, SceneEventLog } from './scene-events.ts'

describe('SceneEventLog', () => {
  it('drops noisy emotions to latest-face only and skips own actions when draining', () => {
    const log = new SceneEventLog()
    log.recordAction({ agent: 'beta', op: 'emotion', label: 'happy=30', at: 1 })
    log.recordAction({ agent: 'beta', op: 'gesture', label: 'wave', target: '@alpha', at: 2 })
    log.recordAction({ agent: 'alpha', op: 'approach', label: 'seat', target: 'seat', at: 3 })
    log.recordAction({ agent: 'beta', op: 'emotion', label: 'angry=20', at: 4 })

    const forAlpha = log.drainForAgent('alpha')
    assert.equal(forAlpha.events.length, 1)
    assert.equal(forAlpha.events[0]?.agent, 'beta')
    assert.equal(forAlpha.events[0]?.op, 'gesture')
    assert.equal(forAlpha.faces.beta, 'angry=20')
    assert.equal(forAlpha.faces.alpha, undefined)
  })

  it('lets every peer drain independently without dropping the others\' digest', () => {
    const log = new SceneEventLog()
    log.recordAction({ agent: 'beta', op: 'gesture', label: 'wave', target: '@alpha', at: 2 })
    log.recordAction({ agent: 'alpha', op: 'approach', label: 'seat', target: 'seat', at: 3 })
    log.recordAction({ agent: 'delta', op: 'turn_to', label: '@beta', target: '@beta', at: 4 })

    const forAlpha = log.drainForAgent('alpha')
    const forBeta = log.drainForAgent('beta')
    const forDelta = log.drainForAgent('delta')
    assert.deepEqual(
      forAlpha.events.map((e) => e.agent),
      ['beta', 'delta'],
    )
    assert.deepEqual(
      forBeta.events.map((e) => e.agent),
      ['alpha', 'delta'],
    )
    assert.deepEqual(
      forDelta.events.map((e) => e.agent),
      ['beta', 'alpha'],
    )
    assert.equal(log.drainForAgent('alpha').events.length, 0)
  })

  it('skips redundant collisions for the same pair', () => {
    const log = new SceneEventLog()
    const a = log.recordCollision('beta', 'crate', 0.2, 1000)
    const b = log.recordCollision('crate', 'beta', 0.18, 1500)
    const c = log.recordCollision('beta', 'crate', 0.2, 3000)
    assert.ok(a)
    assert.equal(b, null)
    assert.ok(c)
    const digest = formatSceneDigest(log.snapshot(), {})
    assert.match(digest, /contact @beta ↔ crate/)
  })
})
