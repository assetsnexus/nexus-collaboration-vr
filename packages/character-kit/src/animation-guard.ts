/**
 * Stuck-pose detection + rig-compatibility guards.
 *
 * The mixer is the single owner of the skeleton, so a clip that is never
 * stopped keeps writing bones forever: it blends with idle (a half-seated
 * half-standing body) and no later transition ever clears it. That is the
 * "avatar frozen in a broken pose" symptom.
 *
 * Everything here is pure (plain snapshots in, verdicts out) so the recovery
 * policy is unit-testable without Three.js or a live mixer.
 */

import { resolveBoneToken } from './bone-names.ts'

/** One mixer action, projected to the fields the detector needs. */
export interface GuardActionSnapshot {
  /** Stable identity for logging (`clipName#tracks`). */
  key: string
  clipName: string
  /** Looping clips legitimately never finish. */
  loop: boolean
  /** One-shots that hold their last frame instead of releasing the bones. */
  clampWhenFinished: boolean
  running: boolean
  effectiveWeight: number
  /** Playhead seconds. */
  time: number
  /** Clip length in seconds (0 when unknown). */
  durationSec: number
  /**
   * True when the controller knows why this action is running (idle loop,
   * overlay slot, body slot, walk clip, or a scheduled fade-out). An untracked
   * action with weight is an orphan: nobody will ever stop it.
   */
  tracked: boolean
  /**
   * True when the clip owns the stance (hips/legs) instead of stacking as a
   * head/arm overlay. Two stance clips at full weight can only be a blend, so
   * this is what distinguishes a broken pose from a legitimate overlay stack.
   */
  stance: boolean
  /** True for the action the controller currently considers its rest loop. */
  idle?: boolean
}

export type StuckReason =
  /** Running with weight but not owned by any transition. */
  | 'orphan_action'
  /** A one-shot that outlived its clip and never released the bones. */
  | 'overrun_oneshot'
  /** Mutually-exclusive body clips summing past 100% (a blend, not a pose). */
  | 'weight_sum'

export interface StuckVerdict {
  stuck: boolean
  reasons: StuckReason[]
  /** Action keys to halt before returning to idle. */
  orphans: string[]
  detail: string
}

export interface StuckDetectOptions {
  /**
   * Weight below which a running action is visually irrelevant. Three ramps a
   * fading clip to 0 but keeps it `running` until the fade completes.
   */
  minWeight?: number
  /** Seconds past a one-shot's length before it counts as overrun. */
  overrunGraceSec?: number
  /** Sum of stance-clip weights above which two clips are visibly fighting. */
  maxStanceWeightSum?: number
}

export const GUARD_MIN_WEIGHT = 0.02
export const GUARD_OVERRUN_GRACE_SEC = 1.5
/**
 * Idle rests at weight 1.0, so a single stance clip crossfading in legitimately
 * pushes the stance sum toward ~1.4. Two *full* stance clips (idle + sit, each
 * 1.0) sum past this, which is the "sitting and standing at once" blend. A
 * crossfade never sustains that, and the sample streak in {@link createPoseGuard}
 * filters the transient.
 */
export const GUARD_MAX_STANCE_WEIGHT_SUM = 1.6

/**
 * Classify the current mixer state. `stuck` is true only when the pose cannot
 * recover on its own, so a normal crossfade (a fading clip at weight 0.4) never
 * triggers recovery.
 */
export function detectStuckPose(
  actions: readonly GuardActionSnapshot[],
  opts: StuckDetectOptions = {},
): StuckVerdict {
  const minWeight = opts.minWeight ?? GUARD_MIN_WEIGHT
  const grace = opts.overrunGraceSec ?? GUARD_OVERRUN_GRACE_SEC
  const maxSum = opts.maxStanceWeightSum ?? GUARD_MAX_STANCE_WEIGHT_SUM

  const reasons = new Set<StuckReason>()
  const orphans: string[] = []
  let stanceWeightSum = 0

  for (const action of actions) {
    if (!action.running || action.effectiveWeight <= minWeight) continue
    if (!action.tracked) {
      if (!orphans.includes(action.key)) orphans.push(action.key)
      reasons.add('orphan_action')
    }
    if (!action.loop && action.clampWhenFinished) {
      const duration = action.durationSec
      if (duration > 0 && action.time > duration + grace) {
        reasons.add('overrun_oneshot')
        if (!orphans.includes(action.key)) orphans.push(action.key)
      }
    }
    if (action.stance) stanceWeightSum += action.effectiveWeight
  }

  // Only stance clips conflict: idle (1.0) legitimately stacks with disjoint
  // head/arm overlays, but two stance clips both at 1.0 are blended, not posed.
  if (stanceWeightSum > maxSum) reasons.add('weight_sum')

  const list = [...reasons]
  return {
    stuck: list.length > 0,
    reasons: list,
    orphans,
    detail: list.length
      ? `stuck pose: ${list.join(', ')} (stanceWeightSum=${stanceWeightSum.toFixed(2)}${orphans.length ? `, orphans=${orphans.join('|')}` : ''})`
      : 'ok',
  }
}

/**
 * Which humanoid bones a clip drives, as canonical comparison tokens. Free of
 * Three.js so the rig guard is testable: `trackName` values are the raw track
 * names (`Normalized_Head.quaternion`, `Normalized_J_Bip_L_UpperArm.quaternion`).
 *
 * Both the clip tracks and the rig node names are mapped through
 * {@link resolveBoneToken}, so a VRoid-rigged model (nodes named `J_Bip_*`) and a
 * VRMA clip (`Normalized_*`) land on the same token instead of silently
 * disagreeing on every bone.
 */
