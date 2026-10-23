import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Euler, Object3D, Quaternion } from 'three'
import {
  CharacterGaze,
  clamp,
  clampGazeLimits,
  DEFAULT_GAZE_LIMITS,
  desiredIdleBodyYaw,
  expSmooth,
  faceFrontLookSpace,
  locoRigYaw,
  parseLookAtTarget,
  pointerLookPoint,
  spineLookDeltaQuat,
  wrapPi,
  yawTowardXZ,
} from './gaze.ts'

describe('parseLookAtTarget', () => {
  it('accepts camera aliases and clear', () => {
    assert.equal(parseLookAtTarget('camera'), 'camera')
    assert.equal(parseLookAtTarget('user'), 'camera')
    assert.equal(parseLookAtTarget('clear'), null)
    assert.equal(parseLookAtTarget('none'), null)
    assert.equal(parseLookAtTarget(null), null)
  })

  it('parses xyz objects and compact strings', () => {
    assert.deepEqual(parseLookAtTarget({ x: 1.2, y: 1.4, z: -0.5 }), {
      x: 1.2,
      y: 1.4,
      z: -0.5,
    })
    assert.deepEqual(parseLookAtTarget('1.2,1.4,-0.5'), { x: 1.2, y: 1.4, z: -0.5 })
    assert.deepEqual(parseLookAtTarget('1.2 1.4 -0.5'), { x: 1.2, y: 1.4, z: -0.5 })
    assert.deepEqual(parseLookAtTarget('x=1 y=1.4 z=-2'), { x: 1, y: 1.4, z: -2 })
    assert.deepEqual(parseLookAtTarget('1,-2'), { x: 1, y: 1.4, z: -2 })
  })

  it('rejects junk', () => {
    assert.equal(parseLookAtTarget(''), undefined)
    assert.equal(parseLookAtTarget('wave'), undefined)
    assert.equal(parseLookAtTarget({ foo: 1 }), undefined)
  })
})

describe('pointerLookPoint', () => {
  const cam = { x: 0, y: 1.4, z: 2.2 }
  const head = { x: 0, y: 1.4, z: 0 }

  it('center looks toward the camera (+Z)', () => {
    const p = pointerLookPoint(0, 0, cam, head)
    assert.ok(p.z > head.z, `expected +Z look, got ${JSON.stringify(p)}`)
    assert.ok(Math.abs(p.x) < 0.2, `expected on-axis, got x=${p.x}`)
  })

  it('mid-right looks toward +X', () => {
    const p = pointerLookPoint(0.55, 0, cam, head)
    assert.ok(p.x > 0.2, `expected +X, got ${JSON.stringify(p)}`)
  })

  it('right edge stays in front of the character (face visible)', () => {
    const p = pointerLookPoint(1, 0, cam, head)
    assert.ok(p.z > head.z, `expected still toward camera, got ${JSON.stringify(p)}`)
    const yaw = Math.abs(yawTowardXZ(head, p))
    // Default cone is ~20° (~0.35 rad); eyes may use a wider opts.yawMax.
    assert.ok(yaw > 0.25 && yaw < 0.45, `expected ~20°, got ${yaw}`)
  })

  it('left edge yaws the other way, still in front', () => {
    const p = pointerLookPoint(-1, 0, cam, head)
    assert.ok(p.z > head.z)
    assert.ok(yawTowardXZ(head, p) < -0.25)
  })

  it('accepts a wider eye cone', () => {
    const p = pointerLookPoint(1, 0, cam, head, undefined, { yawMax: (70 * Math.PI) / 180 })
    const yaw = Math.abs(yawTowardXZ(head, p))
    assert.ok(yaw > 1.1 && yaw < 1.32, `expected ~70°, got ${yaw}`)
  })
})

