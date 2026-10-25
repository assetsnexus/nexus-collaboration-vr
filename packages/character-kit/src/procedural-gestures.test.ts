import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import * as THREE from 'three'
import {
  ARM_HANG_L,
  ARM_HANG_R,
  applyRelaxedRestPose,
  armFrameZSign,
  assignClipUserData,
  buildProceduralGestureClips,
  isVrm0,
  scratchNoseGestureBones,
} from './procedural-gestures.ts'
import { PRESENCE_MOODS } from './presence-moods.ts'

const ALL_BONES = [
  'hips',
  'spine',
  'chest',
  'upperChest',
  'neck',
  'head',
  'leftShoulder',
  'leftUpperArm',
  'leftLowerArm',
  'leftHand',
  'rightShoulder',
  'rightUpperArm',
  'rightLowerArm',
  'rightHand',
  'leftUpperLeg',
  'leftLowerLeg',
  'leftFoot',
  'rightUpperLeg',
  'rightLowerLeg',
  'rightFoot',
]

/**
 * Minimal stand-in for a VRM humanoid rig: a real THREE object graph so
 * `getWorldPosition` / `updateWorldMatrix` work, plus the humanoid hooks the
 * procedural builder calls. `bones` selects which normalized bones exist, which
 * lets a fixture model a stripped / partial rig.
 */
function mockVrm(bones: string[] = ALL_BONES, metaVersion?: string) {
  const root = new THREE.Object3D()
  root.name = 'root'
  const nodes = new Map<string, THREE.Object3D>()
  for (const bone of bones) {
    const node = new THREE.Object3D()
    node.name = bone
    // Spread them out on X so world positions differ (IK distance is non-zero).
    node.position.set(bones.indexOf(bone) * 0.05, bone === 'head' ? 1.5 : 1.0, 0)
    root.add(node)
    nodes.set(bone, node)
  }
  root.updateMatrixWorld(true)
  return {
    scene: root,
    meta: metaVersion === undefined ? undefined : { metaVersion },
    humanoid: {
      getNormalizedBoneNode(name: string) {
        return nodes.get(name) ?? null
      },
      resetNormalizedPose() {
        for (const node of nodes.values()) node.quaternion.identity()
      },
      update() {
        root.updateMatrixWorld(true)
      },
    },
    expressionManager: {
      setValue() {},
    },
  }
}

describe('assignClipUserData', () => {
  it('creates the bag when three left clip.userData undefined (0.170)', () => {
    // three 0.170's AnimationClip constructor never initializes `userData`,
    // which is what made `clip.userData.ikDist = …` throw in the app.
    const clip: { userData?: Record<string, unknown> } = {}
    assignClipUserData(clip, { ikDist: 1.25, ikDz: -0.3 })
    assert.deepEqual(clip.userData, { ikDist: 1.25, ikDz: -0.3 })
  })

  it('preserves existing userData keys (0.180 clips)', () => {
    const clip: { userData?: Record<string, unknown> } = { userData: { keep: 'me' } }
    assignClipUserData(clip, { ikDist: 0.5 })
    assert.deepEqual(clip.userData, { keep: 'me', ikDist: 0.5 })
  })
})

describe('buildProceduralGestureClips rig tolerance', () => {
  it('builds the scratch_nose clip (with ik userData) for a rig WITH IK reach targets', () => {
    const clips = buildProceduralGestureClips(mockVrm() as never)
    const scratch = clips.find((c) => c.id === 'scratch_nose')
    assert.ok(scratch, 'scratch_nose clip is present')
    // The clip carries the IK diagnostics instead of throwing.
    assert.equal(typeof scratch!.clip.userData.ikDist, 'number')
    assert.equal(typeof scratch!.clip.userData.ikDz, 'number')
    assert.equal(scratch!.clip.name, 'scratch_nose')
    // Every procedural id still builds.
    for (const id of ['idle', 'nod', 'agree', 'walk', 'crouch_idle']) {
      assert.ok(clips.some((c) => c.id === id), `missing ${id}`)
    }
  })

  it('does not throw for a VRM-1.0 rig lacking the hand/head reach targets', () => {
    // Strip the right hand + head normalized bones (the reach pose's IK targets).
    const withoutTargets = ALL_BONES.filter((b) => b !== 'rightHand' && b !== 'head')
    let clips: ReturnType<typeof buildProceduralGestureClips> | null = null
    assert.doesNotThrow(() => {
      clips = buildProceduralGestureClips(mockVrm(withoutTargets) as never)
    })
    assert.ok(clips, 'builder returned clips')
    // scratch_nose is skipped rather than crashing the whole fallback set.
    assert.equal(clips!.some((c) => c.id === 'scratch_nose'), false)
    // Head-only overlays still build (they only need neck/head-adjacent bones).
    assert.ok(clips!.some((c) => c.id === 'idle'))
  })

  it('still keys only the right arm for scratch_nose (no VRM-0 regression)', () => {
    const bones = scratchNoseGestureBones()
    assert.ok(bones.includes('rightUpperArm'))
    assert.ok(!bones.some((b) => b.startsWith('left')))
  })
})

