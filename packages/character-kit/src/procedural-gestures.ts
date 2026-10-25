import * as THREE from 'three'
import { VRMHumanBoneName, type VRM } from '@pixiv/three-vrm'
import { boneToken } from './bone-names.ts'
import { keysStanceBones } from './gesture-overlap.ts'

type BoneName = (typeof VRMHumanBoneName)[keyof typeof VRMHumanBoneName]

interface BoneEuler {
  bone: BoneName
  x?: number
  y?: number
  z?: number
}

const DEG = THREE.MathUtils.DEG2RAD

/**
 * Arm Z sign convention on a three-vrm normalized T-pose bind, verified against
 * a live VRM-1.0 rig: the **left** arm lowers with a **negative** Z rotation and
 * the **right** arm lowers with a **positive** one. Raises (wave, stretch,
 * think) use the opposite signs. Authoring a hang pose with the raise signs was
 * what left both arms stuck overhead — keep every hang/rest base on these signs.
 *
 * @internal exported for tests
 */
export const ARM_HANG_L = -1
/** @internal exported for tests */
export const ARM_HANG_R = 1

/**
 * Is this a VRM 0.x model? VRM 0.x authors the humanoid facing −Y (Unity); the
 * loader counter-rotates the scene (`VRMUtils.rotateVRM0`), which **mirrors the
 * arm bones' local frame**. A given local-axis offset therefore lowers the arm
 * on a VRM 1.0 rig but RAISES it on a VRM 0.x rig. The rest/idle offsets below
 * are authored for the VRM 1.0 frame, so VRM 0.x needs their arm-axis sign
 * flipped to converge on the same visible A-pose. Detected per-model from the
 * spec version (never hardcoded per file), matching three-vrm's own check.
 */
export function isVrm0(vrm: VRM): boolean {
  return (vrm.meta as { metaVersion?: string } | undefined)?.metaVersion === '0'
}

/**
 * Upper-arm-chain bones whose three-vrm normalized local frame is mirrored
 * between VRM 0.x and 1.x. Offsets on these bones are authored for the VRM 1.0
 * frame and Z-flipped for VRM 0.x.
 */
const ARM_FRAME_BONES: ReadonlySet<string> = new Set<string>([
  VRMHumanBoneName.LeftShoulder,
  VRMHumanBoneName.RightShoulder,
  VRMHumanBoneName.LeftUpperArm,
  VRMHumanBoneName.RightUpperArm,
  VRMHumanBoneName.LeftLowerArm,
  VRMHumanBoneName.RightLowerArm,
  VRMHumanBoneName.LeftHand,
  VRMHumanBoneName.RightHand,
])

/** −1 when a VRM 0.x arm-bone offset must be Z-flipped, +1 otherwise. */
export function armFrameZSign(vrm: VRM, bone: string): number {
  return isVrm0(vrm) && ARM_FRAME_BONES.has(bone) ? -1 : 1
}

/** Left upper-arm hang magnitude (deg) → signed Z offset. */
function hangL(deg: number): number {
  return ARM_HANG_L * deg * DEG
}

/** Right upper-arm hang magnitude (deg) → signed Z offset. */
function hangR(deg: number): number {
  return ARM_HANG_R * deg * DEG
}

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
    // Arms hang down (A-pose): left negative Z, right positive Z.
    { bone: VRMHumanBoneName.LeftUpperArm, x: 3 * DEG, y: 4 * DEG, z: hangL(64) },
    { bone: VRMHumanBoneName.RightUpperArm, x: 3 * DEG, y: -4 * DEG, z: hangR(64) },
    { bone: VRMHumanBoneName.LeftLowerArm, y: 8 * DEG, z: -10 * DEG },
    { bone: VRMHumanBoneName.RightLowerArm, y: -8 * DEG, z: 10 * DEG },
    { bone: VRMHumanBoneName.LeftHand, x: 2 * DEG, z: -4 * DEG },
    { bone: VRMHumanBoneName.RightHand, x: 2 * DEG, z: 4 * DEG },
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
    { bone: VRMHumanBoneName.RightUpperArm, x: 3 * DEG, y: -4 * DEG, z: hangR(64) },
    { bone: VRMHumanBoneName.RightLowerArm, y: -8 * DEG, z: 10 * DEG },
    { bone: VRMHumanBoneName.RightHand, x: 2 * DEG, z: 4 * DEG },
  ]
}

/** @internal exported for tests */
export function scratchNoseGestureBones(): BoneName[] {
  return scratchNoseRestOffsets().map((b) => b.bone)
}

/**
 * Stamp diagnostic values onto a clip's `userData` bag.
 *
 * three.js only started initializing `AnimationClip.userData` in the
 * constructor at 0.171. On 0.170 (the version the desktop app bundles) the
 * field is `undefined`, so a direct `clip.userData.ikDist = …` throws
 * `Cannot set properties of undefined (setting 'ikDist')` and takes down the
 * whole procedural-fallback build (`buildProceduralGestureClips`), which is
 * what stopped VRM-1.0 rigs from rendering. Create the bag defensively.
 *
 * @internal exported for tests
 */
export function assignClipUserData(
  clip: { userData?: Record<string, unknown> },
  data: Record<string, unknown>,
): void {
  if (!clip.userData) clip.userData = {}
  Object.assign(clip.userData, data)
}

