/**
 * Logical gesture ids → concrete clip ids. playGesture resolves randomly
 * among clips that are actually loaded.
 */
export const GESTURE_VARIANT_GROUPS: Record<string, string[]> = {
  weight_shift: [
    'weight_shift',
    'weight_shift_sway',
    'weight_shift_stand',
    'weight_shift_lean_l',
    'weight_shift_lean_r',
  ],
  look_around: ['look_around', 'look_around_turn', 'look_around_sleepy'],
  nod: ['nod', 'nod_soft'],
  wave: ['wave', 'wave_left', 'wave_both'],
  stretch: ['stretch', 'relax_pose', 'sport'],
  /** Long rest — chair sit only. sit_wave is a seated one-shot fidget. */
  sit: ['sit'],
  crouch_idle: ['crouch_idle'],
  walk: ['walk'],
  run: ['run', 'walk'],
  walk_crouch: ['walk_crouch'],
  walk_careful: ['walk_careful', 'walk'],
  walk_crawl: ['walk_crawl'],
  walk_roll: ['walk_roll'],
}

/** Pick a random loaded variant for a logical id (or the id itself). */
export function resolveGestureVariant(
  id: string,
  available: Iterable<string>,
  opts: { preferExact?: boolean } = {},
): string {
  const have = new Set(available)
  const group = GESTURE_VARIANT_GROUPS[id]
  if (!group) return have.has(id) ? id : id

  const loaded = group.filter((g) => have.has(g))
  if (!loaded.length) return id
  if (opts.preferExact && have.has(id) && Math.random() < 0.35) return id
  return loaded[Math.floor(Math.random() * loaded.length)]!
}

export function listLogicalGestureIds(): string[] {
  return Object.keys(GESTURE_VARIANT_GROUPS)
}

/** Default mixer timeScale for a resolved clip id. Nods play slower than 1×. */
export const DEFAULT_NOD_TIME_SCALE = 0.7

const NOD_TIME_SCALE_IDS = new Set(['nod', 'nod_soft', 'agree'])

export function defaultGestureTimeScale(id: string): number {
  return NOD_TIME_SCALE_IDS.has(id) ? DEFAULT_NOD_TIME_SCALE : 1
}

/**
 * Wall-clock length of a one-shot clip. Looping clips have no fixed length.
 */
export function clipPlaybackDurationMs(
  durationSec: number,
  opts: { loop?: boolean; timeScale?: number } = {},
): number | null {
  if (opts.loop) return null
  if (!Number.isFinite(durationSec) || durationSec <= 0) return null
  const scale =
    opts.timeScale !== undefined && Number.isFinite(opts.timeScale) && opts.timeScale > 0
      ? opts.timeScale
      : 1
  return Math.max(1, Math.round((durationSec / scale) * 1000))
}

/** Compact length for catalogs: `loop`, `—`, `450ms`, `1.2s`. */
export function formatClipDuration(durationMs: number | null, loop = false): string {
  if (loop) return 'loop'
  if (durationMs == null || !Number.isFinite(durationMs) || durationMs <= 0) return '—'
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`
  const s = durationMs / 1000
  if (s >= 10) return `${Math.round(s)}s`
  const text = s.toFixed(s >= 2 ? 1 : 2).replace(/0+$/, '').replace(/\.$/, '')
  return `${text}s`
}