describe('arm hang sign convention (stuck-arms regression)', () => {
  // On a three-vrm normalized T-pose the left arm lowers with negative Z and the
  // right arm lowers with positive Z; raises use the opposite signs. Authoring a
  // hang pose with the raise signs left both arms stuck overhead (hands above
  // the head) in the shipped companion — this locks the correct convention.
  it('lowers the LEFT arm with negative Z and the RIGHT arm with positive Z', () => {
    assert.equal(ARM_HANG_L, -1)
    assert.equal(ARM_HANG_R, 1)
  })

  it('keys the standing idle with a downward (hang) left upper-arm Z', () => {
    const idle = buildProceduralGestureClips(mockVrm() as never).find((c) => c.id === 'idle')!
    const track = idle.clip.tracks.find(
      (t) => t.name.replace(/\.[^.]+$/, '').toLowerCase() === 'leftupperarm',
    ) as THREE.QuaternionKeyframeTrack
    assert.ok(track, 'idle keys the left upper arm')
    // +Z would raise the arm; the hang pose must rotate the other way.
    const first = new THREE.Quaternion(
      track.values[0]!,
      track.values[1]!,
      track.values[2]!,
      track.values[3]!,
    )
    const identity = new THREE.Quaternion()
    // hlpr: an intrinsic Z rotation of +68° would put w·z > 0; a negative-Z hang
    // puts them opposite in sign.
    assert.ok(first.z * first.w < 0, 'idle left upper arm must hang (negative Z)')
    assert.ok(identity.angleTo(first) > 0.1, 'idle actually rotates the arm')
  })
})