/** Overlay clips keep idle on unkeyed bones (nod / scratch). */
export function proceduralFramesAreOverlay(bones: Iterable<BoneName>): boolean {
  const tokens: string[] = []
  for (const bone of bones) tokens.push(boneToken(bone))
  return !keysStanceBones(tokens)
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
  const zSign = armFrameZSign(vrm, bone)
  const values: number[] = []
  const e = new THREE.Euler(0, 0, 0, 'XYZ')
  const offset = new THREE.Quaternion()
  const out = new THREE.Quaternion()
  for (const eu of eulers) {
    e.set(eu.x ?? 0, eu.y ?? 0, (eu.z ?? 0) * zSign)
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
    e.set(be.x ?? 0, be.y ?? 0, (be.z ?? 0) * armFrameZSign(vrm, be.bone))
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

  // Reach values verified on a live VRM-1.0 rig: hand comes up to ~nose height.
  const peakOffsets = withBone(hang, [
    { bone: VRMHumanBoneName.RightShoulder, z: 10 * DEG },
    { bone: VRMHumanBoneName.RightUpperArm, x: 0, y: 18 * DEG, z: -86 * DEG },
    { bone: VRMHumanBoneName.RightLowerArm, y: 108 * DEG, x: 0 },
    { bone: VRMHumanBoneName.RightHand, x: 14 * DEG, z: -8 * DEG },
    { bone: VRMHumanBoneName.Head, y: 8 * DEG, x: 6 * DEG },
    { bone: VRMHumanBoneName.Neck, x: 4 * DEG },
  ])
  applyOffsetsFromRest(vrm, restMap, peakOffsets)
  vrm.humanoid?.update()
  const ikLocals = captureBoneLocals(vrm, bones)

  const hand = vrm.humanoid?.getNormalizedBoneNode('rightHand')
  const head = vrm.humanoid?.getNormalizedBoneNode('head')
  // Some rigs (e.g. stripped / partial VRM-1.0 samples) have no right-hand or
  // head normalized bone. The reach pose is defined against them, so building a
  // "scratch" clip would be meaningless — and computing world distances off a
  // missing node leaves stale scratch vectors. Skip the clip instead of
  // throwing (a throw here aborts every procedural fallback for the rig).
  if (!hand || !head) {
    vrm.humanoid?.resetNormalizedPose()
    return null
  }
  const target = new THREE.Vector3()
  scratchNoseWorldTarget(vrm, target)
  hand.getWorldPosition(_ccdEnd)
  const ikDist = _ccdEnd.distanceTo(target)
  head.getWorldPosition(_ccdOrig)
  const ikDz = _ccdEnd.z - _ccdOrig.z

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
    assignClipUserData(clip, { ikDist, ikDz })
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
    e.set(be.x ?? 0, be.y ?? 0, (be.z ?? 0) * armFrameZSign(vrm, be.bone))
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
        { bone: VRMHumanBoneName.LeftUpperArm, z: hangL(68) },
        { bone: VRMHumanBoneName.RightUpperArm, z: hangR(68) },
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
        { bone: VRMHumanBoneName.LeftUpperArm, z: hangL(70) },
        { bone: VRMHumanBoneName.RightUpperArm, z: hangR(58) },
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
        { bone: VRMHumanBoneName.LeftUpperArm, z: hangL(58) },
        { bone: VRMHumanBoneName.RightUpperArm, z: hangR(70) },
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

  // --- Mood-pool fallbacks ---------------------------------------------------
  // PRESENCE_MOODS pools reference many ids that a VRMA pack provides. Without a
  // pack (or when the pack is skipped/failed) those ids must still exist or
  // IdlePresenceDirector logs "missing gesture" and the rig stays on the rest
  // loop with nothing lively. These are intentionally approximate, relative to
  // rest, and cheap — real VRMA always wins when the manifest loads.
  //
  // Two flavours: arm/shoulder/hand-only bases (`A`) stay overlays so they layer
  // over the standing idle *or* the sit rest loop without stealing the body;
  // spine-keyed bases replace the rest loop (comfort beats like stretch).

  /** Arms + shoulders + hands at relaxed rest — never keys spine/legs. */
  const A = R.filter((b) => /Shoulder|UpperArm|LowerArm|Hand/.test(b.bone))

  // Subtle standing weight shift. The mood pools name the *logical* id
  // `weight_shift` and IdlePresenceDirector checks the literal id before the
  // controller resolves the variant group (`weight_shift_lean_l/_r`), so a bare
  // `weight_shift` must exist too or the tier silently skips.
  add(
    'weight_shift',
    [0, 0.7, 1.6, 2.4],
    [
      R,
      withBone(R, [
        { bone: VRMHumanBoneName.Hips, z: 2.5 * DEG },
        { bone: VRMHumanBoneName.Spine, z: 2 * DEG },
        { bone: VRMHumanBoneName.Chest, z: 1.5 * DEG },
        { bone: VRMHumanBoneName.LeftUpperArm, z: hangL(68) },
        { bone: VRMHumanBoneName.RightUpperArm, z: hangR(62) },
      ]),
      withBone(R, [
        { bone: VRMHumanBoneName.Hips, z: -2.5 * DEG },
        { bone: VRMHumanBoneName.Spine, z: -2 * DEG },
        { bone: VRMHumanBoneName.Chest, z: -1.5 * DEG },
        { bone: VRMHumanBoneName.LeftUpperArm, z: hangL(62) },
        { bone: VRMHumanBoneName.RightUpperArm, z: hangR(68) },
        { bone: VRMHumanBoneName.Head, y: -3 * DEG },
      ]),
      R,
    ],
    false,
    'Procedural subtle weight shift',
  )
  // Looping seated rest for the long-idle tier. VRM rigs have no floor contact
  // model, so this is a visual "chair sit" — hips set down, knees bent forward,
  // arms resting on the lap. Hip X drives the seat height via reanchor.
  add(
    'sit',
    [0, 1.4, 3.0],
    [
      withBone(R, [
        { bone: VRMHumanBoneName.Hips, x: 62 * DEG },
        { bone: VRMHumanBoneName.Spine, x: 6 * DEG },
        { bone: VRMHumanBoneName.Chest, x: 4 * DEG },
        { bone: VRMHumanBoneName.LeftUpperLeg, x: -82 * DEG },
        { bone: VRMHumanBoneName.RightUpperLeg, x: -82 * DEG },
        { bone: VRMHumanBoneName.LeftLowerLeg, x: 84 * DEG },
        { bone: VRMHumanBoneName.RightLowerLeg, x: 84 * DEG },
        { bone: VRMHumanBoneName.LeftUpperArm, x: 6 * DEG, z: hangL(62) },
        { bone: VRMHumanBoneName.RightUpperArm, x: 6 * DEG, z: hangR(62) },
        { bone: VRMHumanBoneName.LeftLowerArm, y: 20 * DEG },
        { bone: VRMHumanBoneName.RightLowerArm, y: -20 * DEG },
      ]),
      withBone(R, [
        { bone: VRMHumanBoneName.Hips, x: 62 * DEG },
        { bone: VRMHumanBoneName.Spine, x: 4 * DEG },
        { bone: VRMHumanBoneName.Chest, x: 2 * DEG },
        { bone: VRMHumanBoneName.LeftUpperLeg, x: -82 * DEG },
        { bone: VRMHumanBoneName.RightUpperLeg, x: -82 * DEG },
        { bone: VRMHumanBoneName.LeftLowerLeg, x: 84 * DEG },
        { bone: VRMHumanBoneName.RightLowerLeg, x: 84 * DEG },
        { bone: VRMHumanBoneName.LeftUpperArm, x: 6 * DEG, z: hangL(62) },
        { bone: VRMHumanBoneName.RightUpperArm, x: 6 * DEG, z: hangR(62) },
        { bone: VRMHumanBoneName.LeftLowerArm, y: 20 * DEG },
        { bone: VRMHumanBoneName.RightLowerArm, y: -20 * DEG },
        { bone: VRMHumanBoneName.Head, x: 3 * DEG, y: 4 * DEG },
      ]),
      withBone(R, [
        { bone: VRMHumanBoneName.Hips, x: 62 * DEG },
        { bone: VRMHumanBoneName.Spine, x: 6 * DEG },
        { bone: VRMHumanBoneName.Chest, x: 4 * DEG },
        { bone: VRMHumanBoneName.LeftUpperLeg, x: -82 * DEG },
        { bone: VRMHumanBoneName.RightUpperLeg, x: -82 * DEG },
        { bone: VRMHumanBoneName.LeftLowerLeg, x: 84 * DEG },
        { bone: VRMHumanBoneName.RightLowerLeg, x: 84 * DEG },
        { bone: VRMHumanBoneName.LeftUpperArm, x: 6 * DEG, z: hangL(62) },
        { bone: VRMHumanBoneName.RightUpperArm, x: 6 * DEG, z: hangR(62) },
        { bone: VRMHumanBoneName.LeftLowerArm, y: 20 * DEG },
        { bone: VRMHumanBoneName.RightLowerArm, y: -20 * DEG },
      ]),
    ],
    true,
    'Procedural seated rest (long idle)',
  )

  // Head-only glances (overlay: never disturb the idle rest loop's body keys).
  add(
    'look_around',
    [0, 0.5, 1.1, 1.7, 2.2],
    [
      H,
      withBone(H, [{ bone: VRMHumanBoneName.Head, y: 22 * DEG }]),
      withBone(H, [
        { bone: VRMHumanBoneName.Head, y: 18 * DEG, x: -4 * DEG },
        { bone: VRMHumanBoneName.Neck, y: 8 * DEG },
      ]),
      withBone(H, [{ bone: VRMHumanBoneName.Head, y: -20 * DEG }]),
      H,
    ],
    false,
    'Procedural glance around (head only)',
  )

  add(
    'look_around_sleepy',
    [0, 0.7, 1.6, 2.4],
    [
      H,
      withBone(H, [
        { bone: VRMHumanBoneName.Head, y: 16 * DEG, z: 8 * DEG, x: 6 * DEG },
        { bone: VRMHumanBoneName.Neck, z: 5 * DEG },
      ]),
      withBone(H, [
        { bone: VRMHumanBoneName.Head, y: -14 * DEG, z: -7 * DEG, x: 5 * DEG },
      ]),
      H,
    ],
    false,
    'Procedural slow sleepy glance (head only)',
  )

  add(
    'look_around_turn',
    [0, 0.6, 1.4, 2.2],
    [
      R,
      withBone(R, [
        { bone: VRMHumanBoneName.Chest, y: 12 * DEG },
        { bone: VRMHumanBoneName.Head, y: 20 * DEG },
      ]),
      withBone(R, [
        { bone: VRMHumanBoneName.Chest, y: -12 * DEG },
        { bone: VRMHumanBoneName.Head, y: -20 * DEG },
      ]),
      R,
    ],
    false,
    'Procedural glance around with a small torso turn',
  )

  // Right hand up to the chin + a small head tilt: "thinking" beat. Raise values
  // verified against a live VRM-1.0 rig (hand reaches ~chin height, not overhead).
  const thinkRaise = withBone(A, [
    { bone: VRMHumanBoneName.RightShoulder, z: 8 * DEG },
    { bone: VRMHumanBoneName.RightUpperArm, x: 0, y: 12 * DEG, z: -80 * DEG },
    { bone: VRMHumanBoneName.RightLowerArm, y: 100 * DEG },
    { bone: VRMHumanBoneName.RightHand, x: 10 * DEG, z: -6 * DEG },
  ])
  add(
    'think',
    [0, 0.5, 1.3, 2.0, 2.6],
    [
      A,
      withBone(thinkRaise, [
        { bone: VRMHumanBoneName.Head, x: 10 * DEG, y: 6 * DEG },
        { bone: VRMHumanBoneName.Neck, x: 4 * DEG },
      ]),
      withBone(thinkRaise, [
        { bone: VRMHumanBoneName.Head, x: 12 * DEG, y: -6 * DEG, z: 5 * DEG },
        { bone: VRMHumanBoneName.Neck, x: 5 * DEG },
      ]),
      withBone(thinkRaise, [
        { bone: VRMHumanBoneName.Head, x: 6 * DEG, y: 4 * DEG },
        { bone: VRMHumanBoneName.Neck, x: 2 * DEG },
      ]),
      A,
    ],
    false,
    'Procedural thinking beat (hand to chin, arm-only overlay)',
  )

  // Hand raised beside the head + side wiggle: a wave (arm-only overlay). Raise
  // values verified on a live VRM-1.0 rig: hand reaches ~head height (~1.59m).
  const waveRaise = withBone(A, [
    { bone: VRMHumanBoneName.RightShoulder, z: 14 * DEG },
    { bone: VRMHumanBoneName.RightUpperArm, x: 5 * DEG, y: 25 * DEG, z: -88 * DEG },
    { bone: VRMHumanBoneName.RightLowerArm, y: 55 * DEG },
  ])
  add(
    'wave',
    [0, 0.16, 0.34, 0.52, 0.7, 0.9],
    [
      A,
      withBone(waveRaise, [
        { bone: VRMHumanBoneName.RightHand, x: 10 * DEG, y: 22 * DEG },
        { bone: VRMHumanBoneName.Head, y: 5 * DEG },
      ]),
      withBone(waveRaise, [{ bone: VRMHumanBoneName.RightHand, x: 10 * DEG, y: -22 * DEG }]),
      withBone(waveRaise, [{ bone: VRMHumanBoneName.RightHand, x: 10 * DEG, y: 22 * DEG }]),
      withBone(waveRaise, [{ bone: VRMHumanBoneName.RightHand, x: 10 * DEG, y: -18 * DEG }]),
      A,
    ],
    false,
    'Procedural wave (right hand raised, arm-only overlay)',
  )

  add(
    'sit_wave',
    [0, 0.18, 0.4, 0.6, 0.82],
    [
      A,
      withBone(waveRaise, [{ bone: VRMHumanBoneName.RightHand, y: 18 * DEG }]),
      withBone(waveRaise, [{ bone: VRMHumanBoneName.RightHand, y: -18 * DEG }]),
      withBone(waveRaise, [{ bone: VRMHumanBoneName.RightHand, y: 16 * DEG }]),
      A,
    ],
    false,
    'Procedural seated wave fidget (arm-only overlay)',
  )

  add(
    'v_sign',
    [0, 0.25, 0.9, 1.4],
    [
      A,
      withBone(waveRaise, [
        { bone: VRMHumanBoneName.RightHand, x: 10 * DEG, y: 8 * DEG },
        { bone: VRMHumanBoneName.Head, y: 4 * DEG },
      ]),
      withBone(waveRaise, [{ bone: VRMHumanBoneName.RightHand, x: 8 * DEG, y: -6 * DEG }]),
      A,
    ],
    false,
    'Procedural V-sign (arm-only overlay)',
  )

  // Peace/V-sign short variant: same raise, hand down sooner.
  add(
    'v_sign_short',
    [0, 0.2, 0.6],
    [
      A,
      withBone(waveRaise, [{ bone: VRMHumanBoneName.RightHand, x: 10 * DEG, y: 6 * DEG }]),
      A,
    ],
    false,
    'Procedural V-sign, short hold (arm-only overlay)',
  )

  const clapIn = withBone(A, [
    { bone: VRMHumanBoneName.LeftUpperArm, x: 34 * DEG, y: 34 * DEG, z: 34 * DEG },
    { bone: VRMHumanBoneName.RightUpperArm, x: 34 * DEG, y: -34 * DEG, z: -34 * DEG },
    { bone: VRMHumanBoneName.LeftLowerArm, y: 58 * DEG },
    { bone: VRMHumanBoneName.RightLowerArm, y: -58 * DEG },
  ])
  const clapOut = withBone(A, [
    { bone: VRMHumanBoneName.LeftUpperArm, x: 30 * DEG, y: 30 * DEG, z: 30 * DEG },
    { bone: VRMHumanBoneName.RightUpperArm, x: 30 * DEG, y: -30 * DEG, z: -30 * DEG },
    { bone: VRMHumanBoneName.LeftLowerArm, y: 44 * DEG },
    { bone: VRMHumanBoneName.RightLowerArm, y: -44 * DEG },
  ])
  add(
    'clap',
    [0, 0.14, 0.3, 0.46, 0.62, 0.8],
    [A, clapIn, clapOut, clapIn, clapOut, A],
    false,
    'Procedural clap (arm-only overlay)',
  )

  // Full-body comfort beats (spine keyed → non-overlay, replaces the rest loop).
  add(
    'stretch',
    [0, 0.6, 1.3, 2.0, 2.5],
    [
      R,
      withBone(R, [
        { bone: VRMHumanBoneName.Spine, x: -4 * DEG },
        { bone: VRMHumanBoneName.LeftUpperArm, x: -55 * DEG, z: 70 * DEG },
        { bone: VRMHumanBoneName.RightUpperArm, x: -55 * DEG, z: -70 * DEG },
        { bone: VRMHumanBoneName.Head, x: -6 * DEG },
      ]),
      withBone(R, [
        { bone: VRMHumanBoneName.Spine, x: -6 * DEG },
        { bone: VRMHumanBoneName.Chest, x: -4 * DEG },
        { bone: VRMHumanBoneName.LeftUpperArm, x: -62 * DEG, y: 6 * DEG, z: 74 * DEG },
        { bone: VRMHumanBoneName.RightUpperArm, x: -62 * DEG, y: -6 * DEG, z: -74 * DEG },
        { bone: VRMHumanBoneName.Head, x: -8 * DEG },
      ]),
      withBone(R, [
        { bone: VRMHumanBoneName.Spine, x: -3 * DEG },
        { bone: VRMHumanBoneName.LeftUpperArm, x: -40 * DEG, z: 66 * DEG },
        { bone: VRMHumanBoneName.RightUpperArm, x: -40 * DEG, z: -66 * DEG },
      ]),
      R,
    ],
    false,
    'Procedural stretch (arms overhead)',
  )

  add(
    'sleepy',
    [0, 0.8, 2.0, 3.0],
    [
      R,
      withBone(R, [
        { bone: VRMHumanBoneName.Spine, x: 5 * DEG },
        { bone: VRMHumanBoneName.Chest, x: 4 * DEG },
        { bone: VRMHumanBoneName.Neck, x: 8 * DEG },
        { bone: VRMHumanBoneName.Head, x: 10 * DEG, z: 6 * DEG },
        { bone: VRMHumanBoneName.LeftUpperArm, z: hangL(58) },
        { bone: VRMHumanBoneName.RightUpperArm, z: hangR(58) },
      ]),
      withBone(R, [
        { bone: VRMHumanBoneName.Spine, x: 6 * DEG },
        { bone: VRMHumanBoneName.Neck, x: 10 * DEG },
        { bone: VRMHumanBoneName.Head, x: 12 * DEG, z: -6 * DEG },
        { bone: VRMHumanBoneName.LeftUpperArm, z: hangL(54) },
        { bone: VRMHumanBoneName.RightUpperArm, z: hangR(54) },
      ]),
      R,
    ],
    true,
    'Procedural sleepy sway (loop)',
  )

  add(
    'sad',
    [0, 0.9, 2.1, 3.0],
    [
      R,
      withBone(R, [
        { bone: VRMHumanBoneName.Spine, x: 6 * DEG },
        { bone: VRMHumanBoneName.Chest, x: 5 * DEG },
        { bone: VRMHumanBoneName.Neck, x: 7 * DEG },
        { bone: VRMHumanBoneName.Head, x: 12 * DEG },
        { bone: VRMHumanBoneName.LeftUpperArm, z: hangL(66) },
        { bone: VRMHumanBoneName.RightUpperArm, z: hangR(66) },
      ]),
      withBone(R, [
        { bone: VRMHumanBoneName.Spine, x: 7 * DEG },
        { bone: VRMHumanBoneName.Chest, x: 6 * DEG },
        { bone: VRMHumanBoneName.Head, x: 14 * DEG, y: 5 * DEG },
        { bone: VRMHumanBoneName.LeftUpperArm, z: hangL(68) },
        { bone: VRMHumanBoneName.RightUpperArm, z: hangR(68) },
      ]),
      R,
    ],
    true,
    'Procedural sad slouch (loop)',
  )

  add(
    'surprised',
    [0, 0.14, 0.4, 0.8, 1.2],
    [
      R,
      withBone(R, [
        { bone: VRMHumanBoneName.Spine, x: -8 * DEG },
        { bone: VRMHumanBoneName.LeftUpperArm, x: -18 * DEG, z: 50 * DEG },
        { bone: VRMHumanBoneName.RightUpperArm, x: -18 * DEG, z: -50 * DEG },
        { bone: VRMHumanBoneName.Head, x: -6 * DEG },
      ]),
      withBone(R, [
        { bone: VRMHumanBoneName.Spine, x: -10 * DEG },
        { bone: VRMHumanBoneName.LeftUpperArm, x: -34 * DEG, z: 44 * DEG },
        { bone: VRMHumanBoneName.RightUpperArm, x: -34 * DEG, z: -44 * DEG },
        { bone: VRMHumanBoneName.Head, x: -8 * DEG, y: 4 * DEG },
      ]),
      withBone(R, [
        { bone: VRMHumanBoneName.Spine, x: -4 * DEG },
        { bone: VRMHumanBoneName.LeftUpperArm, x: -12 * DEG, z: 54 * DEG },
        { bone: VRMHumanBoneName.RightUpperArm, x: -12 * DEG, z: -54 * DEG },
      ]),
      R,
    ],
    false,
    'Procedural startle / surprise',
  )

  // Arms out to the sides, gentle bank: the "airplane" fidget.
  add(
    'airplane',
    [0, 0.9, 2.0, 3.0],
    [
      R,
      withBone(R, [
        { bone: VRMHumanBoneName.Spine, z: 4 * DEG },
        { bone: VRMHumanBoneName.LeftUpperArm, x: 0, z: 8 * DEG },
        { bone: VRMHumanBoneName.RightUpperArm, x: 0, z: -8 * DEG },
        { bone: VRMHumanBoneName.Head, z: 3 * DEG },
      ]),
      withBone(R, [
        { bone: VRMHumanBoneName.Spine, z: -4 * DEG },
        { bone: VRMHumanBoneName.LeftUpperArm, x: 0, z: 8 * DEG },
        { bone: VRMHumanBoneName.RightUpperArm, x: 0, z: -8 * DEG },
        { bone: VRMHumanBoneName.Head, z: -3 * DEG },
      ]),
      R,
    ],
    true,
    'Procedural airplane sway (arms out)',
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
        { bone: VRMHumanBoneName.LeftUpperArm, z: hangL(75), x: 15 * DEG },
        { bone: VRMHumanBoneName.RightUpperArm, z: hangR(75), x: 15 * DEG },
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
    { bone: VRMHumanBoneName.LeftUpperArm, x: 6 * DEG, y: 0, z: hangL(72) },
    { bone: VRMHumanBoneName.RightUpperArm, x: 6 * DEG, y: 0, z: hangR(72) },
    { bone: VRMHumanBoneName.LeftLowerArm, y: 10 * DEG, z: -8 * DEG },
    { bone: VRMHumanBoneName.RightLowerArm, y: -10 * DEG, z: 8 * DEG },
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
    { bone: VRMHumanBoneName.LeftUpperArm, x: 10 * DEG, y: 0, z: hangL(68) },
    { bone: VRMHumanBoneName.RightUpperArm, x: 10 * DEG, y: 0, z: hangR(68) },
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
    { bone: VRMHumanBoneName.LeftUpperArm, x: 4 * DEG, y: 0, z: hangL(74) },
    { bone: VRMHumanBoneName.RightUpperArm, x: 4 * DEG, y: 0, z: hangR(74) },
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
    { bone: VRMHumanBoneName.LeftUpperArm, x: 8 * DEG, y: 0, z: hangL(70) },
    { bone: VRMHumanBoneName.RightUpperArm, x: 8 * DEG, y: 0, z: hangR(70) },
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
    { bone: VRMHumanBoneName.LeftUpperArm, x: -40 * DEG, y: 20 * DEG, z: hangL(50) },
    { bone: VRMHumanBoneName.RightUpperArm, x: -40 * DEG, y: -20 * DEG, z: hangR(50) },
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

  const rollA = withBone(R, [    { bone: VRMHumanBoneName.Hips, z: 35 * DEG, x: -10 * DEG },
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

  // --- Catalog ids the default gesture pack provides but the procedural builder
  //     did not, so the id always resolves and the Gesture tester always lists it
  //     (a pack-less host never shows a dead button). Cheap, relative-to-rest and
  //     deliberately approximate — real VRMA always wins when the pack loads.

  // Mirror of `wave` on the LEFT arm (pack: `wave_left`).
  const waveRaiseL = withBone(A, [
    { bone: VRMHumanBoneName.LeftShoulder, z: -14 * DEG },
    { bone: VRMHumanBoneName.LeftUpperArm, x: 5 * DEG, y: -25 * DEG, z: 88 * DEG },
    { bone: VRMHumanBoneName.LeftLowerArm, y: -55 * DEG },
  ])
  add(
    'wave_left',
    [0, 0.16, 0.34, 0.52, 0.7, 0.9],
    [
      A,
      withBone(waveRaiseL, [
        { bone: VRMHumanBoneName.LeftHand, x: 10 * DEG, y: -22 * DEG },
        { bone: VRMHumanBoneName.Head, y: -5 * DEG },
      ]),
      withBone(waveRaiseL, [{ bone: VRMHumanBoneName.LeftHand, x: 10 * DEG, y: 22 * DEG }]),
      withBone(waveRaiseL, [{ bone: VRMHumanBoneName.LeftHand, x: 10 * DEG, y: -22 * DEG }]),
      withBone(waveRaiseL, [{ bone: VRMHumanBoneName.LeftHand, x: 10 * DEG, y: 18 * DEG }]),
      A,
    ],
    false,
    'Procedural left-hand wave (arm-only overlay)',
  )

  // Both hands up + side wiggle (pack: `wave_both`).
  const waveRaiseBoth = withBone(waveRaise, waveRaiseL)
  add(
    'wave_both',
    [0, 0.2, 0.45, 0.7, 0.98],
    [
      A,
      withBone(waveRaiseBoth, [
        { bone: VRMHumanBoneName.RightHand, x: 10 * DEG, y: 18 * DEG },
        { bone: VRMHumanBoneName.LeftHand, x: 10 * DEG, y: -18 * DEG },
      ]),
      withBone(waveRaiseBoth, [
        { bone: VRMHumanBoneName.RightHand, x: 10 * DEG, y: -18 * DEG },
        { bone: VRMHumanBoneName.LeftHand, x: 10 * DEG, y: 18 * DEG },
      ]),
      withBone(waveRaiseBoth, [
        { bone: VRMHumanBoneName.RightHand, x: 10 * DEG, y: 16 * DEG },
        { bone: VRMHumanBoneName.LeftHand, x: 10 * DEG, y: -16 * DEG },
      ]),
      A,
    ],
    false,
    'Procedural two-handed wave (arm-only overlay)',
  )

  // Gentle speaking sway (pack: `talk`, loop).
  add(
    'talk',
    [0, 1.2, 2.4],
    [
      R,
      withBone(R, [
        { bone: VRMHumanBoneName.Spine, x: 3 * DEG },
        { bone: VRMHumanBoneName.Chest, x: -3 * DEG },
        { bone: VRMHumanBoneName.Head, x: -2 * DEG, y: 3 * DEG },
        { bone: VRMHumanBoneName.LeftUpperArm, z: hangL(66) },
        { bone: VRMHumanBoneName.RightUpperArm, z: hangR(66) },
      ]),
      R,
    ],
    true,
    'Procedural speaking sway (loop)',
  )

  // Sway variant of the weight shift (pack: `weight_shift_sway`).
  add(
    'weight_shift_sway',
    [0, 0.7, 1.6, 2.4],
    [
      R,
      withBone(R, [
        { bone: VRMHumanBoneName.Hips, z: 3 * DEG },
        { bone: VRMHumanBoneName.Spine, z: 3 * DEG },
        { bone: VRMHumanBoneName.Chest, z: 2 * DEG },
        { bone: VRMHumanBoneName.Head, z: -2 * DEG },
        { bone: VRMHumanBoneName.LeftUpperArm, z: hangL(70) },
        { bone: VRMHumanBoneName.RightUpperArm, z: hangR(60) },
      ]),
      withBone(R, [
        { bone: VRMHumanBoneName.Hips, z: -3 * DEG },
        { bone: VRMHumanBoneName.Spine, z: -3 * DEG },
        { bone: VRMHumanBoneName.Chest, z: -2 * DEG },
        { bone: VRMHumanBoneName.Head, z: 2 * DEG },
        { bone: VRMHumanBoneName.LeftUpperArm, z: hangL(60) },
        { bone: VRMHumanBoneName.RightUpperArm, z: hangR(70) },
      ]),
      R,
    ],
    false,
    'Procedural sway weight shift',
  )

  // Standing shift, taller stance (pack: `weight_shift_stand`).
  add(
    'weight_shift_stand',
    [0, 0.6, 1.4, 2.0],
    [
      R,
      withBone(R, [
        { bone: VRMHumanBoneName.Spine, x: -2 * DEG, z: 2 * DEG },
        { bone: VRMHumanBoneName.Hips, z: 2 * DEG },
        { bone: VRMHumanBoneName.Head, x: -2 * DEG, z: -2 * DEG },
        { bone: VRMHumanBoneName.LeftUpperArm, z: hangL(66) },
        { bone: VRMHumanBoneName.RightUpperArm, z: hangR(66) },
      ]),
      withBone(R, [
        { bone: VRMHumanBoneName.Spine, x: -1 * DEG, z: -2 * DEG },
        { bone: VRMHumanBoneName.Hips, z: -2 * DEG },
        { bone: VRMHumanBoneName.Head, x: -1 * DEG, z: 2 * DEG },
      ]),
      R,
    ],
    false,
    'Procedural standing weight shift',
  )

  // Settle into the relaxed stance (pack: `relax_pose`).
  add(
    'relax_pose',
    [0, 0.6, 1.6],
    [
      R,
      withBone(R, [
        { bone: VRMHumanBoneName.Spine, x: 3 * DEG },
        { bone: VRMHumanBoneName.Chest, x: -3 * DEG },
        { bone: VRMHumanBoneName.Head, x: 2 * DEG },
        { bone: VRMHumanBoneName.LeftUpperArm, z: hangL(66) },
        { bone: VRMHumanBoneName.RightUpperArm, z: hangR(66) },
      ]),
      R,
    ],
    false,
    'Procedural relax into stance',
  )

  // Longer stretch, arms overhead (pack: `sport`).
  add(
    'sport',
    [0, 0.7, 1.5, 2.4, 3.2],
    [
      R,
      withBone(R, [
        { bone: VRMHumanBoneName.Spine, x: -4 * DEG },
        { bone: VRMHumanBoneName.LeftUpperArm, x: -55 * DEG, z: 70 * DEG },
        { bone: VRMHumanBoneName.RightUpperArm, x: -55 * DEG, z: -70 * DEG },
        { bone: VRMHumanBoneName.Head, x: -6 * DEG },
      ]),
      withBone(R, [
        { bone: VRMHumanBoneName.Spine, x: -8 * DEG, z: 4 * DEG },
        { bone: VRMHumanBoneName.Chest, x: -5 * DEG },
        { bone: VRMHumanBoneName.LeftUpperArm, x: -64 * DEG, y: 8 * DEG, z: 76 * DEG },
        { bone: VRMHumanBoneName.RightUpperArm, x: -64 * DEG, y: -8 * DEG, z: -76 * DEG },
        { bone: VRMHumanBoneName.Head, x: -10 * DEG },
      ]),
      withBone(R, [
        { bone: VRMHumanBoneName.Spine, x: -4 * DEG, z: -4 * DEG },
        { bone: VRMHumanBoneName.LeftUpperArm, x: -55 * DEG, z: 70 * DEG },
        { bone: VRMHumanBoneName.RightUpperArm, x: -55 * DEG, z: -70 * DEG },
      ]),
      R,
    ],
    false,
    'Procedural sport / long stretch (arms overhead)',
  )

  // Rise from the seated rest to standing (pack: `stand_up`).
  const sitFrame = withBone(R, [
    { bone: VRMHumanBoneName.Hips, x: 62 * DEG },
    { bone: VRMHumanBoneName.LeftUpperLeg, x: -82 * DEG },
    { bone: VRMHumanBoneName.RightUpperLeg, x: -82 * DEG },
    { bone: VRMHumanBoneName.LeftLowerLeg, x: 84 * DEG },
    { bone: VRMHumanBoneName.RightLowerLeg, x: 84 * DEG },
  ])
  add(
    'stand_up',
    [0, 0.5, 1.2],
    [
      sitFrame,
      withBone(R, [
        { bone: VRMHumanBoneName.Hips, x: 22 * DEG },
        { bone: VRMHumanBoneName.Spine, x: 10 * DEG },
        { bone: VRMHumanBoneName.LeftUpperLeg, x: -40 * DEG },
        { bone: VRMHumanBoneName.RightUpperLeg, x: -40 * DEG },
        { bone: VRMHumanBoneName.LeftLowerLeg, x: 44 * DEG },
        { bone: VRMHumanBoneName.RightLowerLeg, x: 44 * DEG },
        { bone: VRMHumanBoneName.Head, x: 4 * DEG },
      ]),
      R,
    ],
    false,
    'Procedural stand up from sit',
  )

  // Tense, forward stance (pack: `angry`).
  add(
    'angry',
    [0, 0.4, 1.0, 1.6],
    [
      R,
      withBone(R, [
        { bone: VRMHumanBoneName.Spine, x: 6 * DEG },
        { bone: VRMHumanBoneName.Chest, x: 5 * DEG },
        { bone: VRMHumanBoneName.Head, x: -5 * DEG },
        { bone: VRMHumanBoneName.LeftUpperArm, x: 4 * DEG, z: hangL(58) },
        { bone: VRMHumanBoneName.RightUpperArm, x: 4 * DEG, z: hangR(58) },
        { bone: VRMHumanBoneName.LeftLowerArm, y: 34 * DEG },
        { bone: VRMHumanBoneName.RightLowerArm, y: -34 * DEG },
      ]),
      withBone(R, [
        { bone: VRMHumanBoneName.Spine, x: 8 * DEG },
        { bone: VRMHumanBoneName.Chest, x: 6 * DEG },
        { bone: VRMHumanBoneName.Head, x: -7 * DEG, z: 3 * DEG },
        { bone: VRMHumanBoneName.LeftUpperArm, z: hangL(56) },
        { bone: VRMHumanBoneName.RightUpperArm, z: hangR(56) },
        { bone: VRMHumanBoneName.LeftLowerArm, y: 38 * DEG },
        { bone: VRMHumanBoneName.RightLowerArm, y: -38 * DEG },
      ]),
      R,
    ],
    false,
    'Procedural tense stance (angry)',
  )

  // Bashful: head down, hands drawn up toward the face (pack: `blush`). Arm-only
  // base (overlay) so it never steals the standing loop's body keys.
  const blushRaise = withBone(A, [
    { bone: VRMHumanBoneName.RightShoulder, z: 6 * DEG },
    { bone: VRMHumanBoneName.LeftShoulder, z: -6 * DEG },
    { bone: VRMHumanBoneName.RightUpperArm, x: 2 * DEG, y: 10 * DEG, z: -46 * DEG },
    { bone: VRMHumanBoneName.LeftUpperArm, x: 2 * DEG, y: -10 * DEG, z: 46 * DEG },
    { bone: VRMHumanBoneName.RightLowerArm, y: 54 * DEG },
    { bone: VRMHumanBoneName.LeftLowerArm, y: -54 * DEG },
  ])
  add(
    'blush',
    [0, 0.5, 1.2, 1.8],
    [
      A,
      withBone(blushRaise, [
        { bone: VRMHumanBoneName.Head, x: 12 * DEG, z: 4 * DEG },
        { bone: VRMHumanBoneName.Neck, x: 5 * DEG },
      ]),
      withBone(blushRaise, [
        { bone: VRMHumanBoneName.Head, x: 10 * DEG, z: -4 * DEG },
        { bone: VRMHumanBoneName.Neck, x: 4 * DEG },
      ]),
      A,
    ],
    false,
    'Procedural bashful beat (head down, hands up — arm-only overlay)',
  )

  // The `orbit` gesture: the torso traces a slow circle (lean left → forward →
  // right → back) with the arms hanging near rest. A **body** motion (keys hips/
  // spine) that is deliberately NOT a wave: the arms stay at the idle hang, so a
  // request never lifts a hand or breaks the elbow. (The default gesture pack
  // ships no `orbit` clip, so this fallback is what the id resolves to.)
  add(
    'orbit',
    [0, 0.6, 1.2, 1.8, 2.4, 3.0],
    [
      R,
      withBone(R, [
        { bone: VRMHumanBoneName.Hips, z: 8 * DEG },
        { bone: VRMHumanBoneName.Spine, z: 6 * DEG },
        { bone: VRMHumanBoneName.Chest, z: 3 * DEG },
        { bone: VRMHumanBoneName.Head, z: -4 * DEG },
        { bone: VRMHumanBoneName.LeftUpperArm, z: hangL(70) },
        { bone: VRMHumanBoneName.RightUpperArm, z: hangR(60) },
      ]),
      withBone(R, [
        { bone: VRMHumanBoneName.Hips, x: 8 * DEG },
        { bone: VRMHumanBoneName.Spine, x: 6 * DEG },
        { bone: VRMHumanBoneName.Chest, x: 3 * DEG },
        { bone: VRMHumanBoneName.Head, x: -3 * DEG },
      ]),
      withBone(R, [
        { bone: VRMHumanBoneName.Hips, z: -8 * DEG },
        { bone: VRMHumanBoneName.Spine, z: -6 * DEG },
        { bone: VRMHumanBoneName.Chest, z: -3 * DEG },
        { bone: VRMHumanBoneName.Head, z: 4 * DEG },
        { bone: VRMHumanBoneName.LeftUpperArm, z: hangL(60) },
        { bone: VRMHumanBoneName.RightUpperArm, z: hangR(70) },
      ]),
      withBone(R, [
        { bone: VRMHumanBoneName.Hips, x: -6 * DEG },
        { bone: VRMHumanBoneName.Spine, x: -4 * DEG },
        { bone: VRMHumanBoneName.Chest, x: -2 * DEG },
        { bone: VRMHumanBoneName.Head, x: 4 * DEG },
      ]),
      R,
    ],
    false,
    'Procedural orbit — torso traces a slow circle (body; arms stay at hang)',
  )

  return out
}

/** @deprecated absolute euler rest — use applyRelaxedRestPose */
export function relaxedFrame(): BoneEuler[] {
  return relaxedOffsets()
}
