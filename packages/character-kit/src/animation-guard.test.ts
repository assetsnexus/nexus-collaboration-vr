import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  checkRigCompatibility,
  clipBoneTargets,
  createPoseGuard,
  detectStuckPose,
  GUARD_RECOVER_COOLDOWN_MS,
  GUARD_SAMPLE_INTERVAL_MS,
  GUARD_STUCK_SAMPLES,
  rigBoneNames,
  type GuardActionSnapshot,
} from './animation-guard.ts'

function action(partial: Partial<GuardActionSnapshot> & { key: string }): GuardActionSnapshot {
  return {
    clipName: partial.key.split('#')[0]!,
    loop: false,
    clampWhenFinished: false,
    running: true,
    effectiveWeight: 1,
    time: 0,
    durationSec: 1,
    tracked: true,
    stance: false,
    ...partial,
  }
}

describe('detectStuckPose', () => {
  it('is clean for a single running idle loop', () => {
    const verdict = detectStuckPose([
      action({ key: 'idle', loop: true, time: 1.2, durationSec: 4, stance: true, idle: true }),
    ])
    assert.equal(verdict.stuck, false)
    assert.equal(verdict.detail, 'ok')
  })

  it('is clean while a clip legitimately fades out (weight under threshold)', () => {
    const verdict = detectStuckPose([
      action({ key: 'idle', loop: true, durationSec: 4, stance: true, idle: true }),
      action({ key: 'sit', loop: true, durationSec: 3, stance: true, effectiveWeight: 0.012 }),
    ])
    assert.equal(verdict.stuck, false)
  })

  it('is clean mid-crossfade even though both stance clips hold weight', () => {
    // idle (1.0) + an incoming stance clip (0.4) is a normal transition.
    const verdict = detectStuckPose([
      action({ key: 'idle', loop: true, durationSec: 4, stance: true, idle: true }),
      action({ key: 'sit', loop: true, durationSec: 3, stance: true, effectiveWeight: 0.42 }),
    ])
    assert.equal(verdict.stuck, false)
  })

  it('is clean for idle plus a legitimately stacked overlay', () => {
    const verdict = detectStuckPose([
      action({ key: 'idle', loop: true, durationSec: 4, stance: true, idle: true }),
      action({ key: 'nod', loop: false, durationSec: 0.55, stance: false }),
    ])
    assert.equal(verdict.stuck, false)
  })

  it('flags an orphan action nobody will ever stop', () => {
    const verdict = detectStuckPose([
      action({ key: 'idle#12', loop: true, durationSec: 4, stance: true, idle: true }),
      action({ key: 'sit#17', loop: true, durationSec: 3, stance: true, tracked: false }),
    ])
    assert.equal(verdict.stuck, true)
    assert.ok(verdict.reasons.includes('orphan_action'))
    assert.deepEqual(verdict.orphans, ['sit#17'])
  })

  it('reports an orphan once even when it also overran its clip', () => {
    const verdict = detectStuckPose([
      action({
        key: 'wave#8',
        clampWhenFinished: true,
        time: 5,
        durationSec: 1,
        stance: true,
        tracked: false,
      }),
    ])
    assert.ok(verdict.reasons.includes('orphan_action'))
    assert.ok(verdict.reasons.includes('overrun_oneshot'))
    assert.deepEqual(verdict.orphans, ['wave#8'])
  })

  it('flags mutually-exclusive stance clips blending past 100%', () => {
    // This is the exact production symptom: sitting and standing at once.
    const verdict = detectStuckPose([
      action({ key: 'idle', loop: true, durationSec: 4, stance: true, idle: true }),
      action({ key: 'sit', loop: true, durationSec: 3, stance: true }),
    ])
    assert.equal(verdict.stuck, true)
    assert.ok(verdict.reasons.includes('weight_sum'))
  })

  it('flags a clamped one-shot that outlived its clip', () => {
    const verdict = detectStuckPose([
      action({ key: 'idle', loop: true, durationSec: 4, stance: true, idle: true }),
      action({
        key: 'wave',
        clampWhenFinished: true,
        time: 0.9 + 2,
        durationSec: 0.9,
        stance: true,
        tracked: false,
      }),
    ])
    assert.equal(verdict.stuck, true)
    assert.ok(verdict.reasons.includes('overrun_oneshot'))
    assert.ok(verdict.reasons.includes('orphan_action'))
  })

  it('does not flag a clamped one-shot still inside its clip + grace', () => {
    const verdict = detectStuckPose([
      action({ key: 'idle', loop: true, durationSec: 4, stance: true, idle: true }),
      // A wave is an arm overlay: it stacks on idle without touching stance.
      action({ key: 'wave', clampWhenFinished: true, time: 0.9, durationSec: 0.9, stance: false }),
    ])
    assert.equal(verdict.stuck, false)
  })

  it('ignores stopped actions even at nonzero weight', () => {
    const verdict = detectStuckPose([
      action({ key: 'idle', loop: true, durationSec: 4, stance: true, idle: true }),
      action({ key: 'sit', loop: true, stance: true, running: false, tracked: false }),
    ])
    assert.equal(verdict.stuck, false)
  })
})

