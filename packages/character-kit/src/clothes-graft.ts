import * as THREE from 'three'
import { VRMSpringBoneJoint, type VRM, type VRMSpringBoneManager } from '@pixiv/three-vrm'
import { nearestMappedAncestorName, namedNodeDepth } from './clothes-graft-tree.js'

const HUMANOID_FALLBACK: Array<'hips' | 'spine' | 'chest' | 'upperChest' | 'neck' | 'head'> = [
  'hips',
  'spine',
  'chest',
  'upperChest',
  'neck',
  'head',
]

export function collectBonesByName(root: THREE.Object3D): Map<string, THREE.Bone> {
  const map = new Map<string, THREE.Bone>()
  root.traverse((obj) => {
    const bone = obj as THREE.Bone
    if (bone.isBone && bone.name) map.set(bone.name, bone)
  })
  return map
}

function fallbackAttachParent(host: VRM): THREE.Object3D {
  for (const name of HUMANOID_FALLBACK) {
    const node = host.humanoid?.getBoneNode(name)
    if (node) return node
  }
  return host.scene
}

function cloneBoneLocal(src: THREE.Bone): THREE.Bone {
  const clone = new THREE.Bone()
  clone.name = src.name
  clone.position.copy(src.position)
  clone.quaternion.copy(src.quaternion)
  clone.scale.copy(src.scale)
  return clone
}

function cloneDummyChild(src: THREE.Object3D, parent: THREE.Object3D): THREE.Object3D {
  const dummy = new THREE.Object3D()
  dummy.name = src.name
  dummy.position.copy(src.position)
  dummy.quaternion.copy(src.quaternion)
  dummy.scale.copy(src.scale)
  parent.add(dummy)
  return dummy
}

/**
 * Copy donor skeleton bones that the host lacks, parented under the nearest
 * shared ancestor (usually hips/head) so accessory chains follow the avatar.
 * Every skeleton slot must resolve to a host-side bone — leftover donor bones
 * stay in the cached donor scene and drift opposite the walking character.
 */
export function graftMissingClothesBones(
  mesh: THREE.SkinnedMesh,
  host: VRM,
  boneIndex: Map<string, THREE.Bone>,
): { bound: number; missing: string[]; grafted: THREE.Bone[] } {
  const donorBones = mesh.skeleton.bones
  const mapped = new Set(boneIndex.keys())
  const grafted: THREE.Bone[] = []
  const missing: string[] = []
  const attachFallback = fallbackAttachParent(host)
  const slotGraft = new Map<number, THREE.Bone>()

  const pendingIdx = donorBones
    .map((_bone, i) => i)
    .filter((i) => {
      const bone = donorBones[i]!
      return !(bone.name && boneIndex.has(bone.name))
    })
  pendingIdx.sort((a, b) => namedNodeDepth(donorBones[a]!) - namedNodeDepth(donorBones[b]!))

  for (const i of pendingIdx) {
    const donor = donorBones[i]!
    if (donor.name && boneIndex.has(donor.name)) continue
    const clone = cloneBoneLocal(donor)
    if (!clone.name) clone.name = `overlay_graft_${grafted.length}`
    if (boneIndex.has(clone.name)) {
      clone.name = `overlay_graft_${grafted.length}_${i}`
    }
    const ancestorName = donor.name ? nearestMappedAncestorName(donor, mapped) : null
    const parent = ancestorName ? (boneIndex.get(ancestorName) ?? attachFallback) : attachFallback
    parent.add(clone)
    clone.updateMatrix()
    boneIndex.set(clone.name, clone)
    mapped.add(clone.name)
    grafted.push(clone)
    missing.push(donor.name || clone.name)
    slotGraft.set(i, clone)
  }

  const resolved = donorBones.map((bone, i) => {
    if (bone.name && boneIndex.has(bone.name)) return boneIndex.get(bone.name)!
    return slotGraft.get(i)!
  })
  const inverses = mesh.skeleton.boneInverses.map((m) => m.clone())
  mesh.bind(new THREE.Skeleton(resolved, inverses), mesh.bindMatrix)
  return { bound: resolved.length, missing, grafted }
}

function resolveSpringNode(
  donorNode: THREE.Object3D | null,
  boneIndex: Map<string, THREE.Bone>,
  graftedParent: THREE.Object3D,
): THREE.Object3D | null {
  if (!donorNode) return null
  if (donorNode.name && boneIndex.has(donorNode.name)) return boneIndex.get(donorNode.name)!
  return cloneDummyChild(donorNode, graftedParent)
}

/**
 * Drive grafted accessory bones with a copy of the donor VRM's spring joints.
 * Only joints on grafted bones are added so host hair/cloth springs are untouched.
 */
export function installOverlaySpringBones(
  manager: VRMSpringBoneManager | undefined,
  donor: VRM,
  graftedNames: Set<string>,
  boneIndex: Map<string, THREE.Bone>,
): VRMSpringBoneJoint[] {
  const donorManager = donor.springBoneManager
  if (!manager || !donorManager || graftedNames.size === 0) return []
  const installed: VRMSpringBoneJoint[] = []
  const seen = new Set<string>()
  for (const joint of donorManager.joints) {
    const name = joint.bone.name
    if (!name || !graftedNames.has(name) || seen.has(name)) continue
    const bone = boneIndex.get(name)
    if (!bone) continue
    seen.add(name)
    const child = resolveSpringNode(joint.child, boneIndex, bone)
    const next = new VRMSpringBoneJoint(bone, child, {
      hitRadius: joint.settings.hitRadius,
      stiffness: joint.settings.stiffness,
      gravityPower: joint.settings.gravityPower,
      gravityDir: joint.settings.gravityDir.clone(),
      dragForce: joint.settings.dragForce,
    })
    if (joint.center?.name && boneIndex.has(joint.center.name)) {
      next.center = boneIndex.get(joint.center.name)!
    }
    manager.addJoint(next)
    next.setInitState()
    installed.push(next)
  }
  return installed
}

export function releaseOverlayGrafts(
  host: VRM | null,
  joints: VRMSpringBoneJoint[],
  bones: THREE.Bone[],
): void {
  const manager = host?.springBoneManager
  for (const joint of joints) manager?.deleteJoint(joint)
  for (const bone of bones) {
    bone.parent?.remove(bone)
  }
}
