import * as THREE from 'three'
import { VRMHumanBoneName, type VRM } from '@pixiv/three-vrm'

export interface BoneRestHold {
  bone: string
  trackName: string
  quat: THREE.Quaternion
}

export interface HumanoidRestSource {
  humanoid?: {
    getNormalizedBoneNode: (
      name: string,
    ) => { name: string; quaternion: { clone: () => THREE.Quaternion } } | null | undefined
  } | null
}

/** Same mapping as `normalizeTrackTarget` — keep the two in lockstep. */
function restTrackBone(trackName: string): string {
  const target = trackName.replace(/\.[^.]+$/, '')
  const leaf = target.split('/').pop() ?? target
  return leaf.replace(/^normalized_/i, '').toLowerCase()
}

/** Bind-pose quaternions for every normalized humanoid bone. Capture before clips play. */
export function captureHumanoidRestQuats(vrm: HumanoidRestSource | VRM): BoneRestHold[] {
  const holds: BoneRestHold[] = []
  for (const bone of Object.values(VRMHumanBoneName)) {
    const node = vrm.humanoid?.getNormalizedBoneNode(bone)
    if (!node?.name) continue
    holds.push({
      bone,
      trackName: `${node.name}.quaternion`,
      quat: node.quaternion.clone(),
    })
  }
  return holds
}

export function clipKeyedBones(clip: { tracks: Array<{ name: string }> }): Set<string> {
  const keyed = new Set<string>()
  for (const track of clip.tracks) {
    const name = restTrackBone(track.name)
    if (name) keyed.add(name)
  }
  return keyed
}

/** Gaze multiplies onto these; leftover overlay pose here is a broken neck. */
export const HEAD_REST_BONES = new Set(['head', 'neck', 'chest', 'upperchest', 'spine'])

/**
 * Bones that must slerp to bind after a clip because idle does not key them.
 * Do not include bones idle already owns — RestPoseReturn runs after the mixer
 * and would overwrite idle with bind T-pose (the nod blink).
 */
export function restReturnBones(
  occupied: readonly string[],
  idleClip: { tracks: Array<{ name: string }> } | null | undefined,
): string[] {
  const bones = [...occupancySet(occupied)]
  if (!idleClip) return bones
  const missing = new Set(bonesMissingFromClip(idleClip, bones))
  return bones.filter((bone) => missing.has(bone))
}

export function bonesMissingFromClip(
  clip: { tracks: Array<{ name: string }> },
  occupied: readonly string[],
): string[] {
  const keyed = clipKeyedBones(clip)
  const missing: string[] = []
  const seen = new Set<string>()
  for (const raw of occupied) {
    const bone = restTrackBone(raw)
    if (!bone || keyed.has(bone) || seen.has(bone)) continue
    seen.add(bone)
    missing.push(bone)
  }
  return missing
}

/** Normalize VRMA `Normalized_Head` and procedural `head` into one occupancy set. */
export function occupancySet(names: Iterable<string>): Set<string> {
  const occupied = new Set<string>()
  for (const name of names) {
    const bone = restTrackBone(name)
    if (bone) occupied.add(bone)
  }
  return occupied
}

export function idleTrackIsOccupied(
  trackName: string,
  occupied: ReadonlySet<string>,
): boolean {
  const bone = restTrackBone(trackName)
  return Boolean(bone) && occupied.has(bone)
}

export function filterIdleTracksForOccupancy<T extends { name: string }>(
  tracks: readonly T[],
  occupied: ReadonlySet<string>,
): T[] {
  return tracks.filter((track) => !idleTrackIsOccupied(track.name, occupied))
}

/**
 * Idle VRMA often omits head/neck. Without those tracks the mixer leaves the last
 * overlay quaternion on the bone, and gaze look deltas then break the neck.
 * Constant rest holds let idle own the return.
 */
export function padClipWithRestHolds(
  clip: THREE.AnimationClip,
  holds: readonly BoneRestHold[],
): { clip: THREE.AnimationClip; added: string[] } {
  const keyed = clipKeyedBones(clip)
  const extra: THREE.KeyframeTrack[] = []
  const added: string[] = []
  const duration = Math.max(clip.duration, 1 / 30)
  for (const hold of holds) {
    const bone = restTrackBone(hold.trackName) || hold.bone.toLowerCase()
    if (!bone || keyed.has(bone)) continue
    const q = hold.quat
    extra.push(
      new THREE.QuaternionKeyframeTrack(
        hold.trackName,
        [0, duration],
        [q.x, q.y, q.z, q.w, q.x, q.y, q.z, q.w],
      ),
    )
    added.push(bone)
    keyed.add(bone)
  }
  if (!extra.length) return { clip, added }
  const padded = new THREE.AnimationClip(clip.name, clip.duration, [...clip.tracks, ...extra])
  padded.blendMode = clip.blendMode
  return { clip: padded, added }
}

