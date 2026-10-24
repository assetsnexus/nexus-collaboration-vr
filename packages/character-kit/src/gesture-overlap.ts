import { GESTURE_VARIANT_GROUPS } from './gesture-variants.ts'
import type { CharacterActionSource } from './action-feed.js'
import { resolveBoneToken } from './bone-names.ts'

/**
 * Bones that make a clip own the stance: keying any of them means the clip
 * replaces the body instead of stacking as a head/arm overlay. The spine/chest
 * chain counts because a torso gesture (turn, stretch, startle) is a body
 * performance, not a mask — and the procedural builder classifies with the same
 * set, so the effective routing matches the catalog's declared layer.
 */
export const STANCE_BONE_TOKENS: ReadonlySet<string> = new Set([
  'hips',
  'spine',
  'chest',
  'upperchest',
  'leftupperleg',
  'rightupperleg',
  'leftlowerleg',
  'rightlowerleg',
])

/** True when `tokens` (canonical bone tokens) include a stance-owning bone. */
export function keysStanceBones(tokens: readonly string[]): boolean {
  return tokens.some((token) => STANCE_BONE_TOKENS.has(token))
}

/** Mixer outcome when a gesture is requested while others are already playing. */
export type GestureOverlapKind = 'play' | 'merge' | 'skip' | 'queue'

export type GesturePlayResult = 'played' | 'merged' | 'queued' | 'skipped'

export const MAX_GESTURE_QUEUE = 4

export interface GestureOccupancyClip {
  tracks: Array<{ name: string }>
}

export interface PlayingGestureSpec {
  id: string
  source: CharacterActionSource
  overlay: boolean
  occupied: string[]
  loop?: boolean
}

/**
 * Canonical comparison token for a track target. Maps VRMA `Normalized_Head`,
 * procedural `head` and VRoid `Normalized_J_Bip_C_Head` onto the same token so
 * overlay/body classification and occupancy agree across clip sources.
 */
export function normalizeTrackTarget(trackName: string): string {
  return resolveBoneToken(trackName)
}

export function trackOccupancy(clip: GestureOccupancyClip): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const track of clip.tracks) {
    // Stance is rotation. Hips.position holds are rest anchors, not a body clip.
    if (!/\.(quaternion|rotation)$/i.test(track.name)) continue
    const name = normalizeTrackTarget(track.name)
    if (!name || seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  return out
}

export function occupancyConflicts(a: readonly string[], b: readonly string[]): boolean {
  if (!a.length || !b.length) return false
  const set = new Set(a)
  return b.some((name) => set.has(name))
}

export function clipIsOverlay(occupied: readonly string[]): boolean {
  return !keysStanceBones(occupied)
}

export function logicalGestureId(id: string): string {
  const trimmed = id.trim()
  if (!trimmed) return trimmed
  for (const [logical, group] of Object.entries(GESTURE_VARIANT_GROUPS)) {
    if (logical === trimmed || group.includes(trimmed)) return logical
  }
  return trimmed
}

export function sameLogicalMotion(a: string, b: string): boolean {
  return logicalGestureId(a) === logicalGestureId(b)
}

export function shouldDropQueued(
  incomingId: string,
  queued: ReadonlyArray<{ id: string }>,
): boolean {
  return queued.some((item) => sameLogicalMotion(item.id, incomingId))
}

/**
 * Never interrupt. Merge non-overlapping overlays; skip same motion or same
 * source when they cannot stack; otherwise FIFO-queue. Looping clips cannot
 * be chained after, so those skip instead of queue forever.
 */
export function decideGestureOverlap(
  incoming: PlayingGestureSpec,
  playing: readonly PlayingGestureSpec[],
): GestureOverlapKind {
  const active = playing.filter((p) => p.id !== 'idle' && p.id !== 'sit')
  if (!active.length) return 'play'
  if (active.some((p) => sameLogicalMotion(p.id, incoming.id))) return 'skip'
  const disjoint = active.every((p) => !occupancyConflicts(p.occupied, incoming.occupied))
  if (disjoint && (incoming.overlay || active.every((p) => p.overlay))) return 'merge'
  if (active.some((p) => p.source === incoming.source)) return 'skip'
  if (active.some((p) => p.loop)) return 'skip'
  return 'queue'
}
