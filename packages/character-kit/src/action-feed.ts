import { resolveSequenceOp, type SequenceStep } from './sequence.js'
import { resolveCharacterToolName } from './tools.js'

export const ACTION_FEED_MAX = 120

/**
 * Who/what triggered the motion.
 * Legacy: tool/tag ≈ agent, auto ≈ routine.
 */
export type CharacterActionSource =
  | 'agent'
  | 'routine'
  | 'user'
  | 'tool'
  | 'tag'
  | 'auto'
  | 'cancel'

/** Lifecycle of a tracked motion / wait / cancel row. */
export type CharacterActionStatus =
  | 'pending'
  | 'playing'
  | 'done'
  | 'canceled'
  | 'discarded'

export interface CharacterActionEvent {
  id: number
  at: number
  /** Milliseconds since the previous recorded action (0 for the first). */
  dtMs: number
  /** Short verb: gesture, emotion, mood, look, wait, clothes, face, cancel, orbit… */
  op: string
  /** Compact payload, e.g. `nod · loop` */
  label: string
  source: CharacterActionSource
  /** Extra source hint: click, zoom, orbit, walk, config, status, micro, annotation… */
  detail?: string
  status: CharacterActionStatus
  /** Tool-call / sequence chain id — UI groups rows with the same id. */
  groupId?: number
  /** True when this event patches an existing id (status / label update). */
  update?: boolean
  /** Occupant / agent slug when more than one avatar shares the feed. */
  agent?: string
  /** Scene object id or @participant the motion is aimed at. */
  target?: string
  /** One-shot clip / wait length. Omitted for looping or untimed ops. */
  durationMs?: number
  /** Wall clock when the row left playing (done / canceled / discarded). */
  endedAt?: number
}

export function actionEventKey(ev: Pick<CharacterActionEvent, 'id' | 'agent'>): string {
  return ev.agent ? `${ev.agent}:${ev.id}` : String(ev.id)
}

export type CharacterActionListener = (ev: CharacterActionEvent) => void

/** Human-readable source column: `agent`, `routine`, `user · zoom`, … */
export function formatActionSource(source: CharacterActionSource, detail?: string): string {
  const base =
    source === 'tool' || source === 'tag' || source === 'agent'
      ? 'agent'
      : source === 'auto' || source === 'routine'
        ? 'routine'
        : source === 'user'
          ? 'user'
          : source === 'cancel'
            ? 'cancel'
            : source
  const d = detail?.trim()
  return d ? `${base} · ${d}` : base
}

export function formatActionStatus(status: CharacterActionStatus): string {
  switch (status) {
    case 'pending':
      return 'pending'
    case 'playing':
      return 'playing'
    case 'done':
      return 'done'
    case 'canceled':
      return 'canceled'
    case 'discarded':
      return 'discarded'
    default:
      return status
  }
}

/** Merge a feed event into a list (newest-first), upserting by id. */
export function upsertActionEvent(
  events: CharacterActionEvent[],
  next: CharacterActionEvent,
  max = ACTION_FEED_MAX,
): CharacterActionEvent[] {
  const key = actionEventKey(next)
  const idx = events.findIndex((e) => actionEventKey(e) === key)
  if (idx >= 0) {
    const merged = { ...events[idx], ...next, update: undefined }
    const copy = events.slice()
    copy[idx] = merged
    return copy
  }
  return [next, ...events].slice(0, max)
}

const SKIP_TOOL_LOG = new Set([
  'character_list_gestures',
  'character_list_expressions',
  'character_list_moods',
  'character_list_clothes',
  'character_run_sequence',
  'character_cancel',
  'scene_list_objects',
  'scene_get_object',
  'scene_overview',
])

export function formatActionDelta(dtMs: number): string {
  if (!Number.isFinite(dtMs) || dtMs < 50) return '+0s'
  if (dtMs < 1000) {
    const s = (dtMs / 1000).toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
    return `+${s}s`
  }
  if (dtMs < 10_000) return `+${(dtMs / 1000).toFixed(1)}s`
  return `+${Math.round(dtMs / 1000)}s`
}

function bits(...parts: Array<string | number | boolean | null | undefined>): string {
  return parts
    .map((p) => {
      if (p === true) return ''
      if (p === false || p === null || p === undefined || p === '') return ''
      return String(p)
    })
    .filter(Boolean)
    .join(' · ')
}

function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0s'
  if (ms < 1000) return `${Math.round(ms)}ms`
  const s = ms / 1000
  if (Number.isInteger(s) || s >= 10) return `${Math.round(s)}s`
  return `${s.toFixed(1)}s`
}

