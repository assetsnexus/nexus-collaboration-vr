/**
 * Agent status → ambient mood + status motion map.
 *
 * Ported from the oc-controller reference project's `lib/agentStatusGestures.ts`.
 * Framework-free so both the React hook and any headless host can use it.
 *
 * @module agent-status-gestures
 */

/** Map Hermes / CLI agent status labels to SceneRoom mood + optional gesture id. */
export type AgentLiveStatus = {
  state: string
  emoji?: string
  label?: string
  authorSlug?: string
}

export type StatusMotionConfig = {
  gestures: string[]
  intervalMs: number
}

export type StatusMotionMap = Record<string, StatusMotionConfig>

const STATUS_EMOJI: Record<string, string> = {
  thinking: '🤔',
  planning: '🧭',
  reading: '📖',
  reasoning: '🧠',
  writing: '✍️',
  running: '⚙️',
  done: '✅',
  cancelled: '⏹️',
}

const STATUS_MOOD: Record<string, string> = {
  thinking: 'focused',
  planning: 'curious',
  reading: 'curious',
  reasoning: 'focused',
  writing: 'focused',
  running: 'focused',
  done: 'neutral',
  cancelled: 'neutral',
}

const STATUS_GESTURE: Record<string, string> = {
  thinking: 'think',
  planning: 'think',
  reading: 'look_around',
  reasoning: 'think',
  writing: 'nod',
  running: 'nod',
  done: 'nod',
}

/** Default clips played while the agent stays in a live status (thinking/writing/…). */
export const DEFAULT_STATUS_MOTIONS: StatusMotionMap = {
  thinking: { gestures: ['think', 'look_around', 'weight_shift'], intervalMs: 5500 },
  planning: { gestures: ['think', 'look_around'], intervalMs: 6000 },
  reading: { gestures: ['look_around'], intervalMs: 6000 },
  reasoning: { gestures: ['think', 'nod'], intervalMs: 5500 },
  writing: { gestures: ['nod', 'think'], intervalMs: 5000 },
  /** Tool-call / generic busy — kept calm; avoid nod spam. */
  running: { gestures: ['weight_shift', 'think'], intervalMs: 6000 },
}

/**
 * Collapse high-churn agent statuses into a stable motion phase.
 * tool_progress often flips running↔planning↔reading every few hundred ms.
 */
export function coalesceAgentStatusPhase(state: string): string {
  const s = (state || '').trim().toLowerCase()
  if (!s) return 'thinking'
  if (s === 'done' || s === 'cancelled') return s
  if (s === 'writing') return 'writing'
  if (s === 'reasoning' || s === 'thinking') return 'thinking'
  // planning / reading / running / tool / unknown busy → one "working" bucket
  if (s === 'planning' || s === 'reading' || s === 'running') return 'running'
  return 'running'
}

export const STATUS_MOTION_STATES = ['thinking', 'writing', 'reasoning', 'running'] as const

export type StatusMotionState = (typeof STATUS_MOTION_STATES)[number]

export const STATUS_MOTION_GESTURE_CHOICES = [
  'think',
  'look_around',
  'nod',
  'nod_soft',
  'weight_shift',
  'stretch',
  'wave',
  'clap',
] as const

const MIN_INTERVAL_MS = 1200
const MAX_INTERVAL_MS = 20000

export function statusEmoji(state: string, fallback?: string): string {
  return STATUS_EMOJI[state] || fallback || '💭'
}

export function statusMood(state: string): string {
  return STATUS_MOOD[coalesceAgentStatusPhase(state)] || STATUS_MOOD[state] || 'focused'
}

export function statusGesture(state: string): string | null {
  return STATUS_GESTURE[coalesceAgentStatusPhase(state)] || STATUS_GESTURE[state] || null
}

export function isLiveAgentState(state: string | undefined | null): boolean {
  return Boolean(state) && state !== 'done' && state !== 'cancelled'
}

export function formatStatusChip(status: AgentLiveStatus): string {
  const emoji = status.emoji || statusEmoji(status.state)
  const label = status.label || status.state
  return `${emoji} ${label}`
}

function clampInterval(ms: number): number {
  if (!Number.isFinite(ms)) return 4500
  return Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, Math.round(ms)))
}

function normalizeGestures(value: unknown, fallback: string[]): string[] {
  const raw = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : typeof value === 'string'
      ? value
          .split(/[,\s]+/)
          .map((item) => item.trim())
          .filter(Boolean)
      : []
  const unique = [...new Set(raw)]
  return unique.length ? unique : fallback
}

export function defaultMotionsForState(state: string): StatusMotionConfig {
  const fallbackGesture = statusGesture(state)
  return (
    DEFAULT_STATUS_MOTIONS[state] || {
      gestures: fallbackGesture ? [fallbackGesture] : [],
      intervalMs: 4500,
    }
  )
}

/** Merge `presence.settings.status_motions` with defaults. */
export function parseStatusMotions(settings?: Record<string, unknown> | null): StatusMotionMap {
  const raw = settings?.status_motions ?? settings?.statusMotions
  const out: StatusMotionMap = {}
  for (const [state, defaults] of Object.entries(DEFAULT_STATUS_MOTIONS)) {
    out[state] = { gestures: [...defaults.gestures], intervalMs: defaults.intervalMs }
  }
  if (!raw || typeof raw !== 'object') return out

  for (const [state, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue
    const rec = value as Record<string, unknown>
    const defaults = defaultMotionsForState(state)
    const intervalRaw = rec.interval_ms ?? rec.intervalMs
    out[state] = {
      gestures: normalizeGestures(rec.gestures, defaults.gestures),
      intervalMs: clampInterval(typeof intervalRaw === 'number' ? intervalRaw : defaults.intervalMs),
    }
  }
  return out
}

export function serializeStatusMotions(motions: StatusMotionMap): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [state, cfg] of Object.entries(motions)) {
    out[state] = { gestures: cfg.gestures, interval_ms: cfg.intervalMs }
  }
  return out
}

export function motionsForState(state: string, motions: StatusMotionMap): StatusMotionConfig {
  return motions[state] || defaultMotionsForState(state)
}

/** Random clip from the pool; avoids repeating the last id when several are configured. */
export function pickStatusGesture(gestures: string[], last?: string | null): string | null {
  const ids = [...new Set(gestures.map((id) => id.trim()).filter(Boolean))]
  if (!ids.length) return null
  if (ids.length === 1) return ids[0]!
  const pool = last ? ids.filter((id) => id !== last) : ids
  const use = pool.length ? pool : ids
  return use[Math.floor(Math.random() * use.length)]!
}
