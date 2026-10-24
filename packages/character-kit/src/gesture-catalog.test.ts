import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import * as THREE from 'three'
import { VRMHumanBoneName } from '@pixiv/three-vrm'
import {
  checkRigCompatibility,
  clipBoneTargets,
  rigBoneNames,
} from './animation-guard.ts'
import { clipIsOverlay, trackOccupancy } from './gesture-overlap.ts'
import { buildProceduralGestureClips } from './procedural-gestures.ts'
import { clipPlaybackDurationMs, defaultGestureTimeScale } from './gesture-variants.ts'
import { GESTURE_CATALOG, catalogLayer, diffCatalogEntry } from './gesture-catalog.ts'
import { vroidBoneNodeName } from './bone-names.ts'

/**
 * A VRoid-style rig: every normalized bone node is named `J_Bip_*`, exactly like
 * the sampler the companion actually loads. This is what made the old rig guard
 * refuse every clip — the rig reported `hips` while the clip tracks said
 * `Normalized_J_Bip_C_Hips`.
 */
function mockVroidRig() {
  const root = new THREE.Object3D()
  root.name = 'root'
  const nodes = new Map<string, THREE.Object3D>()
  let i = 0
  for (const bone of Object.values(VRMHumanBoneName)) {
    const node = new THREE.Object3D()
    node.name = vroidBoneNodeName(bone) ?? bone
    node.position.set(i++ * 0.03, bone === 'head' ? 1.55 : 1.0, 0)
    root.add(node)
    nodes.set(bone, node)
  }
  root.updateMatrixWorld(true)
  return {
    scene: root,
    humanoid: {
      getNormalizedBoneNode(name: string) {
        return nodes.get(name as (typeof VRMHumanBoneName)[keyof typeof VRMHumanBoneName]) ?? null
      },
      resetNormalizedPose() {
        for (const node of nodes.values()) node.quaternion.identity()
      },
      update() {
        root.updateMatrixWorld(true)
      },
    },
    expressionManager: { setValue() {} },
  }
}

function loadedFromProcedural() {
  const clips = buildProceduralGestureClips(mockVroidRig() as never)
  const byId = new Map(
    clips.map((c) => [
      c.id,
      {
        id: c.id,
        loop: c.loop,
        overlay: c.overlay,
        durationMs: clipPlaybackDurationMs(c.clip.duration, {
          loop: c.loop,
          timeScale: defaultGestureTimeScale(c.id),
        }),
        clip: c.clip,
      },
    ]),
  )
  return byId
}

describe('gesture catalog coverage', () => {
  const loaded = loadedFromProcedural()

  it('resolves every catalog entry to a real, loadable clip', () => {
    const missing = GESTURE_CATALOG.filter((e) => !loaded.has(e.id)).map((e) => e.id)
    assert.deepEqual(missing, [], 'catalog ids with no procedural/VRNA clip loaded')
  })

  it('matches the declared layer, loop flag and duration for every entry', () => {
    const mismatches: string[] = []
    for (const entry of GESTURE_CATALOG) {
      const actual = loaded.get(entry.id)
      if (!actual) continue
      const problems = diffCatalogEntry(entry, actual)
      if (problems.length) mismatches.push(`${entry.id}: ${problems.join('; ')}`)
    }
    assert.deepEqual(mismatches, [])
  })

  it('has no duplicate ids and no catalog gaps', () => {
    const ids = GESTURE_CATALOG.map((e) => e.id)
    assert.equal(new Set(ids).size, ids.length)
    // Every procedural clip the fallback builder offers must be either in the
    // catalog or an internal helper the catalog deliberately does not surface.
    const internalOnly = new Set<string>()
    const uncatalogued = [...loaded.keys()].filter(
      (id) => !ids.includes(id) && !internalOnly.has(id),
    )
    assert.deepEqual(uncatalogued, [], 'loaded clips missing from GESTURE_CATALOG')
  })
})

