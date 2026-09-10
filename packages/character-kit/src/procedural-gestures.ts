import * as THREE from 'three'
import { VRMHumanBoneName, type VRM } from '@pixiv/three-vrm'

type BoneName = (typeof VRMHumanBoneName)[keyof typeof VRMHumanBoneName]

interface BoneEuler {
  bone: BoneName
  x?: number
  y?: number
  z?: number
}

const DEG = THREE.MathUtils.DEG2RAD

/**
 * Relative-to-rest pose (vroid_companion style). Degrees converted to radians.
 * Used only when a VRMA clip is missing for an id.
 */
function relaxedOffsets(): BoneEuler[] {
  return [
    { bone: VRMHumanBoneName.Spine, x: 2 * DEG },
    { bone: VRMHumanBoneName.Chest, x: -3 * DEG },
    { bone: VRMHumanBoneName.Neck, x: 2 * DEG },
    { bone: VRMHumanBoneName.Head, x: -2 * DEG },
    { bone: VRMHumanBoneName.LeftShoulder, z: -4 * DEG },
    { bone: VRMHumanBoneName.RightShoulder, z: 4 * DEG },
    { bone: VRMHumanBoneName.LeftUpperArm, x: 3 * DEG, y: 4 * DEG, z: 64 * DEG },
    { bone: VRMHumanBoneName.RightUpperArm, x: 3 * DEG, y: -4 * DEG, z: -64 * DEG },
    { bone: VRMHumanBoneName.LeftLowerArm, y: 8 * DEG, z: 10 * DEG },
    { bone: VRMHumanBoneName.RightLowerArm, y: -8 * DEG, z: -10 * DEG },
    { bone: VRMHumanBoneName.LeftHand, x: 2 * DEG, z: 4 * DEG },
    { bone: VRMHumanBoneName.RightHand, x: 2 * DEG, z: -4 * DEG },
  ]
}

function headRestOffsets(): BoneEuler[] {
  return [
    { bone: VRMHumanBoneName.Neck, x: 2 * DEG },
    { bone: VRMHumanBoneName.Head, x: -2 * DEG },
  ]
}

/** @internal exported for tests — nod/agree/disagree must not key arms. */
export function headOnlyGestureBones(): BoneName[] {
  return headRestOffsets().map((b) => b.bone)
}

/** Right-arm hang + head. Scratch must not key the left arm (idle keeps it). */
function scratchNoseRestOffsets(): BoneEuler[] {
  return [
    { bone: VRMHumanBoneName.Neck, x: 2 * DEG },
    { bone: VRMHumanBoneName.Head, x: -2 * DEG },
    { bone: VRMHumanBoneName.RightShoulder, z: 4 * DEG },
    { bone: VRMHumanBoneName.RightUpperArm, x: 3 * DEG, y: -4 * DEG, z: -64 * DEG },
    { bone: VRMHumanBoneName.RightLowerArm, y: -8 * DEG, z: -10 * DEG },
    { bone: VRMHumanBoneName.RightHand, x: 2 * DEG, z: -4 * DEG },
  ]
}

/** @internal exported for tests */
export function scratchNoseGestureBones(): BoneName[] {
  return scratchNoseRestOffsets().map((b) => b.bone)
}

const FULL_BODY_BONE = /^(hips|spine|chest|upperChest|leftUpperLeg|rightUpperLeg)/

/** Overlay clips keep idle on unkeyed bones (nod / scratch). */
export function proceduralFramesAreOverlay(bones: Iterable<BoneName>): boolean {
  for (const bone of bones) {
    if (FULL_BODY_BONE.test(bone)) return false
  }
  return true
}

/** Bones the fallback idle loop keys so the mixer never sits on bind T-pose. */
export function proceduralIdleBones(): BoneName[] {
  return relaxedOffsets().map((b) => b.bone)
}

function withBone(base: BoneEuler[], overrides: BoneEuler[]): BoneEuler[] {
  const map = new Map<BoneName, BoneEuler>()
  for (const b of base) map.set(b.bone, { ...b })
  for (const o of overrides) map.set(o.bone, { ...map.get(o.bone), ...o, bone: o.bone })
  return [...map.values()]
}

