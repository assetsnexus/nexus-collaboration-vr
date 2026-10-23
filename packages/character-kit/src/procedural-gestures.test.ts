import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import * as THREE from 'three'
import {
  assignClipUserData,
  buildProceduralGestureClips,
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
function mockVrm(bones: string[] = ALL_BONES) {
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
