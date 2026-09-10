/** Scene object or @participant reference used by gestures / approach / turn-to. */

export type SceneRefKind = 'object' | 'participant'

export interface SceneRef {
  kind: SceneRefKind
  id: string
}

const PARTICIPANT_PREFIX = /^(?:@|participant:|agent:|avatar:)/i

export function normalizeParticipantId(raw: string): string {
  return raw.trim().replace(PARTICIPANT_PREFIX, '').trim()
}

export function looksLikeSceneRef(raw: string): boolean {
  const t = raw.trim()
  if (!t) return false
  if (PARTICIPANT_PREFIX.test(t)) return true
  if (t.includes('=')) return false
  if (/^-?\d+(\.\d+)?$/.test(t)) return false
  if (/^(true|false|loop|camera)$/i.test(t)) return t.toLowerCase() === 'camera'
  return /^[a-zA-Z0-9_.:-]+$/.test(t)
}

export function parseSceneRef(raw: unknown): SceneRef | null {
  if (raw == null) return null
  if (typeof raw === 'object') {
    const rec = raw as Record<string, unknown>
    const participant = rec.participant ?? rec.slug ?? rec.agent ?? rec.avatar
    if (participant != null && String(participant).trim()) {
      const id = normalizeParticipantId(String(participant))
      return id ? { kind: 'participant', id } : null
    }
    const objectId = rec.objectId ?? rec.object ?? rec.id ?? rec.target
    if (objectId != null && String(objectId).trim()) {
      return parseSceneRef(String(objectId))
    }
    return null
  }
  const t = String(raw).trim()
  if (!t) return null
  if (PARTICIPANT_PREFIX.test(t)) {
    const id = normalizeParticipantId(t)
    return id ? { kind: 'participant', id } : null
  }
  if (!looksLikeSceneRef(t)) return null
  return { kind: 'object', id: t }
}

export function sceneRefLabel(ref: SceneRef): string {
  return ref.kind === 'participant' ? `@${ref.id}` : ref.id
}

export function sceneRefKey(ref: SceneRef): string {
  return ref.kind === 'participant' ? `avatar:${ref.id}` : ref.id
}

/**
 * Split a trailing scene target from an inline token.
 * `wave:@alice` → { body: 'wave', target: '@alice' }
 * `wave|angry=30:@bob` → { body: 'wave|angry=30', target: '@bob' }
 * `walk:forward=1` unchanged (suffix has `=`).
 * `mood:playful` / `gesture:sad` unchanged — colon is the kv separator.
 */
/** Inline `key:value` heads — colon is NOT a scene-target separator. */
const INLINE_KV_KEYS = new Set([
  'mood',
  'm',
  'clothes',
  'outfit',
  'wear',
  'emotion',
  'e',
  'face',
  'gesture',
  'g',
  'look',
  'expr',
  'expression',
  'wait',
  'walk',
  'turn',
  'teleport',
  'tp',
  'approach',
  'turnto',
  'turn_to',
])

export function splitTrailingSceneTarget(token: string): { body: string; target?: string } {
  const raw = token.trim()
  const colon = raw.lastIndexOf(':')
  if (colon <= 0) return { body: raw }
  const suffix = raw.slice(colon + 1).trim()
  if (!looksLikeSceneRef(suffix)) return { body: raw }
  const head = raw.slice(0, colon).trim()
  if (!head) return { body: raw }
  // `[mood:playful]` / `[gesture:sad]` — keep intact for kv parsing.
  if (INLINE_KV_KEYS.has(head.toLowerCase())) return { body: raw }
  return { body: head, target: suffix }
}