function quatTrackRelative(
  vrm: VRM,
  bone: BoneName,
  rest: THREE.Quaternion,
  times: number[],
  eulers: Array<{ x?: number; y?: number; z?: number }>,
): THREE.QuaternionKeyframeTrack | null {
  const node = vrm.humanoid?.getNormalizedBoneNode(bone)
  if (!node?.name) return null
  const values: number[] = []
  const e = new THREE.Euler(0, 0, 0, 'XYZ')
  const offset = new THREE.Quaternion()
  const out = new THREE.Quaternion()
  for (const eu of eulers) {
    e.set(eu.x ?? 0, eu.y ?? 0, eu.z ?? 0)
    offset.setFromEuler(e)
    out.copy(rest).multiply(offset)
    values.push(out.x, out.y, out.z, out.w)
  }
  return new THREE.QuaternionKeyframeTrack(`${node.name}.quaternion`, times, values)
}

function clipFromRelativePoses(
  name: string,
  vrm: VRM,
  restMap: Map<BoneName, THREE.Quaternion>,
  times: number[],
  frames: BoneEuler[][],
): THREE.AnimationClip | null {
  if (times.length !== frames.length || times.length < 2) return null
  const boneSet = new Set<BoneName>()
  for (const frame of frames) for (const be of frame) boneSet.add(be.bone)

  const tracks: THREE.KeyframeTrack[] = []
  for (const bone of boneSet) {
    const rest = restMap.get(bone)
    if (!rest) continue
    const eulers = frames.map((frame) => {
      const hit = frame.find((b) => b.bone === bone)
      return hit ? { x: hit.x ?? 0, y: hit.y ?? 0, z: hit.z ?? 0 } : { x: 0, y: 0, z: 0 }
    })
    const t = quatTrackRelative(vrm, bone, rest, times, eulers)
    if (t) tracks.push(t)
  }
  if (!tracks.length) return null
  return new THREE.AnimationClip(name, times[times.length - 1]!, tracks)
}

function captureRestQuats(vrm: VRM): Map<BoneName, THREE.Quaternion> {
  const map = new Map<BoneName, THREE.Quaternion>()
  // Reset to humanoid rest before capture so offsets are relative to T-pose bind
  vrm.humanoid?.resetNormalizedPose()
  for (const name of Object.values(VRMHumanBoneName)) {
    const node = vrm.humanoid?.getNormalizedBoneNode(name)
    if (node) map.set(name, node.quaternion.clone())
  }
  return map
}

interface BoneQuat {
  bone: BoneName
  q: THREE.Quaternion
}

function applyOffsetsFromRest(
  vrm: VRM,
  restMap: Map<BoneName, THREE.Quaternion>,
  offsets: BoneEuler[],
): void {
  const e = new THREE.Euler(0, 0, 0, 'XYZ')
  const q = new THREE.Quaternion()
  for (const be of offsets) {
    const node = vrm.humanoid?.getNormalizedBoneNode(be.bone)
    const rest = restMap.get(be.bone)
    if (!node || !rest) continue
    e.set(be.x ?? 0, be.y ?? 0, be.z ?? 0)
    q.setFromEuler(e)
    node.quaternion.copy(rest).multiply(q)
  }
}

function captureBoneLocals(vrm: VRM, bones: BoneName[]): BoneQuat[] {
  const out: BoneQuat[] = []
  for (const bone of bones) {
    const node = vrm.humanoid?.getNormalizedBoneNode(bone)
    if (node) out.push({ bone, q: node.quaternion.clone() })
  }
  return out
}

function slerpBoneLocals(a: BoneQuat[], b: BoneQuat[], t: number): BoneQuat[] {
  return a.map((ba) => {
    const bb = b.find((x) => x.bone === ba.bone)
    const q = ba.q.clone()
    if (bb) q.slerp(bb.q, t)
    return { bone: ba.bone, q }
  })
}

function withHandWiggle(locals: BoneQuat[], deg: number): BoneQuat[] {
  const extra = new THREE.Quaternion().setFromEuler(new THREE.Euler(deg * DEG, 0, 8 * DEG, 'XYZ'))
  return locals.map((b) => {
    if (b.bone !== VRMHumanBoneName.RightHand) return { bone: b.bone, q: b.q.clone() }
    return { bone: b.bone, q: b.q.clone().multiply(extra) }
  })
}

function clipFromLocalQuatFrames(
  name: string,
  vrm: VRM,
  times: number[],
  frames: BoneQuat[][],
): THREE.AnimationClip | null {
  if (times.length !== frames.length || times.length < 2) return null
  const boneSet = new Set<BoneName>()
  for (const frame of frames) for (const b of frame) boneSet.add(b.bone)
  const tracks: THREE.KeyframeTrack[] = []
  for (const bone of boneSet) {
    const node = vrm.humanoid?.getNormalizedBoneNode(bone)
    if (!node?.name) continue
    const values: number[] = []
    let missing = false
    for (const frame of frames) {
      const hit = frame.find((b) => b.bone === bone)
      if (!hit) {
        missing = true
        break
      }
      values.push(hit.q.x, hit.q.y, hit.q.z, hit.q.w)
    }
    if (missing) continue
    tracks.push(new THREE.QuaternionKeyframeTrack(`${node.name}.quaternion`, times, values))
  }
  if (!tracks.length) return null
  return new THREE.AnimationClip(name, times[times.length - 1]!, tracks)
}

