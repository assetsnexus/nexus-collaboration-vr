import type { LoadedGestureInfo } from './types.ts'

/**
 * The gesture catalog the companion UI exposes — the single source of truth for
 * "which gestures must work".
 *
 * Before this list existed the catalog lived only in the procedural builder and
 * the UI, so a rename/removal (`v_sign_short` → `vsign_short`) silently broke a
 * button: `playGesture` logged "unknown gesture" and the avatar froze. The
 * coverage test (`gesture-catalog.test.ts`) asserts every entry here resolves to
 * a real, loadable clip with the declared layer + duration, so drift fails CI
 * instead of shipping a dead button.
 *
 * `layer`:
 * - `overlay` — additive upper-body mask; must blend over the base loop and
 *   release the bones afterwards.
 * - `body` — drives the whole body; must drive and return to the base pose.
 * - `loop` — continuous; must be cancellable (never leaves the pose stuck).
 */
export interface GestureCatalogEntry {
  id: string
  /** UI grouping: `overlay` | `body` | `loop` (loops are also body clips). */
  layer: 'overlay' | 'body' | 'loop'
  /** Looping clips have no fixed length. */
  loop: boolean
  /** Wall-clock one-shot length in ms (after the per-id timeScale). */
  durationMs: number | null
}

/**
 * Every gesture in the product catalog, in the order the UI groups them.
 * Kept hand-written on purpose: it is the independent expectation the tests
 * check the runtime against.
 */
export const GESTURE_CATALOG: readonly GestureCatalogEntry[] = [
  { id: 'agree', layer: 'overlay', loop: false, durationMs: 1143 },
  { id: 'airplane', layer: 'loop', loop: true, durationMs: null },
  { id: 'clap', layer: 'overlay', loop: false, durationMs: 800 },
  { id: 'crouch_idle', layer: 'loop', loop: true, durationMs: null },
  { id: 'disagree', layer: 'overlay', loop: false, durationMs: 800 },
  { id: 'idle', layer: 'loop', loop: true, durationMs: null },
  { id: 'jump', layer: 'body', loop: false, durationMs: 550 },
  { id: 'look_around', layer: 'overlay', loop: false, durationMs: 2200 },
  { id: 'look_around_sleepy', layer: 'overlay', loop: false, durationMs: 2400 },
  { id: 'look_around_turn', layer: 'body', loop: false, durationMs: 2200 },
  { id: 'nod', layer: 'overlay', loop: false, durationMs: 786 },
  { id: 'nod_soft', layer: 'overlay', loop: false, durationMs: 1000 },
  { id: 'run', layer: 'loop', loop: true, durationMs: null },
  { id: 'sad', layer: 'loop', loop: true, durationMs: null },
  { id: 'scratch_nose', layer: 'overlay', loop: false, durationMs: 1400 },
  { id: 'sit', layer: 'loop', loop: true, durationMs: null },
  { id: 'sit_wave', layer: 'overlay', loop: false, durationMs: 820 },
  { id: 'sleepy', layer: 'loop', loop: true, durationMs: null },
  { id: 'stretch', layer: 'body', loop: false, durationMs: 2500 },
  { id: 'surprised', layer: 'body', loop: false, durationMs: 1200 },
  { id: 'think', layer: 'overlay', loop: false, durationMs: 2600 },
  { id: 'v_sign', layer: 'overlay', loop: false, durationMs: 1400 },
  { id: 'v_sign_short', layer: 'overlay', loop: false, durationMs: 600 },
  { id: 'walk', layer: 'loop', loop: true, durationMs: null },
  { id: 'walk_careful', layer: 'loop', loop: true, durationMs: null },
  { id: 'walk_crawl', layer: 'loop', loop: true, durationMs: null },
  { id: 'walk_crouch', layer: 'loop', loop: true, durationMs: null },
  { id: 'walk_roll', layer: 'loop', loop: true, durationMs: null },
  { id: 'wave', layer: 'overlay', loop: false, durationMs: 900 },
  { id: 'weight_shift', layer: 'body', loop: false, durationMs: 2400 },
  { id: 'weight_shift_lean_l', layer: 'body', loop: false, durationMs: 1800 },
  { id: 'weight_shift_lean_r', layer: 'body', loop: false, durationMs: 1800 },
]

/** The declared layer of a loaded clip, derived from its loop + overlay flags. */
export function catalogLayer(loop: boolean, overlay: boolean): 'overlay' | 'body' | 'loop' {
  if (loop) return 'loop'
  return overlay ? 'overlay' : 'body'
}

/**
 * Check one loaded clip against its catalog expectation. Returns a list of
 * human-readable mismatches (empty when the clip matches).
 */
export function diffCatalogEntry(
  expected: GestureCatalogEntry,
  actual: Pick<LoadedGestureInfo, 'id' | 'loop' | 'overlay' | 'durationMs'>,
): string[] {
  const problems: string[] = []
  if (expected.loop !== actual.loop) {
    problems.push(`loop ${actual.loop} ≠ ${expected.loop}`)
  }
  const layer = catalogLayer(actual.loop, actual.overlay)
  if (layer !== expected.layer) {
    problems.push(`layer ${layer} ≠ ${expected.layer}`)
  }
  if (expected.durationMs !== actual.durationMs) {
    problems.push(`durationMs ${actual.durationMs} ≠ ${expected.durationMs}`)
  }
  return problems
}
