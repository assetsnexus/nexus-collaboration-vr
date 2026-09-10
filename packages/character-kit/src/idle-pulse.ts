/** Slow idle-loop timeScale LFO — same “breathe” feel as the rest-face pulse. */

export interface IdleScalePulseState {
  phase: number
  /** rad/s */
  omega: number
  amp: number
  retuneIn: number
}

export function createIdleScalePulse(rng: () => number = Math.random): IdleScalePulseState {
  const state: IdleScalePulseState = {
    phase: rng() * Math.PI * 2,
    omega: 0,
    amp: 0,
    retuneIn: 0,
  }
  retuneIdleScalePulse(state, rng)
  return state
}

export function retuneIdleScalePulse(
  state: IdleScalePulseState,
  rng: () => number = Math.random,
): void {
  const period = 4.2 + rng() * 3.8
  state.omega = (Math.PI * 2) / period
  state.amp = 0.035 + rng() * 0.045
  state.phase += (rng() - 0.5) * 0.6
  state.retuneIn = 7 + rng() * 8
}

/**
 * Advance the pulse and return a timeScale around `center`.
 * Typical swing is about ±4–8%.
 */
export function stepIdleTimeScalePulse(
  state: IdleScalePulseState,
  dt: number,
  center: number,
  rng: () => number = Math.random,
): number {
  const step = Math.min(0.08, Math.max(0, dt))
  state.retuneIn -= step
  if (state.retuneIn <= 0) retuneIdleScalePulse(state, rng)
  state.phase += state.omega * step
  const wave = Math.sin(state.phase)
  const shaped = Math.sign(wave) * Math.pow(Math.abs(wave), 1.35)
  const c = clampCenter(center)
  return c * (1 + state.amp * shaped)
}

function clampCenter(n: number): number {
  if (!Number.isFinite(n)) return 1
  return Math.min(1.45, Math.max(0.5, n))
}