/** ~10°. VRMA nod/wave files often key every bone at bind; those are not motion. */
export const NEAR_REST_MAX_RAD = 0.18
/** Static hips.position holds (~1cm) are rest anchors, not locomotion. */
export const NEAR_REST_POS_MAX = 0.01

function quaternionValuesNearRest(
  values: ArrayLike<number>,
  rest: THREE.Quaternion,
  maxRad: number,
): boolean {
  const q = new THREE.Quaternion()
  for (let i = 0; i + 3 < values.length; i += 4) {
    q.set(values[i]!, values[i + 1]!, values[i + 2]!, values[i + 3]!).normalize()
    if (q.angleTo(rest) > maxRad) return false
  }
  return values.length >= 4
}

function vectorValuesNearHold(values: ArrayLike<number>, maxDelta: number): boolean {
  if (values.length < 3) return true
  const x0 = values[0]!
  const y0 = values[1]!
  const z0 = values[2]!
  const maxSq = maxDelta * maxDelta
  for (let i = 3; i + 2 < values.length; i += 3) {
    const dx = values[i]! - x0
    const dy = values[i + 1]! - y0
    const dz = values[i + 2]! - z0
    if (dx * dx + dy * dy + dz * dz > maxSq) return false
  }
  return true
}

/**
 * Drop quaternion tracks that never leave bind, and static position holds.
 * A nod VRMA that keys hips/arms at T-pose would otherwise replace idle and
 * flash bind on those bones.
 */
export function omitNearRestTracks(
  clip: THREE.AnimationClip,
  holds: readonly BoneRestHold[],
  maxRad = NEAR_REST_MAX_RAD,
): { clip: THREE.AnimationClip; dropped: string[] } {
  const dropped: string[] = []
  const kept: THREE.KeyframeTrack[] = []
  const identity = new THREE.Quaternion()
  for (const track of clip.tracks) {
    if (/\.position$/i.test(track.name)) {
      if (vectorValuesNearHold(track.values, NEAR_REST_POS_MAX)) {
        dropped.push(restTrackBone(track.name) || track.name)
        continue
      }
      kept.push(track)
      continue
    }
    if (!/\.quaternion$/i.test(track.name)) {
      kept.push(track)
      continue
    }
    const hold = restHoldForBone(holds, track.name)
    const rest = hold?.quat ?? identity
    if (quaternionValuesNearRest(track.values, rest, maxRad)) {
      dropped.push(restTrackBone(track.name) || track.name)
      continue
    }
    kept.push(track)
  }
  if (!dropped.length || !kept.length) return { clip, dropped }
  const next = new THREE.AnimationClip(clip.name, clip.duration, kept)
  next.blendMode = clip.blendMode
  return { clip: next, dropped }
}

export interface RestBlendNode {
  quaternion: THREE.Quaternion
}

export interface RestBlendTarget {
  node: RestBlendNode
  rest: THREE.Quaternion
}

export function restHoldForBone(
  holds: readonly BoneRestHold[],
  occupiedBone: string,
): BoneRestHold | undefined {
  const want = restTrackBone(occupiedBone) || occupiedBone.toLowerCase()
  return holds.find(
    (h) => restTrackBone(h.trackName) === want || h.bone.toLowerCase() === want,
  )
}

/**
 * Slerp occupied humanoid bones back to bind after the mixer.
 * Mixer rest-hold tracks can exist on the clip but bind a different node than
 * `humanoid.getNormalizedBoneNode`, which is what gaze multiplies onto.
 */
export class RestPoseReturn {
  private blends: Array<{
    node: RestBlendNode
    from: THREE.Quaternion
    to: THREE.Quaternion
    t: number
    dur: number
  }> = []

  get active(): boolean {
    return this.blends.length > 0
  }

  begin(targets: readonly RestBlendTarget[], duration: number): void {
    const dur = Math.max(0.05, duration)
    const incoming = new Set(targets.map((target) => target.node))
    this.blends = this.blends.filter((blend) => !incoming.has(blend.node))
    for (const target of targets) {
      this.blends.push({
        node: target.node,
        from: target.node.quaternion.clone(),
        to: target.rest.clone(),
        t: 0,
        dur,
      })
    }
  }

  drop(nodes: Iterable<RestBlendNode>): void {
    const skip = new Set(nodes)
    if (!skip.size) return
    this.blends = this.blends.filter((blend) => !skip.has(blend.node))
  }

  cancel(): void {
    this.blends = []
  }

  /** After mixer, before gaze. Returns true while still blending. */
  update(dt: number): boolean {
    if (!this.blends.length) return false
    const next: typeof this.blends = []
    for (const blend of this.blends) {
      blend.t += Math.max(0, dt)
      const u = Math.min(1, blend.t / blend.dur)
      const s = u * u * (3 - 2 * u)
      blend.node.quaternion.copy(blend.from).slerp(blend.to, s)
      if (u < 1) next.push(blend)
    }
    this.blends = next
    return this.blends.length > 0
  }
}
