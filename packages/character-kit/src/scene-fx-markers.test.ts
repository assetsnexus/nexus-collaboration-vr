import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import * as THREE from 'three'
import { normalizeSceneObject } from './scene-registry.ts'
import {
  applyStandInTransform,
  FLOOR_MARKER_Y,
  FLOOR_PLATE_HEIGHT,
  standInStyle,
} from './scene-fx-markers.ts'

describe('standInStyle', () => {
  it('keeps spawn/seat on the floor and hides camera', () => {
    assert.equal(standInStyle('landmark'), 'floor-disc')
    assert.equal(standInStyle('seat'), 'floor-plate')
    assert.equal(standInStyle('camera'), 'hidden')
    assert.equal(standInStyle('avatar'), 'hidden')
    assert.equal(standInStyle('prop'), 'box')
  })
})

describe('applyStandInTransform', () => {
  it('lays spawn on the floor instead of a standing box', () => {
    const mesh = new THREE.Object3D()
    const spawn = normalizeSceneObject({
      id: 'spawn',
      kind: 'landmark',
      position: { x: 0, y: 0, z: 0 },
      radius: 0.3,
    })
    applyStandInTransform(mesh, spawn)
    assert.equal(mesh.position.y, FLOOR_MARKER_Y)
    assert.ok(Math.abs(mesh.rotation.x + Math.PI / 2) < 1e-6)
    assert.equal(mesh.visible, true)
  })

  it('keeps the seat plate on the floor, not at hip height', () => {
    const mesh = new THREE.Object3D()
    const seat = normalizeSceneObject({
      id: 'seat',
      kind: 'seat',
      position: { x: 0, y: 0.22, z: 0 },
      size: { x: 0.44, y: 0.44, z: 0.44 },
    })
    applyStandInTransform(mesh, seat)
    assert.ok(mesh.position.y < 0.05)
    assert.equal(mesh.position.y, FLOOR_MARKER_Y + FLOOR_PLATE_HEIGHT / 2)
    assert.equal(mesh.scale.y, FLOOR_PLATE_HEIGHT)
  })
})