export function clipBoneTargets(clip: { tracks: Array<{ name: string }> }): string[] {
  const out = new Set<string>()
  for (const track of clip.tracks) {
    if (!/\.(quaternion|rotation)$/i.test(track.name)) continue
    const bone = resolveBoneToken(track.name)
    if (bone) out.add(bone)
  }
  return [...out]
}

/** Rig bones at or above this share missing means the clip cannot express. */
export const RIG_COMPAT_MIN_COVERAGE = 0.6
/** A clip keying fewer bones than this is a fragment, not a performance. */
export const RIG_COMPAT_MIN_BONES = 3

/**
 * The bones this rig reports, as canonical comparison tokens.
 *
 * `getNode(bone)` answers for a `VRMHumanBoneName` (the rig adapter in the
 * controller) and `nodes`, when supplied, are the raw node names three-vrm
 * exposes (`J_Bip_C_Head`). Both are folded through {@link resolveBoneToken} so a
 * VRoid rig and a VRMA clip are compared in the same space.
 */
export function rigBoneNames(
  getNode: (bone: string) => unknown,
  bones: readonly string[],
  nodes?: Iterable<{ name?: string } | null | undefined>,
): string[] {
  const out = new Set<string>()
  for (const bone of bones) {
    if (!getNode(bone)) continue
    const token = resolveBoneToken(bone)
    if (token) out.add(token)
  }
  if (nodes) {
    for (const node of nodes) {
      if (!node?.name) continue
      const token = resolveBoneToken(node.name)
      if (token) out.add(token)
    }
  }
  return [...out]
}

export interface RigCompatVerdict {
  compatible: boolean
  coverage: number
  missing: string[]
  reason: string
}

/**
 * Guard a gesture/motion against a rig that does not have the bones it keys.
 *
 * A retargeted VRMA (or a fallback sample VRM) may lack whole limbs; playing it
 * anyway leaves the skeleton half-driven (the "contorted T-pose" symptom). An
 * unknown rig (`known` empty) is treated as compatible so this never blocks a
 * model that simply has not reported its bones yet.
 */
export function checkRigCompatibility(
  clip: { tracks: Array<{ name: string }> },
  known: Iterable<string>,
): RigCompatVerdict {
  const targets = clipBoneTargets(clip)
  if (targets.length < RIG_COMPAT_MIN_BONES) {
    return { compatible: true, coverage: 1, missing: [], reason: 'fragment' }
  }
  const rig = new Set<string>()
  for (const bone of known) {
    rig.add(bone.replace(/[^a-z0-9]/gi, '').toLowerCase())
  }
  if (!rig.size) return { compatible: true, coverage: 1, missing: [], reason: 'unknown-rig' }

  const missing = targets.filter((bone) => !rig.has(bone))
  const coverage = (targets.length - missing.length) / targets.length
  if (coverage < RIG_COMPAT_MIN_COVERAGE) {
    return {
      compatible: false,
      coverage,
      missing,
      reason: `rig missing ${missing.length}/${targets.length} bones`,
    }
  }
  return { compatible: true, coverage, missing, reason: 'ok' }
}

export const GUARD_SAMPLE_INTERVAL_MS = 700
/** Consecutive stuck samples before recovering, so a long crossfade is ignored. */
export const GUARD_STUCK_SAMPLES = 3
/** Minimum gap between recoveries, so a pathological loop cannot thrash idle. */
export const GUARD_RECOVER_COOLDOWN_MS = 4_000

/**
 * Decides *when* to sample the mixer and *when* a stuck verdict has persisted
 * long enough to recover. Frame-rate independent and pure, so the recovery
 * cadence is unit-testable without a render loop.
 */
export function createPoseGuard(
  opts: {
    sampleIntervalMs?: number
    stuckSamples?: number
    cooldownMs?: number
  } = {},
) {
  const interval = opts.sampleIntervalMs ?? GUARD_SAMPLE_INTERVAL_MS
  const needed = Math.max(1, opts.stuckSamples ?? GUARD_STUCK_SAMPLES)
  const cooldown = opts.cooldownMs ?? GUARD_RECOVER_COOLDOWN_MS
  let lastSampleAt = -Infinity
  let lastRecoverAt = -Infinity
  let consecutive = 0

  return {
    /**
     * Should the caller build a snapshot this frame? True at most once per
     * interval, and it consumes the slot so the caller can call `observe` next.
     */
    due(nowMs: number): boolean {
      if (nowMs - lastSampleAt < interval) return false
      lastSampleAt = nowMs
      return true
    },
    /**
     * Feed a sample. Returns `true` exactly once per stuck episode, when it has
     * held for `stuckSamples` consecutive samples and the cooldown has elapsed.
     */
    observe(nowMs: number, verdict: StuckVerdict): boolean {
      if (!verdict.stuck) {
        consecutive = 0
        return false
      }
      consecutive += 1
      if (consecutive < needed) return false
      if (nowMs - lastRecoverAt < cooldown) return false
      consecutive = 0
      lastRecoverAt = nowMs
      return true
    },
    reset(): void {
      consecutive = 0
      lastSampleAt = -Infinity
    },
  }
}