describe('per-layer behaviour', () => {
  const loaded = loadedFromProcedural()

  it('overlay clips never own stance bones (so they blend over the base loop)', () => {
    for (const entry of GESTURE_CATALOG.filter((e) => e.layer === 'overlay')) {
      const clip = loaded.get(entry.id)!.clip
      const occupied = trackOccupancy(clip)
      assert.ok(occupied.length > 0, `${entry.id} keys nothing`)
      assert.equal(clipIsOverlay(occupied), true, `${entry.id} must not key hips/legs`)
    }
  })

  it('body clips drive the stance', () => {
    for (const entry of GESTURE_CATALOG.filter((e) => e.layer === 'body')) {
      const clip = loaded.get(entry.id)!.clip
      assert.equal(
        clipIsOverlay(trackOccupancy(clip)),
        false,
        `${entry.id} is a body clip but keys no stance bone`,
      )
    }
  })

  it('loop clips are flagged loop and cancellable (no clampWhenFinished semantics)', () => {
    for (const entry of GESTURE_CATALOG.filter((e) => e.layer === 'loop')) {
      assert.equal(loaded.get(entry.id)!.loop, true, `${entry.id} must loop`)
    }
  })

  it('one-shots have a finite, non-zero wall-clock duration', () => {
    for (const entry of GESTURE_CATALOG.filter((e) => !e.loop)) {
      const d = loaded.get(entry.id)!.durationMs
      assert.ok(d != null && d > 0, `${entry.id} duration ${d}`)
    }
  })

  it('indexed layers are consistent with the layer helper', () => {
    for (const entry of GESTURE_CATALOG) {
      const clip = loaded.get(entry.id)!
      assert.equal(catalogLayer(clip.loop, clip.overlay), entry.layer)
    }
  })
})

describe('rig compatibility on a VRoid rig (the 27/32 regression)', () => {
  const rig = mockVroidRig()
  const rigBones = rigBoneNames(
    (bone) =>
      (rig.humanoid.getNormalizedBoneNode(bone) ??
        rig.humanoid.getNormalizedBoneNode(bone.replace(/^./, (c) => c.toLowerCase()))) as
        | THREE.Object3D
        | null,
    Object.values(VRMHumanBoneName),
    [...rig.scene.children],
  )

  it('reports the rig as canonical tokens, not raw node ids', () => {
    assert.ok(rigBones.includes('hips'))
    assert.ok(rigBones.includes('leftupperarm'))
    assert.ok(!rigBones.some((b) => b.startsWith('jbip')))
  })

  it('accepts a VRMA/procedural clip that keys Normalized_J_Bip_* bones', () => {
    const clip = {
      tracks: [
        { name: 'Normalized_J_Bip_C_Spine.quaternion' },
        { name: 'Normalized_J_Bip_C_Chest.quaternion' },
        { name: 'Normalized_J_Bip_C_Head.quaternion' },
        { name: 'Normalized_J_Bip_L_UpperArm.quaternion' },
        { name: 'Normalized_J_Bip_R_UpperArm.quaternion' },
        { name: 'Normalized_J_Bip_C_Hips.quaternion' },
        { name: 'Normalized_J_Bip_L_UpperLeg.quaternion' },
      ],
    }
    assert.deepEqual(
      clipBoneTargets(clip).sort(),
      ['chest', 'head', 'hips', 'leftupperarm', 'leftupperleg', 'rightupperarm', 'spine'],
    )
    const verdict = checkRigCompatibility(clip, rigBones)
    assert.equal(verdict.compatible, true, verdict.reason)
    assert.equal(verdict.coverage, 1)
  })

  it('still refuses a clip the rig genuinely lacks most bones of', () => {
    const clip = {
      tracks: [
        { name: 'Normalized_J_Bip_C_Head.quaternion' },
        { name: 'Normalized_Prop_Cape_1.quaternion' },
        { name: 'Normalized_Prop_Cape_2.quaternion' },
        { name: 'Normalized_Prop_Cape_3.quaternion' },
        { name: 'Normalized_Prop_Cape_4.quaternion' },
      ],
    }
    const verdict = checkRigCompatibility(clip, rigBones)
    assert.equal(verdict.compatible, false)
  })
})
