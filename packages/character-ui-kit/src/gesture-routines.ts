/**
 * Gesture / routine configuration for the companion surface.
 *
 * A tolerant, JSON-safe view over the embodiment routine + status-motion config:
 * the agent profile may be partial, hand-edited, or absent, and the UI still
 * needs a complete, valid object to edit. Framework-free (no React, no three).
 *
 * @module gesture-routines
 */
import { PRESENCE_MOODS, type PresenceMoodId } from '@nexus/character-kit/presence-moods'
import {
  DEFAULT_STATUS_MOTIONS,
  STATUS_MOTION_STATES,
  parseStatusMotions,
  serializeStatusMotions,
  type StatusMotionMap,
  type StatusMotionState,
} from './agent-status-gestures.js'

/** One routine step: a compact inline-tag string or a structured step object. */
export type RoutineStep = string | { id?: string; mood?: string; waitMs?: number; text?: string }

export type RoutineName = 'greeting' | 'farewell' | 'onListen' | 'onThink'

export const ROUTINE_NAMES: RoutineName[] = ['greeting', 'farewell', 'onListen', 'onThink']

export type GestureRoutineConfig = {
  routines: Record<RoutineName, RoutineStep[]>
  statusMotions: StatusMotionMap
  /** Ambient mood pools (read-only reference, surfaced for the config UI). */
  moods: Record<PresenceMoodId, { micro: string[]; medium: string[]; long: string[] }>
}

/** The union of every gesture id the ambient moods can fidget with. */
export function moodGesturePool(moodId: PresenceMoodId): string[] {
  const mood = PRESENCE_MOODS[moodId]
  return [...new Set([...mood.microGestures, ...mood.mediumGestures, ...mood.longGestures])]
}

/** Every gesture id referenced anywhere in the ambient + status config. */
export function allConfiguredGestureIds(): string[] {
  const ids = new Set<string>()
  for (const mood of Object.values(PRESENCE_MOODS)) {
    for (const id of [
      ...mood.sitFidgets,
      ...mood.microGestures,
      ...mood.mediumGestures,
      ...mood.longGestures,
    ]) {
      ids.add(id)
    }
  }
  for (const cfg of Object.values(DEFAULT_STATUS_MOTIONS)) {
    for (const id of cfg.gestures) ids.add(id)
  }
  return [...ids].sort()
}

function asStep(value: unknown): RoutineStep | null {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (value && typeof value === 'object') {
    const rec = value as Record<string, unknown>
    const step: { id?: string; mood?: string; waitMs?: number; text?: string } = {}
    if (typeof rec.id === 'string' && rec.id.trim()) step.id = rec.id.trim()
    if (typeof rec.mood === 'string' && rec.mood.trim()) step.mood = rec.mood.trim()
    if (typeof rec.text === 'string' && rec.text.trim()) step.text = rec.text.trim()
    const wait = rec.waitMs ?? rec.wait_ms
    if (typeof wait === 'number' && Number.isFinite(wait) && wait >= 0) step.waitMs = wait
    return Object.keys(step).length ? step : null
  }
  return null
}

function asRoutine(value: unknown): RoutineStep[] {
  if (!Array.isArray(value)) return []
  return value.map(asStep).filter((s): s is RoutineStep => s !== null)
}

/** Defaults mirror the character-kit greeting/thinking ladder when unset. */
export function defaultRoutineConfig(): GestureRoutineConfig {
  return {
    routines: {
      greeting: ['[wave|happy=40]', 'nod'],
      farewell: ['[wave|relaxed=30]'],
      onListen: ['[look_around]'],
      onThink: ['[think|focused=35]'],
    },
    statusMotions: parseStatusMotions(null),
    moods: buildMoodPools(),
  }
}

function buildMoodPools(): GestureRoutineConfig['moods'] {
  const out = {} as GestureRoutineConfig['moods']
  for (const mood of Object.values(PRESENCE_MOODS)) {
    out[mood.id] = {
      micro: [...mood.microGestures],
      medium: [...mood.mediumGestures],
      long: [...mood.longGestures],
    }
  }
  return out
}

/**
 * Parse a partial embodiment / presence settings blob into a complete config.
 * Never throws: malformed fields fall back per-field to the defaults.
 */
export function parseGestureRoutineConfig(
  settings?: Record<string, unknown> | null,
  embodiment?: Record<string, unknown> | null,
): GestureRoutineConfig {
  const defaults = defaultRoutineConfig()
  const rawRoutines =
    (settings?.routines as Record<string, unknown> | undefined) ??
    (embodiment?.routines as Record<string, unknown> | undefined) ??
    null
  const routines = { ...defaults.routines }
  if (rawRoutines && typeof rawRoutines === 'object') {
    for (const name of ROUTINE_NAMES) {
      const parsed = asRoutine(rawRoutines[name])
      if (parsed.length) routines[name] = parsed
    }
  }
  return {
    routines,
    statusMotions: parseStatusMotions(settings),
    moods: defaults.moods,
  }
}

/** Serialize back to the `settings`-shaped object an agent profile accepts. */
export function serializeGestureRoutineConfig(config: GestureRoutineConfig): Record<string, unknown> {
  return {
    routines: { ...config.routines },
    status_motions: serializeStatusMotions(config.statusMotions),
  }
}

/** Update one status-motion state without mutating the input config. */
export function withStatusMotion(
  config: GestureRoutineConfig,
  state: StatusMotionState,
  next: Partial<{ gestures: string[]; intervalMs: number }>,
): GestureRoutineConfig {
  const current = config.statusMotions[state] ?? {
    gestures: [],
    intervalMs: 4500,
  }
  return {
    ...config,
    statusMotions: {
      ...config.statusMotions,
      [state]: {
        gestures: next.gestures ?? current.gestures,
        intervalMs: next.intervalMs ?? current.intervalMs,
      },
    },
  }
}

export { STATUS_MOTION_STATES, type StatusMotionMap, type StatusMotionState }
