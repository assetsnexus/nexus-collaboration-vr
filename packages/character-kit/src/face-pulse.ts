/** Slow idle rest-face LFO. Centered on mood intensity; peaks are flattened. */

export const FACE_PULSE_FADE_MS = 1600
export const FACE_PULSE_SETTLE_MS = 900

export interface MoodFacePulseState {
  phase: number
  /** rad/s */
  omega: number
  amp: number
  retuneIn: number
}

export function createMoodFacePulse(rng: () => number = Math.random): MoodFacePulseState {
  const state: MoodFacePulseState = {
    phase: rng() * Math.PI * 2,
    omega: 0,
    amp: 0,
    retuneIn: 0,
  }
  retuneMoodFacePulse(state, 0.35, rng)
  return state
}

export function retuneMoodFacePulse(
  state: MoodFacePulseState,
  restIntensity: number,
  rng: () => number = Math.random,
): void {
  const period = 5 + rng() * 5
  state.omega = (Math.PI * 2) / period
  const rest = clamp01(restIntensity)
  state.amp = 0.08 + rng() * 0.1 + rest * 0.15
  state.phase += (rng() - 0.5) * 0.8
  state.retuneIn = 6 + rng() * 8
}

/**
 * Advance the pulse and return the rest-emotion target weight.
 * Usually near `restIntensity`, slowly up and back; never a hard 0/1.
 */
export function stepMoodFacePulse(
  state: MoodFacePulseState,
  dt: number,
  restIntensity: number,
  rng: () => number = Math.random,
): number {
  const rest = clamp01(restIntensity)
  const step = Math.min(0.08, Math.max(0, dt))
  state.retuneIn -= step
  if (state.retuneIn <= 0) retuneMoodFacePulse(state, rest, rng)
  state.phase += state.omega * step
  const wave = Math.sin(state.phase)
  const shaped = Math.sign(wave) * Math.pow(Math.abs(wave), 1.35)
  const lo = Math.max(0.06, rest * 0.5)
  const hi = Math.min(0.92, rest + Math.max(0.1, state.amp * 1.1))
  return clamp(rest + state.amp * shaped, lo, hi)
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.35
  return Math.min(1, Math.max(0, n))
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}
