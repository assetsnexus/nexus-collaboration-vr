import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Euler, Object3D, Quaternion } from 'three'
import {
  CharacterGaze,
  clamp,
  clampEyeConeDeg,
  clampGazeLimits,
  COMPANION_EYE_PITCH_MAX,
  COMPANION_EYE_YAW_MAX,
  DEFAULT_GAZE_LIMITS,
  desiredIdleBodyYaw,
  expSmooth,
  eyeLookRangeMap,
  faceFrontLookSpace,
  locoRigYaw,
  parseLookAtTarget,
  pointerLookPoint,
  residualLookOffsets,
  resolveLookAtBoneApplier,
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
    const p = pointerLookPoint(1, 0, cam, head, undefined, { yawMax: (28 * Math.PI) / 180 })
    const yaw = Math.abs(yawTowardXZ(head, p))
    assert.ok(yaw > 0.4 && yaw < 0.55, `expected ~28°, got ${yaw}`)
  })
})

describe('DEFAULT_GAZE_LIMITS', () => {
  it('defaults head 20° and eyes to the anatomical cone (28° / 20°)', () => {
    assert.equal(DEFAULT_GAZE_LIMITS.headYawMaxDeg, 20)
    assert.equal(DEFAULT_GAZE_LIMITS.eyeYawMaxDeg, 28)
    assert.equal(DEFAULT_GAZE_LIMITS.eyePitchMaxDeg, 20)
    const lim = clampGazeLimits({})
    assert.equal(lim.headYawMaxDeg, 20)
    assert.equal(lim.eyeYawMaxDeg, 28)
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

  it('clearPointerOnLeave drops pointer-over even with the external feed on', () => {
    const gaze = new CharacterGaze()
    gaze.setExternalPointerEnabled(true)
    gaze.setPointerNdc(0.5, 0.5)
    assert.equal(gaze.isPointerOver(), true)
    // Unlike clearPointer, this is the signal the cursor left the window while
    // focus is retained — the host widens tracking to the whole screen.
    assert.equal(gaze.clearPointerOnLeave(), true)
    assert.equal(gaze.isPointerOver(), false)
    // Second leave is a no-op (already out), so hosts do not re-notify.
    assert.equal(gaze.clearPointerOnLeave(), false)
  })

  it('re-arms pointer-over on the next external sample after a leave', () => {
    const gaze = new CharacterGaze()
    gaze.setExternalPointerEnabled(true)
    gaze.setPointerNdc(0.5, 0.5)
    gaze.clearPointerOnLeave()
    gaze.setPointerNdc(-0.2, 0.1)
    assert.equal(gaze.isPointerOver(), true)
    assert.equal(gaze.isPointerTracking(), true)
  })

  /**
   * The two-writer regression: the OS-global sampler (external) and the
   * in-webview DOM `pointermove` both pushed aim. Whichever fired last won, so
   * the head tracked "one or the other, never both" depending on event order.
   * Exactly one writer must own the aim — the external feed while it is armed.
   */
  it('rejects an in-webview DOM sample while the external feed is armed', () => {
    const gaze = new CharacterGaze()
    gaze.setExternalPointerEnabled(true)
    gaze.setExternalPointerNdc(0.4, 0.2)
    // A DOM sample arrives (cursor inside the webview): it must be ignored, so
    // the external position wins regardless of event order.
    assert.equal(gaze.setDomPointerNdc(-0.9, -0.9), false)
    assert.equal(gaze.isPointerTracking(), true)
    // The aim still reflects the external sample, not the rejected DOM one.
    gaze.setExternalPointerNdc(0.4, 0.2)
    assert.equal(gaze.isPointerOver(), true)
  })

  it('accepts the DOM sample again once the external feed is disarmed', () => {
    const gaze = new CharacterGaze()
    gaze.setExternalPointerEnabled(true)
    gaze.setExternalPointerNdc(0.4, 0.2)
    assert.equal(gaze.setDomPointerNdc(-0.5, 0.5), false)
    // Host drops the OS-global feed (e.g. no companion): the DOM path resumes.
    gaze.setExternalPointerEnabled(false)
    assert.equal(gaze.setDomPointerNdc(-0.5, 0.5), true)
    assert.equal(gaze.isPointerTracking(), true)
  })

  it('applies a DOM sample when no external feed was ever armed', () => {
    const gaze = new CharacterGaze()
    assert.equal(gaze.setDomPointerNdc(0.25, -0.25), true)
    assert.equal(gaze.isPointerTracking(), true)
  })
})

describe('residualLookOffsets (head vs eye cones)', () => {
  const head = { x: 0, y: 1.4, z: 0 }

  it('yaws toward the target, clamped to the per-surface cone', () => {
    // Target 3 m to the +X side, at head height, character facing +Z (yaw 0).
    const headYawMax = (20 * Math.PI) / 180
    const eyeYawMax = (28 * Math.PI) / 180
    const target = { x: 3, y: 1.4, z: 0 }
    const headOff = residualLookOffsets(head, target, 0, headYawMax, headYawMax)
    const eyeOff = residualLookOffsets(head, target, 0, eyeYawMax, eyeYawMax)
    // Same world target, but the head clamps at its narrow cone and the eyes
    // reach further — this is exactly why the irises lead the head.
    assert.ok(Math.abs(headOff.yaw - headYawMax) < 1e-9, `head ${headOff.yaw}`)
    assert.ok(Math.abs(eyeOff.yaw - eyeYawMax) < 1e-9, `eyes ${eyeOff.yaw}`)
    assert.ok(Math.abs(eyeOff.yaw) > Math.abs(headOff.yaw), 'eyes lead the head')
  })

  it('clamps both yaw and pitch symmetrically', () => {
    const yawMax = (30 * Math.PI) / 180
    const pitchMax = (12 * Math.PI) / 180
    // Target behind-left and straight above → both axes saturate.
    const above = { x: -5, y: 6, z: -5 }
    const off = residualLookOffsets(head, above, 0, yawMax, pitchMax)
    assert.ok(Math.abs(off.yaw) <= yawMax + 1e-9)
    assert.ok(off.pitch <= 1e-9 && off.pitch >= -pitchMax - 1e-9, `pitch ${off.pitch}`)
    assert.ok(Math.abs(off.pitch - -pitchMax) < 1e-9 || Math.abs(off.pitch + pitchMax) < 1e-9)
  })

  it('returns 0 yaw/pitch when the target sits on the facing axis', () => {
    const off = residualLookOffsets(head, { x: 0, y: 1.4, z: 2 }, 0, 1, 1)
    assert.ok(Math.abs(off.yaw) < 1e-9)
    assert.ok(Math.abs(off.pitch) < 1e-9)
  })
})

describe('CharacterGaze per-surface eye cones', () => {  it('keeps a wider eye cone than the head cone (eyes glance past the nose)', () => {
    const gaze = new CharacterGaze()
    const lim = gaze.setLimits({ headYawMaxDeg: 20, headPitchMaxDeg: 22 })
    assert.ok(lim.eyeYawMaxDeg >= lim.headYawMaxDeg + 8, `${lim.eyeYawMaxDeg} vs ${lim.headYawMaxDeg}`)
    assert.ok(lim.eyePitchMaxDeg >= lim.headPitchMaxDeg + 4)
  })

  it('honours an explicit eye yaw of 0 (locked eyes are a valid setting)', () => {
    const gaze = new CharacterGaze()
    const lim = gaze.setLimits({ headYawMaxDeg: 20, eyeYawMaxDeg: 0 })
    assert.equal(lim.eyeYawMaxDeg, 0)
  })

  it('exposes the anatomical companion eye defaults (28° / 20°)', () => {
    assert.ok(Math.abs((COMPANION_EYE_YAW_MAX * 180) / Math.PI - 28) < 1e-6)
    assert.ok(Math.abs((COMPANION_EYE_PITCH_MAX * 180) / Math.PI - 20) < 1e-6)
    assert.equal(DEFAULT_GAZE_LIMITS.eyeYawMaxDeg, 28)
    assert.equal(DEFAULT_GAZE_LIMITS.eyePitchMaxDeg, 20)
  })

  it('drives eye aims toward the target through the wider cone (no lookAt applyer)', () => {
    // A rig without a VRM `lookAt` uses the eye-bone fallback: the eye delta rushes
    // to the SAME residual as the head, but clamped to the wider eye cone.
    const headYawMax = (20 * Math.PI) / 180
    const eyeYawMax = (28 * Math.PI) / 180
    const target = { x: 4, y: 1.4, z: 0.2 }
    const head = residualLookOffsets({ x: 0, y: 1.4, z: 0 }, target, 0, headYawMax, headYawMax)
    const eye = residualLookOffsets({ x: 0, y: 1.4, z: 0 }, target, 0, eyeYawMax, eyeYawMax)
    assert.ok(Math.abs(head.yaw) - headYawMax < 1e-9)
    assert.ok(Math.abs(eye.yaw) > Math.abs(head.yaw))
  })
})

/**
 * The narrow-cone fix: the eyes only lead the head bone slightly and the
 * *applied* iris rotation is capped anatomically, so a far gaze target cannot
 * rotate the eyeball past where the iris leaves the eye opening.
 */
describe('applied eye cone (iris stays inside the eye)', () => {
  it('caps the applied eye cone below the anatomic limit even for a huge registered cone', () => {
    assert.deepEqual(clampEyeConeDeg(70, 30), { yawDeg: 26, pitchDeg: 18 })
    assert.deepEqual(clampEyeConeDeg(28, 20), { yawDeg: 26, pitchDeg: 18 })
    // Never raised above the input either.
    assert.deepEqual(clampEyeConeDeg(10, 8), { yawDeg: 10, pitchDeg: 8 })
  })

  it('caps the live applier range map at the anatomical cone (not the gaze cone)', () => {
    const applier = {
      humanoid: {},
      applyYawPitch: () => undefined,
      rangeMapHorizontalInner: { inputMaxValue: 90, outputScale: 10 },
      rangeMapHorizontalOuter: { inputMaxValue: 90, outputScale: 10 },
      rangeMapVerticalDown: { inputMaxValue: 90, outputScale: 10 },
      rangeMapVerticalUp: { inputMaxValue: 90, outputScale: 10 },
    }
    const gaze = new CharacterGaze()
    const vrm = {
      scene: new Object3D(),
      lookAt: {
        applier,
        faceFront: { x: 0, y: 0, z: 1 },
        getLookAtWorldDirection: (out: { set: (x: number, y: number, z: number) => unknown }) =>
          out.set(0, 0, 1),
      },
      humanoid: { getRawBoneNode: () => null, getNormalizedBoneNode: () => null },
    }
    gaze.bind(vrm as never)
    // Default applied cone is anatomically capped, NOT the 28° gaze cone.
    assert.ok(Math.abs(applier.rangeMapHorizontalInner.outputScale - 26) < 1e-6)
    assert.ok(Math.abs(applier.rangeMapVerticalUp.inputMaxValue - 18) < 1e-6)

    // Even asking for a very wide gaze cone, the applied map stays anatomical.
    gaze.setLimits({ eyeYawMaxDeg: 90, eyePitchMaxDeg: 45 })
    assert.ok(Math.abs(applier.rangeMapHorizontalOuter.outputScale - 26) < 1e-6)
    assert.ok(Math.abs(applier.rangeMapVerticalDown.inputMaxValue - 18) < 1e-6)
  })

  it('reports the applied cap + cap-reached flag in the live debug state', () => {
    const gaze = new CharacterGaze()
    gaze.setLimits({ headYawMaxDeg: 20, eyeYawMaxDeg: 90, eyePitchMaxDeg: 45 })
    const dbg = gaze.getDebugState()
    assert.equal(dbg.appliedEyeMaxDeg.yaw, 26)
    assert.equal(dbg.appliedEyeMaxDeg.pitch, 18)
  })
})

/**
 * The "head tracks but the eyes do not" bug: three-vrm's `VRMLookAtBoneApplier`
 * defaults to `outputScale 10` / `inputMaxValue 90`, so it rotates the eye bones
 * only ~1/9 of the residual gaze. The applier's own math is
 * `outputScale * clamp(input / inputMaxValue)` (degrees out for degrees in), so
 * the maps must be identity-with-a-clamp at the eye cone for the irises to reach
 * the same residual the head left behind.
 */
describe('eyeLookRangeMap / retune', () => {
  it('is an identity map clamped at the eye cone (no squash)', () => {
    const map = eyeLookRangeMap(70)
    assert.ok(map)
    assert.equal(map.inputMaxValue, 70)
    assert.equal(map.outputScale, 70)
    // A 35° residual through the map → 35° of eye rotation, not 3.5° (the default).
    assert.ok(Math.abs(map.outputScale * Math.min(1, 35 / map.inputMaxValue) - 35) < 1e-9)
  })

  it('clamps the eye rotation at the cone for a larger residual', () => {
    const map = eyeLookRangeMap(30)
    assert.ok(map)
    // A 90° residual saturates at the 30° cone.
    assert.ok(Math.abs(map.outputScale * Math.min(1, 90 / map.inputMaxValue) - 30) < 1e-9)
  })

  it('rejects a non-positive cone (locked eyes = no retune)', () => {
    assert.equal(eyeLookRangeMap(0), null)
    assert.equal(eyeLookRangeMap(-5), null)
    assert.equal(eyeLookRangeMap(Number.NaN), null)
  })

  it('detects only a bone applier (never an expression applier)', () => {
    const bone = {
      humanoid: {},
      applyYawPitch: () => undefined,
      rangeMapHorizontalInner: { inputMaxValue: 90, outputScale: 10 },
      rangeMapHorizontalOuter: { inputMaxValue: 90, outputScale: 10 },
    }
    assert.ok(resolveLookAtBoneApplier({ lookAt: { applier: bone } } as never))
    // Expression applier: no `humanoid` marker on the applier.
    const expr = { applyYawPitch: () => undefined, rangeMapHorizontalInner: {} }
    assert.equal(resolveLookAtBoneApplier({ lookAt: { applier: expr } } as never), null)
    assert.equal(resolveLookAtBoneApplier(null), null)
    assert.equal(resolveLookAtBoneApplier({} as never), null)
  })

  it('retunes the live applier maps on bind and limit change', () => {
    const applier = {
      humanoid: {},
      applyYawPitch: () => undefined,
      rangeMapHorizontalInner: { inputMaxValue: 90, outputScale: 10 },
      rangeMapHorizontalOuter: { inputMaxValue: 90, outputScale: 10 },
      rangeMapVerticalDown: { inputMaxValue: 90, outputScale: 10 },
      rangeMapVerticalUp: { inputMaxValue: 90, outputScale: 10 },
    }
    const gaze = new CharacterGaze()
    const vrm = {
      scene: new Object3D(),
      lookAt: {
        applier,
        faceFront: { x: 0, y: 0, z: 1 },
        getLookAtWorldDirection: (out: { set: (x: number, y: number, z: number) => unknown }) =>
          out.set(0, 0, 1),
      },
      humanoid: { getRawBoneNode: () => null, getNormalizedBoneNode: () => null },
    }
    gaze.bind(vrm as never)
    // The default gaze cone (28° / 20°) is clamped to the anatomical cap
    // (26° / 18°) and becomes an identity-with-clamp map.
    assert.ok(Math.abs(applier.rangeMapHorizontalInner.outputScale - 26) < 1e-6)
    assert.ok(Math.abs(applier.rangeMapHorizontalInner.inputMaxValue - 26) < 1e-6)
    assert.ok(Math.abs(applier.rangeMapVerticalUp.outputScale - 18) < 1e-6)

    // A live limit change re-tunes the maps in place — but never past the
    // anatomical cap, even when a caller asks for a wide gaze cone.
    gaze.setLimits({ eyeYawMaxDeg: 48, eyePitchMaxDeg: 30 })
    assert.ok(Math.abs(applier.rangeMapHorizontalOuter.outputScale - 26) < 1e-6)
    assert.ok(Math.abs(applier.rangeMapVerticalDown.inputMaxValue - 18) < 1e-6)
  })
})