describe('VRM 0.x arm-frame mirroring (arms-point-up regression)', () => {
  // VRM 0.x authors the humanoid facing −Y; `VRMUtils.rotateVRM0` counter-rotates
  // the scene, which MIRRORS the arm-chain bones' local frame. The A-pose hang
  // offsets are authored for the VRM 1.0 frame, so a VRM 0.x model needs their Z
  // sign flipped or the arms swing UP (the reported `jibril.vrm` bug). Proved
  // live over CDP: a VRM1 model's arm landed 26° from down while every VRM0 model
  // landed ~154° (up) with the un-flipped sign.
  it('detects VRM 0.x from meta.metaVersion (never per-model)', () => {
    assert.equal(isVrm0(mockVrm(ALL_BONES, '0') as never), true)
    assert.equal(isVrm0(mockVrm(ALL_BONES, '1') as never), false)
    assert.equal(isVrm0(mockVrm(ALL_BONES, undefined) as never), false)
  })

  it('Z-flips only the arm-chain bones, and only for VRM 0.x', () => {
    const vrm0 = mockVrm(ALL_BONES, '0') as never
    const vrm1 = mockVrm(ALL_BONES, '1') as never
    for (const bone of ['leftUpperArm', 'rightUpperArm', 'leftShoulder', 'rightLowerArm']) {
      assert.equal(armFrameZSign(vrm0, bone), -1, `${bone} flips on VRM0`)
      assert.equal(armFrameZSign(vrm1, bone), 1, `${bone} stays on VRM1`)
    }
    // Torso/head are never flipped — that would break a correct upper body.
    for (const bone of ['hips', 'spine', 'chest', 'neck', 'head']) {
      assert.equal(armFrameZSign(vrm0, bone), 1, `${bone} must not flip`)
    }
  })

  it('builds a VRM0 idle whose left upper arm hangs with the flipped Z sign', () => {
    const readLeftUpperArm = (vrm: unknown) => {
      const idle = buildProceduralGestureClips(vrm as never).find((c) => c.id === 'idle')!
      const track = idle.clip.tracks.find(
        (t) => t.name.replace(/\.[^.]+$/, '').toLowerCase() === 'leftupperarm',
      ) as THREE.QuaternionKeyframeTrack
      return new THREE.Quaternion(
        track.values[0]!,
        track.values[1]!,
        track.values[2]!,
        track.values[3]!,
      )
    }
    const vrm0 = readLeftUpperArm(mockVrm(ALL_BONES, '0'))
    const vrm1 = readLeftUpperArm(mockVrm(ALL_BONES, '1'))
    // The two conventions must land on OPPOSITE Z signs so both lower the arm.
    assert.ok(vrm0.z * vrm1.z < 0, 'VRM0 idle must use the opposite Z sign to VRM1')
    assert.ok(vrm1.z * vrm1.w < 0, 'VRM1 left arm still hangs with negative Z')
  })

  it('applies the relaxed rest pose with the flipped sign on VRM 0.x', () => {
    const vrm0 = mockVrm(ALL_BONES, '0') as never as { humanoid: { getNormalizedBoneNode(n: string): THREE.Object3D } }
    applyRelaxedRestPose(vrm0 as never)
    const left = vrm0.humanoid.getNormalizedBoneNode('leftUpperArm').quaternion
    // Negative Z hang on VRM1 → positive Z after the VRM0 flip.
    assert.ok(left.z > 0, 'VRM0 relaxed pose flips the left-arm hang Z')
  })
})

