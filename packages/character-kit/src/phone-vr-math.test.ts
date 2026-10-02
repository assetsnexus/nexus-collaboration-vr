import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  applyYawRecenter,
  barrelScale,
  distortSampleUv,
  eyeOffsetLocalX,
  eyeWorldPosition,
  isOrientationStalled,
  orientationEulerRad,
  recenterYaw,
  undistortRadius,
} from './phone-vr-math.ts'
import {
  clampIpdM,
  defaultPhoneVrSettings,
  findViewerProfile,
  IPD_MAX_M,
  IPD_MIN_M,
  normalizePhoneVrSettings,
  resolveActiveViewer,
  VIEWER_PROFILES,
} from './viewer-profiles.ts'
import {
  canStartImmersiveVr,
  immersiveVrSessionInit,
  phoneVrErrorMessage,
  vrSupportMessage,
} from './webxr-session.ts'

describe('viewer profiles', () => {
  it('ships documented cardboard + common lens presets', () => {
    assert.ok(VIEWER_PROFILES.length >= 3)
    assert.equal(findViewerProfile('cardboard-v2').ipdM, 0.064)
    assert.equal(findViewerProfile('missing').id, VIEWER_PROFILES[0]!.id)
  })

  it('clamps IPD to ~50–75 mm', () => {
    assert.equal(clampIpdM(0.01), IPD_MIN_M)
    assert.equal(clampIpdM(0.2), IPD_MAX_M)
    assert.equal(clampIpdM(0.064), 0.064)
  })
})

describe('phone-vr-math eye offset', () => {
  it('offsets left/right by half IPD on local X', () => {
    assert.equal(eyeOffsetLocalX(0.064, 'left'), -0.032)
    assert.equal(eyeOffsetLocalX(0.064, 'right'), 0.032)
  })

  it('places eyes along the camera right axis', () => {
    const L = eyeWorldPosition({ x: 0, y: 1.6, z: 0 }, { x: 1, y: 0, z: 0 }, 0.064, 'left')
    const R = eyeWorldPosition({ x: 0, y: 1.6, z: 0 }, { x: 1, y: 0, z: 0 }, 0.064, 'right')
    assert.ok(Math.abs(L.x + 0.032) < 1e-9)
    assert.ok(Math.abs(R.x - 0.032) < 1e-9)
    assert.equal(L.y, 1.6)
  })
})

describe('phone-vr-math distortion', () => {
  const d = { k1: 0.34, k2: 0.55 }

  it('barrelScale grows with radius for positive k', () => {
    assert.ok(barrelScale(0.5, d) > 1)
    assert.ok(barrelScale(0, d) === 1)
  })

  it('undistortRadius inverts barrel approximately', () => {
    const r = 0.4
    const distorted = r * barrelScale(r, d)
    const back = undistortRadius(distorted, d)
    assert.ok(Math.abs(back - r) < 0.02)
  })

  it('distortSampleUv keeps the origin fixed', () => {
    const p = distortSampleUv(0, 0, d)
    assert.equal(p.u, 0)
    assert.equal(p.v, 0)
  })
})

describe('phone-vr-math recenter', () => {
  it('zeros display yaw at the capture orientation', () => {
    const state = recenterYaw(1.2)
    assert.ok(Math.abs(applyYawRecenter(1.2, state)) < 1e-9)
    assert.ok(Math.abs(applyYawRecenter(1.5, state) - 0.3) < 1e-9)
  })
})

describe('phone-vr-math orientation + stall', () => {
  it('returns null when beta/gamma missing', () => {
    assert.equal(orientationEulerRad({ alpha: 0, beta: null, gamma: 0 }), null)
  })

  it('returns finite euler when orientation is present', () => {
    const e = orientationEulerRad({ alpha: 10, beta: 45, gamma: 0, screenAngleDeg: 90 })
    assert.ok(e)
    assert.ok(Number.isFinite(e!.yaw))
    assert.ok(Number.isFinite(e!.pitch))
  })

  it('flags stalled sensors after timeout', () => {
    assert.equal(
      isOrientationStalled({ lastChangeAtMs: 0, nowMs: 3000, stallMs: 2500 }),
      true,
    )
    assert.equal(
      isOrientationStalled({ lastChangeAtMs: 2000, nowMs: 3000, stallMs: 2500 }),
      false,
    )
  })
})

describe('phone-vr-settings', () => {
  it('normalizes unknown profile to generic cardboard', () => {
    const s = normalizePhoneVrSettings({ v: 1, profileId: 'nope', ipdM: 0.09, distortionScale: 9 })
    assert.equal(s.profileId, VIEWER_PROFILES[0]!.id)
    assert.equal(s.ipdM, IPD_MAX_M)
    assert.equal(s.distortionScale, 1.5)
  })

  it('resolveActiveViewer scales distortion coeffs', () => {
    const base = defaultPhoneVrSettings()
    const viewer = resolveActiveViewer({ ...base, profileId: 'cardboard-v2', distortionScale: 0.5 })
    assert.ok(Math.abs(viewer.distortion.k1 - 0.34 * 0.5) < 1e-9)
  })
})

describe('webxr-session rails (portal-aligned)', () => {
  it('canStartImmersiveVr is false without navigator.xr', async () => {
    assert.equal(await canStartImmersiveVr({}), false)
    assert.equal(await canStartImmersiveVr(null), false)
  })

  it('canStartImmersiveVr checks immersive-vr only', async () => {
    const nav = {
      xr: {
        isSessionSupported: async (mode: string) => mode === 'immersive-vr',
      },
    }
    assert.equal(await canStartImmersiveVr(nav), true)
  })

  it('immersiveVrSessionInit matches portal standing/seated', () => {
    assert.deepEqual(immersiveVrSessionInit('local-floor'), {
      referenceSpace: 'local-floor',
      optionalFeatures: ['local-floor'],
    })
    assert.deepEqual(immersiveVrSessionInit('local'), {
      referenceSpace: 'local',
      optionalFeatures: [],
    })
  })

  it('surfaces real error / support copy', () => {
    assert.match(vrSupportMessage('insecure'), /HTTPS/)
    assert.match(vrSupportMessage('imu_fallback'), /gyroscope|IMU/i)
    assert.match(phoneVrErrorMessage('motion_permission_denied'), /iOS|permission/i)
    assert.match(phoneVrErrorMessage('stereo_failed'), /flat/)
  })
})
