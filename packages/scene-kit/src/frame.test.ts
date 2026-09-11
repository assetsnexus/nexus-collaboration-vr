import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fromIfc, toIfc, normalizeFrame, poseInFront } from './frame.ts'

describe('SceneFrame', () => {
  it('defaults to Y-up meters', () => {
    const f = normalizeFrame(null)
    assert.equal(f.units, 'm')
    assert.equal(f.up, 'y')
  })

  it('round-trips IFC Z-up into Y-up display', () => {
    const frame = normalizeFrame({ up: 'y' })
    const scene = fromIfc(1, 2, 3, frame)
    assert.deepEqual(scene, { x: 1, y: 3, z: -2 })
    const back = toIfc(scene.x, scene.y, scene.z, frame)
    assert.deepEqual(back, { x: 1, y: 2, z: 3 })
  })

  it('poseInFront places along yaw', () => {
    const p = poseInFront({ x: 0, y: 0, z: 0, yaw: 0 }, 2, 0.2)
    assert.ok(Math.abs(p.z - 2) < 1e-6)
    assert.equal(p.y, 0.2)
  })
})