describe('DEFAULT_GAZE_LIMITS', () => {
  it('defaults head 20° and eyes 70°', () => {
    assert.equal(DEFAULT_GAZE_LIMITS.headYawMaxDeg, 20)
    assert.equal(DEFAULT_GAZE_LIMITS.eyeYawMaxDeg, 70)
    const lim = clampGazeLimits({})
    assert.equal(lim.headYawMaxDeg, 20)
    assert.equal(lim.eyeYawMaxDeg, 70)
  })

  it('allows eye yaw 0–90', () => {
    assert.equal(clampGazeLimits({ eyeYawMaxDeg: -1 }).eyeYawMaxDeg, 0)
    assert.equal(clampGazeLimits({ eyeYawMaxDeg: 0 }).eyeYawMaxDeg, 0)
    assert.equal(clampGazeLimits({ eyeYawMaxDeg: 90 }).eyeYawMaxDeg, 90)
    assert.equal(clampGazeLimits({ eyeYawMaxDeg: 91 }).eyeYawMaxDeg, 90)
  })

  it('keeps an explicit eye yaw of 0 or 90', () => {
    const gaze = new CharacterGaze()
    assert.equal(gaze.setLimits({ eyeYawMaxDeg: 0 }).eyeYawMaxDeg, 0)
    assert.equal(gaze.setLimits({ eyeYawMaxDeg: 90 }).eyeYawMaxDeg, 90)
  })
})

describe('wrapPi', () => {
  it('wraps to (−π, π]', () => {
    assert.ok(Math.abs(wrapPi(0)) < 1e-9)
    assert.ok(Math.abs(wrapPi(Math.PI * 3) - Math.PI) < 1e-9 || Math.abs(wrapPi(Math.PI * 3) + Math.PI) < 1e-9)
    assert.ok(Math.abs(wrapPi(-3 * Math.PI) + Math.PI) < 1e-6 || Math.abs(wrapPi(-3 * Math.PI) - Math.PI) < 1e-6)
    assert.ok(Math.abs(wrapPi(0.5) - 0.5) < 1e-9)
  })
})

describe('yawTowardXZ', () => {
  it('is ~0 when the target is along +Z', () => {
    const y = yawTowardXZ({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 2 })
    assert.ok(Math.abs(y) < 1e-6)
  })

  it('is positive toward +X', () => {
    const y = yawTowardXZ({ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0.01 })
    assert.ok(y > 1)
  })
})

describe('desiredIdleBodyYaw', () => {
  const rest = Math.PI
  const cameraFacing = 0.4

  it('holds locomotion heading while walking', () => {
    const y = desiredIdleBodyYaw({
      locomoting: true,
      followViewer: true,
      locoYaw: 0.8,
      restForwardYaw: rest,
      cameraFacingYaw: cameraFacing,
      bodyFromCamera: 0.2,
    })
    assert.equal(y, locoRigYaw(0.8, rest))
  })

  it('does not auto-face the camera when body-follow is off', () => {
    const y = desiredIdleBodyYaw({
      locomoting: false,
      followViewer: false,
      locoYaw: 0.8,
      restForwardYaw: rest,
      cameraFacingYaw: cameraFacing,
      bodyFromCamera: 0.2,
    })
    assert.equal(y, locoRigYaw(0.8, rest))
  })

  it('faces the camera when body-follow (or speech/look-at) is on', () => {
    const y = desiredIdleBodyYaw({
      locomoting: false,
      followViewer: true,
      locoYaw: 0,
      restForwardYaw: rest,
      cameraFacingYaw: cameraFacing,
      bodyFromCamera: 0.1,
    })
    assert.ok(Math.abs(y - wrapPi(cameraFacing + 0.1)) < 1e-9)
  })
})

describe('expSmooth', () => {
  it('moves toward the target and clamps dt', () => {
    const a = expSmooth(0, 10, 8, 0.05)
    const b = expSmooth(0, 10, 8, 0.2)
    assert.ok(a > 0 && a < b)
    assert.equal(expSmooth(3, 3, 8, 0.1), 3)
    assert.equal(clamp(5, 0, 1), 1)
  })
})

