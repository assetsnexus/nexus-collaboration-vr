import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { VRMHumanBoneName } from '@pixiv/three-vrm'
import {
  CANONICAL_BONES,
  boneToken,
  isCanonicalBone,
  resolveBoneName,
  resolveBoneToken,
  trackNodeName,
  vroidBoneNodeName,
} from './bone-names.ts'

describe('bone registry stays in sync with three-vrm', () => {
  it('lists exactly the VRMHumanBoneName values', () => {
    // If three-vrm adds a bone this list must be updated, otherwise the guard
    // would silently treat that bone as unknown for every rig.
    assert.deepEqual([...CANONICAL_BONES].sort(), [...Object.values(VRMHumanBoneName)].sort())
  })

  it('has no duplicate tokens and no trailing/leading whitespace', () => {
    const tokens = CANONICAL_BONES.map(boneToken)
    assert.equal(new Set(tokens).size, tokens.length)
    for (const bone of CANONICAL_BONES) assert.equal(bone, bone.trim())
  })
})

describe('resolveBoneName', () => {
  it('resolves canonical, VRMA and procedural spellings to the same bone', () => {
    assert.equal(resolveBoneName('Head'), 'head')
    assert.equal(resolveBoneName('head'), 'head')
    assert.equal(resolveBoneName('Normalized_Head.quaternion'), 'head')
    assert.equal(resolveBoneName('Normalized_LeftUpperArm'), 'leftUpperArm')
    assert.equal(resolveBoneName('Armature/Normalized_RightUpperArm.rotation'), 'rightUpperArm')
  })

  it('resolves VRoid node ids — the rig names the sampler actually ships', () => {
    assert.equal(resolveBoneName('J_Bip_C_Hips'), 'hips')
    assert.equal(resolveBoneName('J_Bip_C_Spine'), 'spine')
    assert.equal(resolveBoneName('J_Bip_C_UpperChest'), 'upperChest')
    assert.equal(resolveBoneName('J_Bip_L_UpperArm'), 'leftUpperArm')
    assert.equal(resolveBoneName('J_Bip_R_LowerLeg'), 'rightLowerLeg')
    assert.equal(resolveBoneName('J_Bip_L_ToeBase'), 'leftToes')
    // The normalized-bone wrapper the VRMA/procedural tracks carry.
    assert.equal(resolveBoneName('Normalized_J_Bip_C_Head'), 'head')
    assert.equal(resolveBoneName('Normalized_J_Bip_R_Hand'), 'rightHand')
    assert.equal(resolveBoneName('Normalized_J_Bip_L_Index1'), 'leftIndexProximal')
    assert.equal(resolveBoneName('J_Adj_R_FaceEye'), 'rightEye')
  })

  it('resolves common third-party prefixes', () => {
    assert.equal(resolveBoneName('mixamorig:Head'), 'head')
    assert.equal(resolveBoneName('Armature|Hips'), 'hips')
  })

  it('returns null for unknown bones and empty input', () => {
    assert.equal(resolveBoneName('Prop_Cape'), null)
    assert.equal(resolveBoneName(''), null)
    assert.equal(resolveBoneName('   '), null)
  })
})

describe('resolveBoneToken', () => {
  it('folds every spelling of one bone onto one token', () => {
    const spellings = [
      'hips',
      'Hips',
      'Normalized_Hips',
      'J_Bip_C_Hips',
      'Normalized_J_Bip_C_Hips',
      'mixamorig:Hips',
    ]
    const tokens = new Set(spellings.map(resolveBoneToken))
    assert.deepEqual([...tokens], ['hips'])
  })

  it('never returns empty — unknown bones keep a stable slot', () => {
    assert.equal(resolveBoneToken('Prop_Cape.quaternion'), 'propcape')
    assert.equal(resolveBoneToken('Normalized_Prop_Cape'), 'propcape')
  })
})

describe('isCanonicalBone / trackNodeName', () => {
  it('detects canonical bones in any spelling', () => {
    assert.equal(isCanonicalBone('Normalized_J_Bip_L_Hand'), true)
    assert.equal(isCanonicalBone('Prop_Cape'), false)
  })

  it('strips the property suffix and namespace', () => {
    assert.equal(trackNodeName('Armature/Normalized_Head.quaternion'), 'Normalized_Head')
    assert.equal(trackNodeName('head'), 'head')
  })
})

describe('vroidBoneNodeName', () => {
  it('round-trips every VRoid-mapped canonical bone', () => {
    // `jaw` is VRM 1.0-only: VRoid Studio has no jaw bone, so it has no VRoid
    // name. Every bone that does map must survive the round trip.
    for (const bone of CANONICAL_BONES) {
      const vroid = vroidBoneNodeName(bone)
      if (!vroid) continue
      assert.equal(resolveBoneName(vroid), bone, `${vroid} did not resolve back to ${bone}`)
    }
  })

  it('maps the full body skeleton a sampler rig actually ships', () => {
    for (const bone of [
      'hips',
      'spine',
      'chest',
      'upperChest',
      'neck',
      'head',
      'leftUpperArm',
      'rightLowerLeg',
      'leftHand',
      'rightToes',
    ]) {
      assert.ok(vroidBoneNodeName(bone), `no VRoid name for ${bone}`)
    }
  })
})