const _ccdEnd = new THREE.Vector3()
const _ccdOrig = new THREE.Vector3()

function scratchNoseWorldTarget(vrm: VRM, out: THREE.Vector3): boolean {
  const head = vrm.humanoid?.getNormalizedBoneNode('head')
  if (!head) return false
  head.updateWorldMatrix(true, false)
  head.getWorldPosition(out)
  // Head bone sits inside the skull; the nose is slightly down and in front (+Z).
  out.x += 0.02
  out.y -= 0.035
  out.z += 0.1
  return true
}

/**
 * Hang → in-front face reach → hang.
 * Unconstrained CCD from hang folds behind the neck; the peak eulers were
 * searched on this VRoid rig so the hand stays in front of the nose.
 */
function buildScratchNoseClip(
  vrm: VRM,
  restMap: Map<BoneName, THREE.Quaternion>,
): THREE.AnimationClip | null {
  const bones = scratchNoseGestureBones()
  const hang = scratchNoseRestOffsets()
  vrm.humanoid?.resetNormalizedPose()
  applyOffsetsFromRest(vrm, restMap, hang)
  vrm.humanoid?.update()
  const hangLocals = captureBoneLocals(vrm, bones)

  const peakOffsets = withBone(hang, [
    { bone: VRMHumanBoneName.RightShoulder, z: 12 * DEG },
    { bone: VRMHumanBoneName.RightUpperArm, x: 30 * DEG, y: 65 * DEG, z: -64 * DEG },
    { bone: VRMHumanBoneName.RightLowerArm, y: 130 * DEG, x: 0 },
    { bone: VRMHumanBoneName.RightHand, x: 14 * DEG, z: -8 * DEG },
    { bone: VRMHumanBoneName.Head, y: 8 * DEG, x: 6 * DEG },
    { bone: VRMHumanBoneName.Neck, x: 4 * DEG },
  ])
  applyOffsetsFromRest(vrm, restMap, peakOffsets)
  vrm.humanoid?.update()
  const ikLocals = captureBoneLocals(vrm, bones)

  const hand = vrm.humanoid?.getNormalizedBoneNode('rightHand')
  const head = vrm.humanoid?.getNormalizedBoneNode('head')
  const target = new THREE.Vector3()
  scratchNoseWorldTarget(vrm, target)
  hand?.getWorldPosition(_ccdEnd)
  const ikDist = hand ? _ccdEnd.distanceTo(target) : 0
  head?.getWorldPosition(_ccdOrig)
  const ikDz = head ? _ccdEnd.z - _ccdOrig.z : 0

  const times = [0, 0.28, 0.55, 0.82, 1.08, 1.4]
  const clip = clipFromLocalQuatFrames('scratch_nose', vrm, times, [
    hangLocals,
    slerpBoneLocals(hangLocals, ikLocals, 0.7),
    ikLocals,
    withHandWiggle(ikLocals, 12),
    slerpBoneLocals(hangLocals, ikLocals, 0.4),
    hangLocals,
  ])
  vrm.humanoid?.resetNormalizedPose()
  if (clip) {
    clip.userData.ikDist = ikDist
    clip.userData.ikDz = ikDz
  }
  return clip
}

/** Snap to relaxed A-pose via relative offsets (not absolute euler overwrite). */
export function applyRelaxedRestPose(vrm: VRM): void {
  vrm.humanoid?.resetNormalizedPose()
  const e = new THREE.Euler(0, 0, 0, 'XYZ')
  const q = new THREE.Quaternion()
  for (const be of relaxedOffsets()) {
    const node = vrm.humanoid?.getNormalizedBoneNode(be.bone)
    if (!node) continue
    const rest = node.quaternion.clone()
    e.set(be.x ?? 0, be.y ?? 0, be.z ?? 0)
    q.setFromEuler(e)
    node.quaternion.copy(rest).multiply(q)
  }
  vrm.humanoid?.update()
  vrm.expressionManager?.setValue('relaxed', 0.35)
  vrm.expressionManager?.setValue('neutral', 0.25)
}

/**
 * Fallback clips for ids without VRMA (nod / agree / disagree).
 * Prefer real VRMA from the gesture pack for everything else.
 */