describe('clipBoneTargets', () => {
  it('normalizes VRMA and procedural track names to the same bone', () => {
    const targets = clipBoneTargets({
      tracks: [
        { name: 'Normalized_Head.quaternion' },
        { name: 'Armature/Normalized_RightUpperArm.rotation' },
        { name: 'hips.position' },
        { name: 'head.quaternion' },
      ],
    })
    assert.deepEqual(targets.sort(), ['head', 'rightupperarm'])
  })
})

describe('checkRigCompatibility', () => {
  const clip = {
    tracks: [
      { name: 'Normalized_Head.quaternion' },
      { name: 'Normalized_Neck.quaternion' },
      { name: 'Normalized_LeftHand.quaternion' },
      { name: 'Normalized_RightHand.quaternion' },
      { name: 'Normalized_Hips.quaternion' },
    ],
  }

  it('accepts a clip when the rig has most of its bones', () => {
    const verdict = checkRigCompatibility(clip, ['head', 'neck', 'lefthand', 'hips'])
    assert.equal(verdict.compatible, true)
    assert.equal(verdict.missing.length, 1)
    assert.ok(verdict.coverage >= 0.6)
  })

  it('refuses a clip the rig is missing most of (fallback sample VRM)', () => {
    const verdict = checkRigCompatibility(clip, ['head', 'hips'])
    assert.equal(verdict.compatible, false)
    assert.match(verdict.reason, /missing 3\/5/)
    assert.deepEqual(verdict.missing.sort(), ['lefthand', 'neck', 'righthand'])
  })

  it('treats an unknown rig as compatible so a loading VRM is never blocked', () => {
    const verdict = checkRigCompatibility(clip, [])
    assert.equal(verdict.compatible, true)
    assert.equal(verdict.reason, 'unknown-rig')
  })

  it('treats a tiny fragment as compatible', () => {
    const verdict = checkRigCompatibility(
      { tracks: [{ name: 'head.quaternion' }] },
      ['leg'],
    )
    assert.equal(verdict.compatible, true)
    assert.equal(verdict.reason, 'fragment')
  })
})

describe('rigBoneNames', () => {
  it('lists only the bones the rig reports', () => {
    const rig = new Set(['head', 'hips'])
    assert.deepEqual(rigBoneNames((b) => rig.has(b), ['head', 'hips', 'leftFoot']), [
      'head',
      'hips',
    ])
  })
})

describe('createPoseGuard', () => {
  const stuck = { stuck: true, reasons: ['orphan_action' as const], orphans: ['sit'], detail: 'x' }
  const ok = { stuck: false, reasons: [], orphans: [], detail: 'ok' }

  it('samples at most once per interval', () => {
    const guard = createPoseGuard()
    assert.equal(guard.due(0), true)
    // `due` consumes the slot, so a second call in the same window is false.
    assert.equal(guard.due(GUARD_SAMPLE_INTERVAL_MS / 2), false)
    assert.equal(guard.due(GUARD_SAMPLE_INTERVAL_MS), true)
    assert.equal(guard.due(GUARD_SAMPLE_INTERVAL_MS + 1), false)
  })

  it('recovers only after the stuck verdict persists for several samples', () => {
    const guard = createPoseGuard()
    let recovered = 0
    let t = 0
    for (let i = 0; i < GUARD_STUCK_SAMPLES; i++) {
      t += GUARD_SAMPLE_INTERVAL_MS
      if (guard.observe(t, stuck)) recovered++
    }
    assert.equal(recovered, 1)
    assert.equal(guard.observe(t + GUARD_SAMPLE_INTERVAL_MS, stuck), false)
    assert.equal(guard.observe(t + GUARD_SAMPLE_INTERVAL_MS * 2, stuck), false)
  })

  it('resets the streak on a healthy sample', () => {
    const guard = createPoseGuard()
    let t = 0
    // Two of the three samples needed, then a healthy frame clears the streak.
    for (let i = 0; i < GUARD_STUCK_SAMPLES - 1; i++) {
      t += GUARD_SAMPLE_INTERVAL_MS
      assert.equal(guard.observe(t, stuck), false)
    }
    t += GUARD_SAMPLE_INTERVAL_MS
    assert.equal(guard.observe(t, ok), false)
    // The streak must start over, so the next verdict alone cannot recover.
    t += GUARD_SAMPLE_INTERVAL_MS
    assert.equal(guard.observe(t, stuck), false)
  })

  it('respects the recovery cooldown so recovery cannot thrash', () => {
    // A long cooldown makes the throttle explicit rather than timing-dependent.
    const guard = createPoseGuard({ cooldownMs: 60_000 })
    let t = 0
    let recovered = 0
    const sample = (verdict = stuck) => {
      t += GUARD_SAMPLE_INTERVAL_MS
      if (guard.observe(t, verdict)) recovered++
    }
    for (let i = 0; i < GUARD_STUCK_SAMPLES; i++) sample()
    assert.equal(recovered, 1)
    // Still stuck: further episodes are blocked by the cooldown, however many.
    for (let i = 0; i < GUARD_STUCK_SAMPLES * 5; i++) sample()
    assert.equal(recovered, 1)
  })
})
