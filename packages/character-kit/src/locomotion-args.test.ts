import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseWalkArgs, parseFaceArg } from './locomotion.ts'
import { parseTeleportArgs } from './scene-registry.ts'

describe('parseWalkArgs', () => {
  it('parses relative forward/right and caps', () => {
    const r = parseWalkArgs({ forward: 1, right: -0.5, speed: 2 })
    assert.equal(r.ok, true)
    if (!r.ok) return
    assert.equal(r.value.kind, 'relative')
    assert.equal(r.value.forward, 1)
    assert.equal(r.value.right, -0.5)
    assert.equal(r.value.speed, 2)
  })

  it('prefers objectId over to', () => {
    const r = parseWalkArgs({ objectId: 'seat', to: { x: 1, z: 1 }, side: 'left' })
    assert.equal(r.ok, true)
    if (!r.ok) return
    assert.equal(r.value.kind, 'object')
    assert.equal(r.value.objectId, 'seat')
    assert.equal(r.value.side, 'left')
  })

  it('parses to and legacy x/z', () => {
    const a = parseWalkArgs({ to: { x: 2, z: -1 } })
    assert.equal(a.ok, true)
    if (a.ok) assert.deepEqual(a.value.to, { x: 2, z: -1 })
    const b = parseWalkArgs({ x: 3, z: 4 })
    assert.equal(b.ok, true)
    if (b.ok) assert.deepEqual(b.value.to, { x: 3, z: 4 })
  })

  it('rejects empty', () => {
    const r = parseWalkArgs({})
    assert.equal(r.ok, false)
  })

  it('maps gait to speed', () => {
    const r = parseWalkArgs({ forward: 1, gait: 'run' })
    assert.equal(r.ok, true)
    if (r.ok) {
      assert.equal(r.value.speed, 2.4)
      assert.equal(r.value.gait, 'run')
      assert.equal(r.value.gaitExplicit, true)
    }
  })

  it('maps crawl gait', () => {
    const r = parseWalkArgs({ forward: 1, gait: 'crawl' })
    assert.equal(r.ok, true)
    if (r.ok) {
      assert.equal(r.value.gait, 'crawl')
      assert.ok(r.value.speed < 0.6)
    }
  })
})

describe('parseTeleportArgs', () => {
  it('parses object with side/distance', () => {
    const r = parseTeleportArgs({ objectId: 'seat', side: 'back', distance: 1.5 })
    assert.equal(r.ok, true)
    if (!r.ok) return
    assert.equal(r.value.kind, 'object')
    assert.equal(r.value.side, 'back')
    assert.equal(r.value.distance, 1.5)
  })

  it('parses world xz', () => {
    const r = parseTeleportArgs({ x: 1, z: 2 })
    assert.equal(r.ok, true)
    if (r.ok) {
      assert.equal(r.value.kind, 'world')
      assert.equal(r.value.x, 1)
      assert.equal(r.value.z, 2)
    }
  })
})

describe('parseFaceArg', () => {
  it('defaults and parses degrees', () => {
    assert.equal(parseFaceArg(undefined), 'keep')
    assert.equal(parseFaceArg('movement'), 'movement')
    assert.equal(parseFaceArg('camera'), 'camera')
    assert.equal(parseFaceArg(90), 90)
  })
})