export function buildProceduralGestureClips(vrm: VRM): Array<{
  id: string
  clip: THREE.AnimationClip
  loop: boolean
  overlay: boolean
  description: string
}> {
  const restMap = captureRestQuats(vrm)
  const out: Array<{
    id: string
    clip: THREE.AnimationClip
    loop: boolean
    overlay: boolean
    description: string
  }> = []
  const R = relaxedOffsets()
  const H = headRestOffsets()

  const add = (
    id: string,
    times: number[],
    frames: BoneEuler[][],
    loop: boolean,
    description: string,
  ) => {
    const clip = clipFromRelativePoses(id, vrm, restMap, times, frames)
    if (!clip) return
    const bones = new Set<BoneName>()
    for (const frame of frames) for (const be of frame) bones.add(be.bone)
    out.push({
      id,
      clip,
      loop,
      overlay: proceduralFramesAreOverlay(bones),
      description,
    })
  }

  // Looping A-pose so loadVRM has a mixer rest clip before VRMA idle arrives.
  add(
    'idle',
    [0, 2, 4],
    [
      R,
      withBone(R, [
        { bone: VRMHumanBoneName.Spine, x: 4 * DEG },
        { bone: VRMHumanBoneName.Chest, x: -4 * DEG },
        { bone: VRMHumanBoneName.LeftUpperArm, z: 68 * DEG },
        { bone: VRMHumanBoneName.RightUpperArm, z: -68 * DEG },
      ]),
      R,
    ],
    true,
    'Procedural relaxed idle',
  )

  add(
    'nod',
    [0, 0.18, 0.36, 0.55],
    [
      H,
      withBone(H, [
        { bone: VRMHumanBoneName.Neck, x: 18 * DEG },
        { bone: VRMHumanBoneName.Head, x: 22 * DEG },
      ]),
      withBone(H, [
        { bone: VRMHumanBoneName.Neck, x: -4 * DEG },
        { bone: VRMHumanBoneName.Head, x: -8 * DEG },
      ]),
      H,
    ],
    false,
    'Procedural head nod',
  )

  add(
    'nod_soft',
    [0, 0.22, 0.48, 0.7],
    [
      H,
      withBone(H, [
        { bone: VRMHumanBoneName.Neck, x: 8 * DEG },
        { bone: VRMHumanBoneName.Head, x: 10 * DEG },
      ]),
      withBone(H, [
        { bone: VRMHumanBoneName.Neck, x: -2 * DEG },
        { bone: VRMHumanBoneName.Head, x: -3 * DEG },
      ]),
      H,
    ],
    false,
    'Soft / small nod variant',
  )

  add(
    'agree',
    [0, 0.2, 0.4, 0.6, 0.8],
    [
      H,
      withBone(H, [
        { bone: VRMHumanBoneName.Neck, x: 16 * DEG },
        { bone: VRMHumanBoneName.Head, x: 20 * DEG },
      ]),
      withBone(H, [
        { bone: VRMHumanBoneName.Neck, x: -2 * DEG },
        { bone: VRMHumanBoneName.Head, x: -6 * DEG },
      ]),
      withBone(H, [
        { bone: VRMHumanBoneName.Neck, x: 14 * DEG },
        { bone: VRMHumanBoneName.Head, x: 18 * DEG },
      ]),
      H,
    ],
    false,
    'Double nod / agree',
  )

  add(
    'disagree',
    [0, 0.2, 0.4, 0.6, 0.8],
    [
      H,
      withBone(H, [{ bone: VRMHumanBoneName.Head, y: 18 * DEG }]),
      withBone(H, [{ bone: VRMHumanBoneName.Head, y: -18 * DEG }]),
      withBone(H, [{ bone: VRMHumanBoneName.Head, y: 12 * DEG }]),
      H,
    ],
    false,
    'Head shake / disagree',
  )

  const scratchClip = buildScratchNoseClip(vrm, restMap)
  if (scratchClip) {
    out.push({
      id: 'scratch_nose',
      clip: scratchClip,
      loop: false,
      overlay: true,
      description: 'Procedural scratch / face touch',
    })
  }

  add(
    'weight_shift_lean_l',
    [0, 0.5, 1.2, 1.8],
    [
      R,
      withBone(R, [
        { bone: VRMHumanBoneName.Spine, z: 4 * DEG, x: 2 * DEG },
        { bone: VRMHumanBoneName.Hips, z: 3 * DEG },
        { bone: VRMHumanBoneName.Chest, z: 3 * DEG },
        { bone: VRMHumanBoneName.LeftUpperArm, z: 70 * DEG },
        { bone: VRMHumanBoneName.RightUpperArm, z: -58 * DEG },
      ]),
      withBone(R, [
        { bone: VRMHumanBoneName.Spine, z: 5 * DEG },
        { bone: VRMHumanBoneName.Hips, z: 4 * DEG },
        { bone: VRMHumanBoneName.Head, y: 4 * DEG },
      ]),
      R,
    ],
    false,
    'Lean left weight shift (procedural)',
  )

  add(
    'weight_shift_lean_r',
    [0, 0.5, 1.2, 1.8],
    [
      R,
      withBone(R, [
        { bone: VRMHumanBoneName.Spine, z: -4 * DEG, x: 2 * DEG },
        { bone: VRMHumanBoneName.Hips, z: -3 * DEG },
        { bone: VRMHumanBoneName.Chest, z: -3 * DEG },
        { bone: VRMHumanBoneName.LeftUpperArm, z: 58 * DEG },
        { bone: VRMHumanBoneName.RightUpperArm, z: -70 * DEG },
      ]),
      withBone(R, [
        { bone: VRMHumanBoneName.Spine, z: -5 * DEG },
        { bone: VRMHumanBoneName.Hips, z: -4 * DEG },
        { bone: VRMHumanBoneName.Head, y: -4 * DEG },
      ]),
      R,
    ],
    false,
    'Lean right weight shift (procedural)',
  )

  // True crouch (knees bent) — not the floating chair sit VRMA
  add(
    'crouch_idle',
    [0, 0.6, 1.8, 2.4],
    [
      R,
      withBone(R, [
        { bone: VRMHumanBoneName.Hips, x: 18 * DEG },
        { bone: VRMHumanBoneName.Spine, x: 12 * DEG },
        { bone: VRMHumanBoneName.Chest, x: 6 * DEG },
        { bone: VRMHumanBoneName.LeftUpperLeg, x: -75 * DEG },
        { bone: VRMHumanBoneName.RightUpperLeg, x: -75 * DEG },
        { bone: VRMHumanBoneName.LeftLowerLeg, x: 100 * DEG },
        { bone: VRMHumanBoneName.RightLowerLeg, x: 100 * DEG },
        { bone: VRMHumanBoneName.LeftUpperArm, z: 75 * DEG, x: 15 * DEG },
        { bone: VRMHumanBoneName.RightUpperArm, z: -75 * DEG, x: 15 * DEG },
        { bone: VRMHumanBoneName.Head, x: 8 * DEG },
      ]),
      withBone(R, [
        { bone: VRMHumanBoneName.Hips, x: 16 * DEG },
        { bone: VRMHumanBoneName.Spine, x: 10 * DEG },
        { bone: VRMHumanBoneName.LeftUpperLeg, x: -72 * DEG },
        { bone: VRMHumanBoneName.RightUpperLeg, x: -72 * DEG },
        { bone: VRMHumanBoneName.LeftLowerLeg, x: 96 * DEG },
        { bone: VRMHumanBoneName.RightLowerLeg, x: 96 * DEG },
        { bone: VRMHumanBoneName.Head, x: 6 * DEG, y: 3 * DEG },
      ]),
      withBone(R, [
        { bone: VRMHumanBoneName.Hips, x: 18 * DEG },
        { bone: VRMHumanBoneName.Spine, x: 12 * DEG },
        { bone: VRMHumanBoneName.LeftUpperLeg, x: -75 * DEG },
        { bone: VRMHumanBoneName.RightUpperLeg, x: -75 * DEG },
        { bone: VRMHumanBoneName.LeftLowerLeg, x: 100 * DEG },
        { bone: VRMHumanBoneName.RightLowerLeg, x: 100 * DEG },
      ]),
    ],
    true,
    'Procedural crouch hold (knees bent — not chair sit)',
  )

  // Opposite-leg walk: hung arms (Z) + sagittal swing on Y (X lifts/raises
  // in VRM A-pose — that was the "hands up" bug). Arm opposite the lead leg.
  const walkHang = withBone(R, [
    { bone: VRMHumanBoneName.LeftUpperArm, x: 6 * DEG, y: 0, z: 72 * DEG },
    { bone: VRMHumanBoneName.RightUpperArm, x: 6 * DEG, y: 0, z: -72 * DEG },
    { bone: VRMHumanBoneName.LeftLowerArm, y: 10 * DEG, z: 8 * DEG },
    { bone: VRMHumanBoneName.RightLowerArm, y: -10 * DEG, z: -8 * DEG },
  ])
  const walkL = withBone(walkHang, [
    { bone: VRMHumanBoneName.Hips, y: 4 * DEG },
    { bone: VRMHumanBoneName.Spine, x: 3 * DEG },
    { bone: VRMHumanBoneName.LeftUpperLeg, x: -28 * DEG },
    { bone: VRMHumanBoneName.RightUpperLeg, x: 20 * DEG },
    { bone: VRMHumanBoneName.LeftLowerLeg, x: 24 * DEG },
    { bone: VRMHumanBoneName.RightLowerLeg, x: 6 * DEG },
    // left leg forward → left arm back (+Y), right arm forward (−Y)
    { bone: VRMHumanBoneName.LeftUpperArm, y: 32 * DEG },
    { bone: VRMHumanBoneName.RightUpperArm, y: -32 * DEG },
    { bone: VRMHumanBoneName.LeftLowerArm, y: 6 * DEG },
    { bone: VRMHumanBoneName.RightLowerArm, y: -18 * DEG },
  ])
  const walkR = withBone(walkHang, [
    { bone: VRMHumanBoneName.Hips, y: -4 * DEG },
    { bone: VRMHumanBoneName.Spine, x: 3 * DEG },
    { bone: VRMHumanBoneName.LeftUpperLeg, x: 20 * DEG },
    { bone: VRMHumanBoneName.RightUpperLeg, x: -28 * DEG },
    { bone: VRMHumanBoneName.LeftLowerLeg, x: 6 * DEG },
    { bone: VRMHumanBoneName.RightLowerLeg, x: 24 * DEG },
    { bone: VRMHumanBoneName.LeftUpperArm, y: -32 * DEG },
    { bone: VRMHumanBoneName.RightUpperArm, y: 32 * DEG },
    { bone: VRMHumanBoneName.LeftLowerArm, y: 18 * DEG },
    { bone: VRMHumanBoneName.RightLowerArm, y: -6 * DEG },
  ])
  add(
    'walk',
    [0, 0.28, 0.55, 0.82, 1.1],
    [walkHang, walkL, walkHang, walkR, walkHang],
    true,
    'Procedural walk cycle (locomotion)',
  )

  // --- Extra locomotion gaits (overridable by VRMA / manifest.locomotion) ---
  const runHang = withBone(R, [
    { bone: VRMHumanBoneName.Spine, x: 8 * DEG },
    { bone: VRMHumanBoneName.LeftUpperArm, x: 10 * DEG, y: 0, z: 68 * DEG },
    { bone: VRMHumanBoneName.RightUpperArm, x: 10 * DEG, y: 0, z: -68 * DEG },
  ])
  const runL = withBone(runHang, [
    { bone: VRMHumanBoneName.Hips, y: 6 * DEG },
    { bone: VRMHumanBoneName.LeftUpperLeg, x: -42 * DEG },
    { bone: VRMHumanBoneName.RightUpperLeg, x: 28 * DEG },
    { bone: VRMHumanBoneName.LeftLowerLeg, x: 40 * DEG },
    { bone: VRMHumanBoneName.RightLowerLeg, x: 8 * DEG },
    { bone: VRMHumanBoneName.LeftUpperArm, y: 42 * DEG },
    { bone: VRMHumanBoneName.RightUpperArm, y: -42 * DEG },
  ])
  const runR = withBone(runHang, [
    { bone: VRMHumanBoneName.Hips, y: -6 * DEG },
    { bone: VRMHumanBoneName.LeftUpperLeg, x: 28 * DEG },
    { bone: VRMHumanBoneName.RightUpperLeg, x: -42 * DEG },
    { bone: VRMHumanBoneName.LeftLowerLeg, x: 8 * DEG },
    { bone: VRMHumanBoneName.RightLowerLeg, x: 40 * DEG },
    { bone: VRMHumanBoneName.LeftUpperArm, y: -42 * DEG },
    { bone: VRMHumanBoneName.RightUpperArm, y: 42 * DEG },
  ])
  add('run', [0, 0.22, 0.44, 0.66, 0.88], [runHang, runL, runHang, runR, runHang], true, 'Procedural run cycle')

  const carefulHang = withBone(R, [
    { bone: VRMHumanBoneName.Spine, x: 4 * DEG },
    { bone: VRMHumanBoneName.LeftUpperArm, x: 4 * DEG, y: 0, z: 74 * DEG },
    { bone: VRMHumanBoneName.RightUpperArm, x: 4 * DEG, y: 0, z: -74 * DEG },
  ])
  const carefulL = withBone(carefulHang, [
    { bone: VRMHumanBoneName.Hips, y: 2 * DEG },
    { bone: VRMHumanBoneName.LeftUpperLeg, x: -14 * DEG },
    { bone: VRMHumanBoneName.RightUpperLeg, x: 10 * DEG },
    { bone: VRMHumanBoneName.LeftLowerLeg, x: 12 * DEG },
    { bone: VRMHumanBoneName.LeftUpperArm, y: 12 * DEG },
    { bone: VRMHumanBoneName.RightUpperArm, y: -12 * DEG },
  ])
  const carefulR = withBone(carefulHang, [
    { bone: VRMHumanBoneName.Hips, y: -2 * DEG },
    { bone: VRMHumanBoneName.LeftUpperLeg, x: 10 * DEG },
    { bone: VRMHumanBoneName.RightUpperLeg, x: -14 * DEG },
    { bone: VRMHumanBoneName.RightLowerLeg, x: 12 * DEG },
    { bone: VRMHumanBoneName.LeftUpperArm, y: -12 * DEG },
    { bone: VRMHumanBoneName.RightUpperArm, y: 12 * DEG },
  ])
  add(
    'walk_careful',
    [0, 0.35, 0.7, 1.05, 1.4],
    [carefulHang, carefulL, carefulHang, carefulR, carefulHang],
    true,
    'Procedural careful / sneak walk',
  )

  const crouchHang = withBone(R, [
    { bone: VRMHumanBoneName.Hips, x: -28 * DEG },
    { bone: VRMHumanBoneName.Spine, x: 12 * DEG },
    { bone: VRMHumanBoneName.LeftUpperLeg, x: -55 * DEG },
    { bone: VRMHumanBoneName.RightUpperLeg, x: -55 * DEG },
    { bone: VRMHumanBoneName.LeftLowerLeg, x: 75 * DEG },
    { bone: VRMHumanBoneName.RightLowerLeg, x: 75 * DEG },
    { bone: VRMHumanBoneName.LeftUpperArm, x: 8 * DEG, y: 0, z: 70 * DEG },
    { bone: VRMHumanBoneName.RightUpperArm, x: 8 * DEG, y: 0, z: -70 * DEG },
  ])
  const crouchL = withBone(crouchHang, [
    { bone: VRMHumanBoneName.Hips, y: 4 * DEG, x: -28 * DEG },
    { bone: VRMHumanBoneName.LeftUpperLeg, x: -70 * DEG },
    { bone: VRMHumanBoneName.RightUpperLeg, x: -40 * DEG },
    { bone: VRMHumanBoneName.LeftLowerLeg, x: 90 * DEG },
    { bone: VRMHumanBoneName.RightLowerLeg, x: 60 * DEG },
    { bone: VRMHumanBoneName.LeftUpperArm, y: 18 * DEG },
    { bone: VRMHumanBoneName.RightUpperArm, y: -18 * DEG },
  ])
  const crouchR = withBone(crouchHang, [
    { bone: VRMHumanBoneName.Hips, y: -4 * DEG, x: -28 * DEG },
    { bone: VRMHumanBoneName.LeftUpperLeg, x: -40 * DEG },
    { bone: VRMHumanBoneName.RightUpperLeg, x: -70 * DEG },
    { bone: VRMHumanBoneName.LeftLowerLeg, x: 60 * DEG },
    { bone: VRMHumanBoneName.RightLowerLeg, x: 90 * DEG },
    { bone: VRMHumanBoneName.LeftUpperArm, y: -18 * DEG },
    { bone: VRMHumanBoneName.RightUpperArm, y: 18 * DEG },
  ])
  add(
    'walk_crouch',
    [0, 0.32, 0.64, 0.96, 1.28],
    [crouchHang, crouchL, crouchHang, crouchR, crouchHang],
    true,
    'Procedural crouch-walk',
  )

  const crawlHang = withBone(R, [
    { bone: VRMHumanBoneName.Hips, x: -75 * DEG },
    { bone: VRMHumanBoneName.Spine, x: 20 * DEG },
    { bone: VRMHumanBoneName.Chest, x: 15 * DEG },
    { bone: VRMHumanBoneName.Head, x: -20 * DEG },
    { bone: VRMHumanBoneName.LeftUpperLeg, x: -90 * DEG },
    { bone: VRMHumanBoneName.RightUpperLeg, x: -90 * DEG },
    { bone: VRMHumanBoneName.LeftLowerLeg, x: 100 * DEG },
    { bone: VRMHumanBoneName.RightLowerLeg, x: 100 * DEG },
    { bone: VRMHumanBoneName.LeftUpperArm, x: -40 * DEG, y: 20 * DEG, z: 50 * DEG },
    { bone: VRMHumanBoneName.RightUpperArm, x: -40 * DEG, y: -20 * DEG, z: -50 * DEG },
  ])
  const crawlL = withBone(crawlHang, [
    { bone: VRMHumanBoneName.LeftUpperArm, x: -55 * DEG, y: 10 * DEG },
    { bone: VRMHumanBoneName.RightUpperArm, x: -25 * DEG, y: -30 * DEG },
    { bone: VRMHumanBoneName.LeftUpperLeg, x: -100 * DEG },
    { bone: VRMHumanBoneName.RightUpperLeg, x: -80 * DEG },
  ])
  const crawlR = withBone(crawlHang, [
    { bone: VRMHumanBoneName.LeftUpperArm, x: -25 * DEG, y: 30 * DEG },
    { bone: VRMHumanBoneName.RightUpperArm, x: -55 * DEG, y: -10 * DEG },
    { bone: VRMHumanBoneName.LeftUpperLeg, x: -80 * DEG },
    { bone: VRMHumanBoneName.RightUpperLeg, x: -100 * DEG },
  ])
  add(
    'walk_crawl',
    [0, 0.4, 0.8, 1.2, 1.6],
    [crawlHang, crawlL, crawlHang, crawlR, crawlHang],
    true,
    'Procedural floor crawl',
  )

  const rollA = withBone(R, [
    { bone: VRMHumanBoneName.Hips, z: 35 * DEG, x: -10 * DEG },
    { bone: VRMHumanBoneName.Spine, z: 25 * DEG },
    { bone: VRMHumanBoneName.LeftUpperLeg, x: -40 * DEG },
    { bone: VRMHumanBoneName.RightUpperLeg, x: -20 * DEG },
    { bone: VRMHumanBoneName.LeftUpperArm, z: 40 * DEG, x: -30 * DEG },
    { bone: VRMHumanBoneName.RightUpperArm, z: -90 * DEG, x: -20 * DEG },
  ])
  const rollB = withBone(R, [
    { bone: VRMHumanBoneName.Hips, z: -35 * DEG, x: -10 * DEG },
    { bone: VRMHumanBoneName.Spine, z: -25 * DEG },
    { bone: VRMHumanBoneName.LeftUpperLeg, x: -20 * DEG },
    { bone: VRMHumanBoneName.RightUpperLeg, x: -40 * DEG },
    { bone: VRMHumanBoneName.LeftUpperArm, z: 90 * DEG, x: -20 * DEG },
    { bone: VRMHumanBoneName.RightUpperArm, z: -40 * DEG, x: -30 * DEG },
  ])
  add(
    'walk_roll',
    [0, 0.35, 0.7, 1.05, 1.4],
    [R, rollA, R, rollB, R],
    true,
    'Procedural sideways roll / barrel roll gait',
  )

  add(
    'jump',
    [0, 0.12, 0.35, 0.55],
    [
      R,
      withBone(R, [
        { bone: VRMHumanBoneName.Hips, x: -6 * DEG },
        { bone: VRMHumanBoneName.LeftUpperLeg, x: -20 * DEG },
        { bone: VRMHumanBoneName.RightUpperLeg, x: -20 * DEG },
        { bone: VRMHumanBoneName.LeftLowerLeg, x: 35 * DEG },
        { bone: VRMHumanBoneName.RightLowerLeg, x: 35 * DEG },
        { bone: VRMHumanBoneName.LeftUpperArm, z: 80 * DEG, x: -20 * DEG },
        { bone: VRMHumanBoneName.RightUpperArm, z: -80 * DEG, x: -20 * DEG },
      ]),
      withBone(R, [
        { bone: VRMHumanBoneName.Hips, x: 8 * DEG },
        { bone: VRMHumanBoneName.Spine, x: -4 * DEG },
        { bone: VRMHumanBoneName.LeftUpperLeg, x: 10 * DEG },
        { bone: VRMHumanBoneName.RightUpperLeg, x: 10 * DEG },
        { bone: VRMHumanBoneName.LeftUpperArm, z: 90 * DEG, x: -35 * DEG },
        { bone: VRMHumanBoneName.RightUpperArm, z: -90 * DEG, x: -35 * DEG },
      ]),
      R,
    ],
    false,
    'Procedural jump pose',
  )

  return out
}

/** @deprecated absolute euler rest — use applyRelaxedRestPose */
export function relaxedFrame(): BoneEuler[] {
  return relaxedOffsets()
}
