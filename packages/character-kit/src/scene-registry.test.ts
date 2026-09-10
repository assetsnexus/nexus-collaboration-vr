import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  SceneRegistry,
  createBuiltinSceneObjects,
  normalizeSceneObject,
  standBeside,
  clampStandDistance,
} from './scene-registry.ts'

describe('standBeside', () => {
  const obj = normalizeSceneObject({
    id: 'box',
    kind: 'prop',
    label: 'Box',
    position: { x: 0, y: 0, z: 0 },
    yawDeg: 0,
    radius: 0.5,
    tags: [],
  })

  it('front-to-front: stand on +Z and face the object', () => {
    const pose = standBeside(obj, { side: 'front', distance: 1 })
    // radius 0.5 + 1 = 1.5 along +Z
    assert.ok(Math.abs(pose.z - 1.5) < 1e-9)
    assert.ok(Math.abs(pose.x) < 1e-9)
    // face toward origin from +Z → facing π (or -π)
    assert.ok(Math.abs(Math.abs(pose.facingRad) - Math.PI) < 1e-6)
  })

  it('left still faces the object', () => {
    const pose = standBeside(obj, { side: 'left', distance: 0 })
    // left orbit 90° → +X
    assert.ok(Math.abs(pose.x - 0.5) < 1e-9)
    assert.ok(Math.abs(pose.z) < 1e-9)
    // face toward 0 from +X → facing -π/2-ish (atan2(-0.5, 0) wait: atan2(0-0.5, 0-0)=atan2(-0.5,0)= -π/2? 
    // atan2(obj.x - x, obj.z - z) = atan2(0-0.5, 0-0) = atan2(-0.5, 0) = -π/2 or π?
    // Actually atan2(-0.5, 0) = -π/2 in JS? atan2(y,x) no — atan2(y,x) with y=-0.5 x=0 → -π/2
    // Our formula: atan2(dx, dz) = atan2(-0.5, 0). In JS Math.atan2(-0.5, 0) === -Math.PI/2
    assert.ok(Math.abs(pose.facingRad + Math.PI / 2) < 1e-6)
  })

  it('distance is radius + extra', () => {
    const pose = standBeside(obj, { side: 'front', distance: 2 })
    assert.ok(Math.abs(pose.z - 2.5) < 1e-9)
  })

  it('respects object yaw', () => {
    const turned = normalizeSceneObject({ ...obj, yawDeg: 90 })
    const pose = standBeside(turned, { side: 'front', distance: 0 })
    // yaw 90° → forward +X
    assert.ok(Math.abs(pose.x - 0.5) < 1e-9)
    assert.ok(Math.abs(pose.z) < 1e-9)
  })
})

describe('clampStandDistance', () => {
  it('defaults and clamps', () => {
    assert.equal(clampStandDistance(undefined), 1)
    assert.equal(clampStandDistance(-1), 0)
    assert.equal(clampStandDistance(99), 6)
  })
})

describe('SceneRegistry', () => {
  it('filters by kind/tag/query and reports total vs limit', () => {
    const reg = new SceneRegistry()
    for (const o of createBuiltinSceneObjects()) reg.register(o)
    reg.register({
      id: 'marker_left',
      kind: 'prop',
      label: 'Left marker',
      position: { x: -2, y: 0, z: 0 },
      yawDeg: 0,
      radius: 0.25,
      tags: ['demo'],
      description: 'Floor marker on the left',
    })

    const seats = reg.list({ kind: 'seat' })
    assert.equal(seats.total, 1)
    assert.equal(seats.objects[0]!.id, 'seat')

    const demo = reg.list({ tag: 'demo' })
    assert.equal(demo.total, 1)
    assert.equal(demo.objects[0]!.id, 'marker_left')

    const q = reg.list({ query: 'spawn' })
    assert.equal(q.total, 1)

    const limited = reg.list({ limit: 1 })
    assert.ok(limited.total >= 3)
    assert.equal(limited.objects.length, 1)
  })

  it('get missing returns undefined', () => {
    const reg = new SceneRegistry()
    assert.equal(reg.get('nope'), undefined)
  })

  it('update patches position', () => {
    const reg = new SceneRegistry()
    reg.register(createBuiltinSceneObjects()[0]!)
    const u = reg.update('spawn', { position: { x: 1, y: 0, z: 2 } })
    assert.ok(u)
    assert.equal(u!.position.x, 1)
    assert.equal(u!.position.z, 2)
  })
})