describe('orbit is a body gesture, not a wave (per-bone delta vs idle)', () => {
  // The user saw `orbit` "lift an arm to wave and break the elbow". Root cause:
  // `orbit` had no clip in any source, so `playGesture('orbit')` warned + skipped
  // while the previously-playing wave stayed on screen (the "wrong gesture"
  // report). The fallback now provides a real `orbit` clip that drives hips/spine
  // (a torso circle) and leaves the arms at the idle hang — never a raise, never
  // an elbow fold. This locks that with a per-bone peak-delta-vs-idle audit, the
  // same measurement the earlier gesture audit used.
  const clips = buildProceduralGestureClips(mockVrm() as never)

  function boneTracks(id: string): Map<string, THREE.QuaternionKeyframeTrack> {
    const out = new Map<string, THREE.QuaternionKeyframeTrack>()
    for (const track of clips.find((c) => c.id === id)!.clip.tracks) {
      if (!/\.quaternion$/i.test(track.name)) continue
      out.set(track.name, track as THREE.QuaternionKeyframeTrack)
    }
    return out
  }

  /**
   * For every bone, the peak rotation (deg) away from that bone's idle baseline
   * (its first idle keyframe). A bone the clip holds at the idle rest is 0 — that
   * is how we prove `orbit` does not move the arms the way a wave does.
   */
  function peakDeltaVsIdle(id: string): Map<string, number> {
    const idle = boneTracks('idle')
    const out = new Map<string, number>()
    for (const [name, track] of boneTracks(id)) {
      // Baseline is the bone's idle first key, or the bind rest when idle does
      // not key it at all (idle omits hips/legs, so orbit's torso lean is new).
      const base = idle.get(name)
      const bq = base
        ? new THREE.Quaternion(base.values[0]!, base.values[1]!, base.values[2]!, base.values[3]!)
        : new THREE.Quaternion()
      let peak = 0
      for (let i = 0; i < track.values.length; i += 4) {
        const q = new THREE.Quaternion(
          track.values[i]!,
          track.values[i + 1]!,
          track.values[i + 2]!,
          track.values[i + 3]!,
        )
        peak = Math.max(peak, bq.angleTo(q))
      }
      out.set(name.replace(/\.[^.]+$/, ''), (peak * 180) / Math.PI)
    }
    return out
  }

  it('drives the stance (hips/spine) — it is a body clip', () => {
    const orbit = peakDeltaVsIdle('orbit')
    assert.ok((orbit.get('hips') ?? 0) > 5, `hips delta ${orbit.get('hips')}`)
    assert.ok((orbit.get('spine') ?? 0) > 2, `spine delta ${orbit.get('spine')}`)
    assert.equal(clips.find((c) => c.id === 'orbit')!.overlay, false, 'orbit must be a body clip')
  })

  it('never raises an arm or folds an elbow the way a wave does', () => {
    const orbit = peakDeltaVsIdle('orbit')
    const wave = peakDeltaVsIdle('wave')
    // A wave raises the right upper arm hard and folds the right elbow.
    assert.ok((wave.get('rightUpperArm') ?? 0) > 80, `wave raise ${wave.get('rightUpperArm')}`)
    assert.ok((wave.get('rightLowerArm') ?? 0) > 40, `wave elbow ${wave.get('rightLowerArm')}`)
    // `orbit` keeps the arms at the idle hang (a ≤ a few degrees of sway) and
    // never keys the elbow at all.
    assert.ok(
      (orbit.get('rightUpperArm') ?? 0) < 15,
      `orbit right arm moved ${orbit.get('rightUpperArm')}° vs idle — looks like a raise`,
    )
    assert.ok(
      (orbit.get('leftUpperArm') ?? 0) < 15,
      `orbit left arm moved ${orbit.get('leftUpperArm')}° vs idle`,
    )
    assert.equal(orbit.get('rightLowerArm') ?? 0, 0, 'orbit must not fold the elbow')
    assert.equal(orbit.get('leftLowerArm') ?? 0, 0, 'orbit must not fold the left elbow')
  })

  it('keeps every bone within a sane rotation (< 100°)', () => {
    for (const [bone, deg] of peakDeltaVsIdle('orbit')) {
      assert.ok(deg < 100, `${bone} rotated ${deg.toFixed(1)}° vs idle — contorted pose`)
    }
  })

  it('does not lift or key a hand at all', () => {
    // Structural proxy for the "broken elbow" report: `orbit` leaves the hands on
    // the idle rest, so no hand raise can occur.
    const orbit = peakDeltaVsIdle('orbit')
    assert.ok((orbit.get('leftHand') ?? 0) < 0.5, `orbit moved the left hand`)
    assert.ok((orbit.get('rightHand') ?? 0) < 0.5, `orbit moved the right hand`)
  })
})

describe('mood-pool procedural coverage', () => {
  // If a PRESENCE_MOODS pool names a gesture the fallback set cannot provide,
  // IdlePresenceDirector logs "missing gesture" and the tier silently skips — the
  // exact path that left manifest-less rigs stuck on the rest loop.
  it('provides a fallback clip for every gesture id referenced by a mood pool', () => {
    const clips = buildProceduralGestureClips(mockVrm() as never)
    const ids = new Set(clips.map((c) => c.id))
    const poolIds = new Set<string>()
    for (const mood of Object.values(PRESENCE_MOODS)) {
      for (const id of [
        ...mood.sitFidgets,
        ...mood.microGestures,
        ...mood.mediumGestures,
        ...mood.longGestures,
      ]) {
        poolIds.add(id)
      }
    }
    const missing = [...poolIds].filter((id) => !ids.has(id)).sort()
    assert.deepEqual(missing, [], `mood pools reference ids with no procedural fallback`)
  })

  it('keeps arm-only mood fidgets overlay-safe (never keys spine/legs)', () => {
    const clips = buildProceduralGestureClips(mockVrm() as never)
    // Overlays layer over the standing idle *or* the sit rest loop; a spine key
    // here would snap the body out of the seated long-idle pose.
    for (const id of ['think', 'wave', 'sit_wave', 'v_sign', 'v_sign_short', 'clap']) {
      const clip = clips.find((c) => c.id === id)
      assert.ok(clip, `missing ${id}`)
      assert.equal(clip!.overlay, true, `${id} must be an overlay clip`)
    }
    // Head-only glances are overlays too.
    for (const id of ['look_around', 'look_around_sleepy']) {
      assert.equal(clips.find((c) => c.id === id)!.overlay, true, `${id} must be an overlay`)
    }
  })
})
