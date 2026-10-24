/**
 * Cross-convention VRM humanoid bone-name resolution — the single mapping.
 *
 * The same bone is named differently by each layer:
 *
 * - the rig reports the canonical VRM enum name (`leftUpperArm`) because that is
 *   what `VRMHumanBoneName` / `humanoid.getNormalizedBoneNode` speak;
 * - a VRoid-authored node is `J_Bip_L_UpperArm` (and its normalized bone is
 *   `Normalized_J_Bip_L_UpperArm`);
 * - a VRMA / retargeted clip track is `Normalized_LeftUpperArm` (or, for a
 *   retargeted rig, `Normalized_<node.name>`);
 * - the procedural fallbacks build tracks straight from `<node.name>`.
 *
 * Every consumer (the rig-compatibility guard, the overlay/body classifier, and
 * the rest-return bookkeeping) must agree on **one** token or the whole gesture
 * pipeline misbehaves: a full-body clip that keys `Normalized_J_Bip_C_Hips`
 * looks like an overlay because `FULL_BODY_TARGET` never matches `jbipchips`,
 * and — worse — the rig guard compares `jbipcspine` against the rig's canonical
 * `spine`, reports 0% coverage, and refuses to play every clip with 3+ bones.
 *
 * This module is deliberately free of Three.js so the guard stays unit-testable.
 * {@link CANONICAL_BONES} is cross-checked against `VRMHumanBoneName` in the
 * tests so the two lists cannot drift.
 */

/**
 * Canonical VRM humanoid bone names. Mirrors `VRMHumanBoneName` from
 * `@pixiv/three-vrm`; verified against it in `bone-names.test.ts`.
 */
export const CANONICAL_BONES = [
  // core
  'hips',
  'spine',
  'chest',
  'upperChest',
  'neck',
  'head',
  // face
  'jaw',
  // eyes
  'leftEye',
  'rightEye',
  // arms
  'leftShoulder',
  'leftUpperArm',
  'leftLowerArm',
  'leftHand',
  'rightShoulder',
  'rightUpperArm',
  'rightLowerArm',
  'rightHand',
  // legs
  'leftUpperLeg',
  'leftLowerLeg',
  'leftFoot',
  'leftToes',
  'rightUpperLeg',
  'rightLowerLeg',
  'rightFoot',
  'rightToes',
  // left fingers
  'leftThumbMetacarpal',
  'leftThumbProximal',
  'leftThumbDistal',
  'leftIndexProximal',
  'leftIndexIntermediate',
  'leftIndexDistal',
  'leftMiddleProximal',
  'leftMiddleIntermediate',
  'leftMiddleDistal',
  'leftRingProximal',
  'leftRingIntermediate',
  'leftRingDistal',
  'leftLittleProximal',
  'leftLittleIntermediate',
  'leftLittleDistal',
  // right fingers
  'rightThumbMetacarpal',
  'rightThumbProximal',
  'rightThumbDistal',
  'rightIndexProximal',
  'rightIndexIntermediate',
  'rightIndexDistal',
  'rightMiddleProximal',
  'rightMiddleIntermediate',
  'rightMiddleDistal',
  'rightRingProximal',
  'rightRingIntermediate',
  'rightRingDistal',
  'rightLittleProximal',
  'rightLittleIntermediate',
  'rightLittleDistal',
] as const

/** Sanitize a bone name into the comparison token used across the pipeline. */
export function boneToken(name: string): string {
  return name.replace(/[^a-z0-9]/gi, '').toLowerCase()
}

const TOKEN_TO_BONE = new Map<string, string>()
for (const bone of CANONICAL_BONES) TOKEN_TO_BONE.set(boneToken(bone), bone)

/** True when `name` resolves to a known canonical VRM humanoid bone. */
export function isCanonicalBone(name: string): boolean {
  return resolveBoneName(name) != null
}

/** VRoid `J_Bip_C_*` → canonical center bone. */
const VROID_CENTER: Record<string, string> = {
  Hips: 'hips',
  Spine: 'spine',
  Chest: 'chest',
  UpperChest: 'upperChest',
  Neck: 'neck',
  Head: 'head',
}

/** VRoid `J_Bip_<side>_*` → canonical limb part (side is prepended separately). */
const VROID_LIMB: Record<string, string> = {
  Shoulder: 'Shoulder',
  UpperArm: 'UpperArm',
  LowerArm: 'LowerArm',
  Hand: 'Hand',
  UpperLeg: 'UpperLeg',
  LowerLeg: 'LowerLeg',
  Foot: 'Foot',
  ToeBase: 'Toes',
  Thumb1: 'ThumbMetacarpal',
  Thumb2: 'ThumbProximal',
  Thumb3: 'ThumbDistal',
  Index1: 'IndexProximal',
  Index2: 'IndexIntermediate',
  Index3: 'IndexDistal',
  Middle1: 'MiddleProximal',
  Middle2: 'MiddleIntermediate',
  Middle3: 'MiddleDistal',
  Ring1: 'RingProximal',
  Ring2: 'RingIntermediate',
  Ring3: 'RingDistal',
  Little1: 'LittleProximal',
  Little2: 'LittleIntermediate',
  Little3: 'LittleDistal',
}