describe('faceFrontLookSpace / spineLookDeltaQuat', () => {
  it('is identity for VRM1 (+Z faceFront)', () => {
    const q = faceFrontLookSpace({ x: 0, y: 0, z: 1 })
    assert.ok(Math.abs(q.x) < 1e-9 && Math.abs(q.y) < 1e-9 && Math.abs(q.z) < 1e-9)
    assert.ok(Math.abs(q.w - 1) < 1e-9)
  })

  it('is ~180° Y for VRM0 (−Z faceFront)', () => {
    const q = faceFrontLookSpace({ x: 0, y: 0, z: -1 })
    const e = new Euler().setFromQuaternion(q, 'YXZ')
    assert.ok(Math.abs(Math.abs(e.y) - Math.PI) < 1e-5, `yaw=${e.y}`)
    assert.ok(Math.abs(e.x) < 1e-5 && Math.abs(e.z) < 1e-5)
  })

  it('conjugates pitch sign for VRM0 without flipping yaw', () => {
    const ff = faceFrontLookSpace({ x: 0, y: 0, z: -1 })
    const pitch = 0.3
    const yaw = 0.2
    const v1 = spineLookDeltaQuat(yaw, pitch, new Quaternion())
    const v0 = spineLookDeltaQuat(yaw, pitch, ff)
    const e1 = new Euler().setFromQuaternion(v1, 'YXZ')
    const e0 = new Euler().setFromQuaternion(v0, 'YXZ')
    assert.ok(Math.abs(e1.x - pitch) < 1e-5)
    assert.ok(Math.abs(e0.x + pitch) < 1e-5, `VRM0 pitch should flip, got ${e0.x}`)
    assert.ok(Math.abs(e0.y - yaw) < 1e-5, `yaw should stay, got ${e0.y}`)
  })
})

describe('CharacterGaze.bind', () => {
  it('samples rest forward with the parent rig yaw zeroed', () => {
    const rig = new Object3D()
    const scene = new Object3D()
    rig.add(scene)
    scene.rotation.y = Math.PI
    rig.rotation.y = 0.62
    rig.updateMatrixWorld(true)

    const gaze = new CharacterGaze()
    gaze.bind({ scene } as never)

    const rest = (gaze as unknown as { restForwardYaw: number }).restForwardYaw
    assert.ok(
      Math.abs(Math.abs(rest) - Math.PI) < 1e-4,
      `rest ${rest} should ignore parent yaw 0.62`,
    )
    gaze.setLocomotionYaw(0)
    const body = gaze.snapBodyToLocomotion()
    assert.ok(Math.abs(Math.abs(body) - Math.PI) < 1e-4, `body ${body}`)
  })
})

describe('CharacterGaze external pointer', () => {
  it('keeps tracking after clearPointer while an external feed is enabled', () => {
    const gaze = new CharacterGaze()
    gaze.setExternalPointerEnabled(true)
    gaze.setPointerNdc(0.5, 0.5)
    assert.equal(gaze.isPointerTracking(), true)

    // DOM `mouseleave` / window blur fire `clearPointer`; with an OS-global feed
    // that must not stop the aim, so tracking stays on.
    gaze.clearPointer()
    assert.equal(gaze.isPointerTracking(), true)
  })

  it('clears the pointer once the external feed is disabled', () => {
    const gaze = new CharacterGaze()
    gaze.setExternalPointerEnabled(true)
    gaze.setPointerNdc(0.5, 0.5)
    gaze.setExternalPointerEnabled(false)
    gaze.clearPointer()
    assert.equal(gaze.isPointerTracking(), false)
  })

  it('has no effect on clearPointer when the external feed was never enabled', () => {
    const gaze = new CharacterGaze()
    gaze.setPointerNdc(0.5, 0.5)
    gaze.clearPointer()
    assert.equal(gaze.isPointerTracking(), false)
  })
})

