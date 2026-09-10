import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  LocomotionState,
  LOCO_ARRIVE_EPS,
  LOCO_MAX_RELATIVE_M,
  LOCO_WALK_SPEED,
  capRelativeMeters,
  clampMoveInput,
  clampSpeed,
  relativeOffset,
  resolveFaceRad,
} from './locomotion.ts'

describe('clampMoveInput', () => {
  it('clamps to unit circle', () => {
    const a = clampMoveInput({ x: 3, z: 4, yaw: 0, jump: false })
    assert.ok(Math.abs(Math.hypot(a.x, a.z) - 1) < 1e-9)
    assert.ok(Math.abs(a.x - 0.6) < 1e-9)
    assert.ok(Math.abs(a.z - 0.8) < 1e-9)
  })

  it('clamps yaw and defaults missing fields', () => {
    const a = clampMoveInput({ yaw: 5 })
    assert.equal(a.x, 0)
    assert.equal(a.z, 0)
    assert.equal(a.yaw, 1)
    assert.equal(a.jump, false)
  })
})

describe('clampSpeed / capRelativeMeters', () => {
  it('maps gait and clamps speed', () => {
    assert.equal(clampSpeed(undefined), LOCO_WALK_SPEED)
    assert.equal(clampSpeed(undefined, 'run'), 2.4)
    assert.equal(clampSpeed(0.1), 0.3)
    assert.equal(clampSpeed(99), 3.5)
  })

  it('caps relative distance', () => {
    const c = capRelativeMeters(100, 0)
    assert.equal(c.forward, LOCO_MAX_RELATIVE_M)
    assert.equal(c.right, 0)
  })
})

describe('relativeOffset', () => {
  it('forward when facing +Z is +z', () => {
    const o = relativeOffset(0, 2, 0)
    assert.ok(Math.abs(o.x) < 1e-9)
    assert.ok(Math.abs(o.z - 2) < 1e-9)
  })

  it('right when facing +Z is +x', () => {
    const o = relativeOffset(0, 0, 1.5)
    assert.ok(Math.abs(o.x - 1.5) < 1e-9)
    assert.ok(Math.abs(o.z) < 1e-9)
  })
})

describe('LocomotionState', () => {
  it('moves camera-relative forward with stick', () => {
    const loco = new LocomotionState()
    loco.setMoveInput({ x: 0, z: 1, yaw: 0, jump: false })
    // cameraYaw 0 → stick z maps to world +Z
    for (let i = 0; i < 30; i++) loco.tick(0.05, 0)
    assert.ok(loco.z > 0.5)
    assert.ok(Math.abs(loco.x) < 0.15)
    assert.equal(loco.moving, true)
    // faces travel direction (+Z → facing ~0)
    assert.ok(Math.abs(loco.facing) < 0.35)
  })

  it('strafe right matches screen-right when camera looks from +Z', () => {
    const loco = new LocomotionState()
    loco.setMoveInput({ x: 1, z: 0, yaw: 0, jump: false })
    // Default playground camera: look yaw ≈ π (from +Z toward origin)
    for (let i = 0; i < 30; i++) loco.tick(0.05, Math.PI)
    assert.ok(loco.x > 0.5)
    assert.ok(Math.abs(loco.z) < 0.15)
  })

  it('applies Q/E yaw', () => {
    const loco = new LocomotionState()
    loco.setMoveInput({ x: 0, z: 0, yaw: 1, jump: false })
    for (let i = 0; i < 20; i++) loco.tick(0.05, 0)
    assert.ok(loco.facing > 0.5)
  })

  it('jumps then lands; no double jump while airborne', () => {
    const loco = new LocomotionState()
    loco.setMoveInput({ x: 0, z: 0, yaw: 0, jump: true })
    const r1 = loco.tick(0.016, 0)
    assert.equal(r1.jumped, true)
    assert.equal(loco.grounded, false)
    assert.ok(loco.y > 0)
    // still holding jump
    const r2 = loco.tick(0.016, 0)
    assert.equal(r2.jumped, false)
    // land
    for (let i = 0; i < 120; i++) {
      loco.setMoveInput({ x: 0, z: 0, yaw: 0, jump: false })
      loco.tick(0.05, 0)
    }
    assert.equal(loco.grounded, true)
    assert.equal(loco.y, 0)
  })

  it('seeks to xz and arrives facing faceAt', () => {
    const loco = new LocomotionState()
    loco.beginSeek({ x: 2, z: 0, speed: 2, face: 'keep', faceAt: { x: 2, z: 2 } })
    let arrived = false
    for (let i = 0; i < 200; i++) {
      const r = loco.tick(0.05, 0)
      if (r.arrived) {
        arrived = true
        break
      }
    }
    assert.equal(arrived, true)
    assert.ok(Math.hypot(loco.x - 2, loco.z) < LOCO_ARRIVE_EPS + 0.01)
    // face toward (2,2) from (2,0) → +Z → facing ~0
    assert.ok(Math.abs(loco.facing) < 0.2)
    assert.equal(loco.seeking, false)
  })

  it('stick cancels seek', () => {
    const loco = new LocomotionState()
    loco.beginSeek({ x: 5, z: 5, speed: 1, face: 'camera' })
    loco.setMoveInput({ x: 0, z: 1, yaw: 0, jump: false })
    const r = loco.tick(0.05, 0)
    assert.equal(r.cancelledSeek, true)
    assert.equal(loco.seeking, false)
  })

  it('setPose teleports and clears seek', () => {
    const loco = new LocomotionState()
    loco.beginSeek({ x: 3, z: 3, speed: 1, face: 'camera' })
    loco.setPose(1, -1, Math.PI / 2)
    assert.equal(loco.x, 1)
    assert.equal(loco.z, -1)
    assert.equal(loco.seeking, false)
    assert.equal(loco.moving, false)
  })

  it('resolveFaceRad camera is 0', () => {
    assert.equal(resolveFaceRad('camera', 1, null), 0)
    assert.equal(resolveFaceRad('keep', 1.2, null), 1.2)
    assert.ok(Math.abs(resolveFaceRad(90, 0, null) - Math.PI / 2) < 1e-9)
  })
})
