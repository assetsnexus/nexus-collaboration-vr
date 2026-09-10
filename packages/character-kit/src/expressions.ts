export type ExpressionKind = 'emotion' | 'viseme' | 'blink' | 'look' | 'custom'

export interface ExpressionInfo {
  name: string
  kind: ExpressionKind
  binary: boolean
  /** Current blendshape weight 0..1 */
  weight: number
}

/** Canonical VRM1 presets plus common VRM0 group names. */
export const EMOTION_ALIASES: Record<string, string> = {
  neutral: 'neutral',
  happy: 'happy',
  joy: 'happy',
  angry: 'angry',
  angy: 'angry',
  sad: 'sad',
  sorrow: 'sad',
  relaxed: 'relaxed',
  fun: 'relaxed',
  surprised: 'surprised',
  blink: 'blink',
}

const EMOTION_KEYS = new Set([
  'neutral',
  'happy',
  'angry',
  'sad',
  'relaxed',
  'surprised',
  'joy',
  'fun',
  'sorrow',
])

const VISEME_KEYS = new Set(['aa', 'ih', 'ou', 'ee', 'oh', 'a', 'i', 'u', 'e', 'o'])

const BLINK_KEYS = new Set(['blink', 'blinkleft', 'blinkright', 'blink_l', 'blink_r'])

const LOOK_KEYS = new Set(['lookup', 'lookdown', 'lookleft', 'lookright'])

function keyOf(name: string): string {
  return name.replace(/[\s-]/g, '_').toLowerCase()
}

export function classifyExpressionName(name: string): ExpressionKind {
  const k = keyOf(name)
  if (EMOTION_KEYS.has(k)) return 'emotion'
  if (VISEME_KEYS.has(k)) return 'viseme'
  if (BLINK_KEYS.has(k)) return 'blink'
  if (LOOK_KEYS.has(k)) return 'look'
  return 'custom'
}

/**
 * Map an LLM/user emotion id onto a name that exists on this VRM.
 * Handles VRM0 Joy/Fun/Sorrow vs VRM1 happy/relaxed/sad.
 */
export function resolveEmotionExpression(
  requested: string,
  available: readonly string[],
): string | null {
  const req = requested.trim()
  if (!req) return null
  if (available.length === 0) return req

  const byLower = new Map(available.map((n) => [n.toLowerCase(), n]))
  const lower = req.toLowerCase()
  const hit = byLower.get(lower)
  if (hit) return hit

  const canonical = EMOTION_ALIASES[lower] ?? lower
  const canonHit = byLower.get(canonical)
  if (canonHit) return canonHit

  for (const [alias, canon] of Object.entries(EMOTION_ALIASES)) {
    if (canon === canonical || canon === lower || alias === lower) {
      const aliasHit = byLower.get(alias)
      if (aliasHit) return aliasHit
    }
  }
  return null
}

export function groupExpressionNames(infos: readonly ExpressionInfo[]): {
  emotion: string[]
  viseme: string[]
  blink: string[]
  look: string[]
  custom: string[]
} {
  const grouped = {
    emotion: [] as string[],
    viseme: [] as string[],
    blink: [] as string[],
    look: [] as string[],
    custom: [] as string[],
  }
  for (const info of infos) grouped[info.kind].push(info.name)
  return grouped
}