const VROID_SIDE: Record<string, string> = { L: 'left', R: 'right', C: '' }

const CENTER_BY_KEY = new Map(
  Object.entries(VROID_CENTER).map(([key, value]) => [key.toLowerCase(), value]),
)
const LIMB_BY_KEY = new Map(
  Object.entries(VROID_LIMB).map(([key, value]) => [key.toLowerCase(), value]),
)

function parseVroidBone(leaf: string): string | null {
  const match = /^j_(bip|adj)_([clr])_(.+)$/i.exec(leaf)
  if (!match) return null
  const [, kind, side, partRaw] = match
  const sideKey = side.toUpperCase()
  if (!(sideKey in VROID_SIDE)) return null
  const sideName = VROID_SIDE[sideKey]!
  const partKey = partRaw.replace(/[^a-z0-9]/gi, '').toLowerCase()
  if (kind.toLowerCase() === 'adj') {
    // J_Adj_L_FaceEye → leftEye
    return partKey === 'faceeye' && sideName ? `${sideName}Eye` : null
  }
  if (!sideName) {
    const center = CENTER_BY_KEY.get(partKey)
    return center ?? null
  }
  const part = LIMB_BY_KEY.get(partKey)
  if (!part) return null
  return `${sideName}${part}`
}

/** Last path/namespace segment of a track or node name, without its property suffix. */
export function trackNodeName(trackName: string): string {
  const noExt = trackName.replace(/\.[^.]+$/, '')
  const leaf = noExt.split(/[/|]/).pop() ?? noExt
  return leaf.trim()
}

/**
 * Resolve any known bone spelling to the canonical VRM bone name, or `null`.
 *
 * Handles canonical (`Head`), VRMA (`Normalized_Head`), VRoid
 * (`J_Bip_L_UpperArm`, `Normalized_J_Bip_C_Head`, `J_Adj_R_FaceEye`) and common
 * third-party prefixes (`mixamorig:Head`, `Armature|Hips`).
 */
export function resolveBoneName(raw: string): string | null {
  const leaf = trackNodeName(raw)
  if (!leaf) return null
  const stripped = leaf.replace(/^normalized_/i, '')
  // 1) Already canonical (VRMA `Normalized_Head`, procedural `head`).
  const direct = TOKEN_TO_BONE.get(boneToken(stripped))
  if (direct) return direct
  // 2) VRoid node ids.
  const vroid = parseVroidBone(stripped)
  if (vroid) return vroid
  // 3) Namespaced third-party names (`mixamorig:Head`).
  const tail = stripped.split(/[:\-]/).pop() ?? stripped
  return TOKEN_TO_BONE.get(boneToken(tail)) ?? null
}

/**
 * Canonical comparison token for a bone/track name. Unlike {@link resolveBoneName}
 * this never returns `null`: an unrecognized bone falls back to its sanitized
 * leaf so foreign props and helper bones still occupy a stable slot.
 */
export function resolveBoneToken(raw: string): string {
  const resolved = resolveBoneName(raw)
  if (resolved) return boneToken(resolved)
  return boneToken(trackNodeName(raw).replace(/^normalized_/i, ''))
}

const BONE_TO_VROID = new Map<string, string>()
for (const [part, bone] of Object.entries(VROID_CENTER)) {
  BONE_TO_VROID.set(boneToken(bone), `J_Bip_C_${part}`)
}
BONE_TO_VROID.set('lefteye', 'J_Adj_L_FaceEye')
BONE_TO_VROID.set('righteye', 'J_Adj_R_FaceEye')
for (const [part, mapped] of Object.entries(VROID_LIMB)) {
  BONE_TO_VROID.set(boneToken(`left${mapped}`), `J_Bip_L_${part}`)
  BONE_TO_VROID.set(boneToken(`right${mapped}`), `J_Bip_R_${part}`)
}

/**
 * VRoid node name for a canonical bone (`leftUpperArm` → `J_Bip_L_UpperArm`).
 * Exported so tests can round-trip the full table, and so callers can map a
 * normalized rig back onto the VRoid convention.
 */
export function vroidBoneNodeName(bone: string): string | null {
  return BONE_TO_VROID.get(boneToken(bone)) ?? null
}