export function summarizeSequenceStep(
  step: SequenceStep,
): { op: string; label: string; detail?: string } | null {
  const op = resolveSequenceOp(String(step.op ?? ''))
  if (!op) return null
  switch (op) {
    case 'play_gesture':
      return {
        op: 'gesture',
        label: bits(
          step.id,
          formatFaceCue(step),
          step.loop ? 'loop' : undefined,
          step.sceneTarget,
        ) || '?',
      }
    case 'set_emotion':
      return {
        op: 'emotion',
        label: bits(
          formatFaceCue(step) || step.emotion || 'neutral',
          step.holdMs ? formatMs(step.holdMs) : undefined,
        ),
      }
    case 'set_expression':
      return {
        op: 'face',
        label: bits(step.name, step.weight !== undefined ? String(step.weight) : undefined),
      }
    case 'set_mood':
      return { op: 'mood', label: String(step.mood ?? step.id ?? '?') }
    case 'set_clothes':
      return {
        op: 'clothes',
        label: bits(
          step.clothesIds?.length ? step.clothesIds.join('+') : step.clothesId ?? step.id,
        ),
      }
    case 'look_at':
      return {
        op: 'look',
        label: typeof step.target === 'string' ? step.target : step.target ? 'xyz' : 'none',
      }
    case 'wait':
      return {
        op: 'wait',
        label: formatMs(Number(step.ms ?? 0)),
        detail: 'annotation',
      }
    case 'walk':
      return {
        op: 'walk',
        label: bits(
          step.walkArgs?.objectId ? String(step.walkArgs.objectId) : undefined,
          step.walkArgs?.forward !== undefined ? `f=${step.walkArgs.forward}` : undefined,
          step.walkArgs?.right !== undefined ? `r=${step.walkArgs.right}` : undefined,
        ) || 'walk',
      }
    case 'turn':
      return { op: 'turn', label: `${step.degrees ?? 0}°` }
    case 'jump':
      return { op: 'jump', label: 'jump' }
    case 'teleport':
      return {
        op: 'teleport',
        label: String(step.objectId ?? step.walkArgs?.objectId ?? 'xyz'),
      }
    case 'approach':
      return {
        op: 'approach',
        label: bits(
          step.sceneTarget ?? step.objectId,
          step.approachFrom,
        ) || 'approach',
      }
    case 'turn_to':
      return { op: 'turn', label: String(step.sceneTarget ?? step.objectId ?? 'target') }
    default:
      return null
  }
}

export function summarizeToolCall(
  name: string,
  args: Record<string, unknown> = {},
): { op: string; label: string; detail?: string } | null {
  const resolved = resolveCharacterToolName(name)
  if (SKIP_TOOL_LOG.has(resolved)) return null
  switch (resolved) {
    case 'character_play_gesture':
      return {
        op: 'gesture',
        label: bits(
          String(args.id ?? '?'),
          args.emotion ? `${args.emotion}=${args.intensity ?? ''}` : undefined,
          args.loop ? 'loop' : undefined,
          formatToolTarget(args),
        ),
      }
    case 'character_set_emotion':
      return {
        op: 'emotion',
        label: bits(
          String(args.emotion ?? args.id ?? 'neutral'),
          args.holdMs ? formatMs(Number(args.holdMs)) : undefined,
        ),
      }
    case 'character_set_expression':
      return {
        op: 'face',
        label: bits(String(args.name ?? '?'), args.weight !== undefined ? String(args.weight) : undefined),
      }
    case 'character_set_mood':
      return { op: 'mood', label: String(args.mood ?? args.id ?? '?') }
    case 'character_set_clothes': {
      const ids = Array.isArray(args.ids) ? args.ids.map(String).join('+') : ''
      return {
        op: 'clothes',
        label: ids || String(args.id ?? args.clothes ?? '?'),
      }
    }
    case 'character_look_at':
      return { op: 'look', label: String(args.target ?? 'camera') }
    case 'character_wait':
      return {
        op: 'wait',
        label: formatMs(Number(args.ms ?? 0)),
        detail: 'annotation',
      }
    case 'character_approach':
      return {
        op: 'approach',
        label: bits(
          formatToolTarget(args) || String(args.objectId ?? '?'),
          args.from != null ? String(args.from) : undefined,
          args.gait != null ? String(args.gait) : undefined,
        ),
      }
    case 'character_turn_to':
      return { op: 'turn', label: formatToolTarget(args) || String(args.objectId ?? args.target ?? '?') }
    case 'scene_move_object':
      return { op: 'move', label: bits(String(args.id ?? '?'), 'smooth') }
    case 'scene_glow_object':
      return {
        op: 'glow',
        label: bits(String(args.id ?? '?'), args.color != null ? String(args.color) : undefined),
      }
    default:
      return { op: resolved.replace(/^character_/, '').replace(/^scene_/, ''), label: bits(JSON.stringify(args)).slice(0, 48) }
  }
}

function formatToolTarget(args: Record<string, unknown>): string | undefined {
  const t = args.target ?? args.objectId ?? args.participant
  if (t == null || t === '') return undefined
  if (typeof t === 'string') return t
  if (typeof t === 'object') {
    const rec = t as Record<string, unknown>
    const id = rec.participant ?? rec.slug ?? rec.objectId ?? rec.id
    if (id != null) return String(id)
  }
  return undefined
}

function formatFaceCue(step: SequenceStep): string | undefined {
  if (step.faces?.length) {
    return step.faces.map((f) => `${f.name}=${Math.round(f.weight * 100)}`).join('+')
  }
  if (!step.emotion) return undefined
  const pct =
    step.intensity === undefined
      ? undefined
      : step.intensity > 1
        ? Math.round(step.intensity)
        : Math.round(step.intensity * 100)
  return pct === undefined ? step.emotion : `${step.emotion}=${pct}`
}
