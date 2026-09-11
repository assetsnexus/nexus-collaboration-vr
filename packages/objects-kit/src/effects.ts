/** Named effect clips — gesture analogue for objects. */

export type EffectOp =
  | { op: 'glow'; color?: string; intensity?: number; durationMs?: number }
  | { op: 'pulse'; scale?: number; durationMs?: number; loop?: boolean }
  | { op: 'spin'; speed?: number; durationMs?: number; loop?: boolean }
  | { op: 'bob'; amplitude?: number; durationMs?: number; loop?: boolean }
  | { op: 'blink'; durationMs?: number }
  | { op: 'fade'; opacity?: number; durationMs?: number }

export type EffectClip = {
  id: string
  ops: EffectOp[]
}

export const BUILTIN_EFFECTS: Record<string, EffectClip> = {
  glow: {
    id: 'glow',
    ops: [{ op: 'glow', color: '#66ccff', intensity: 1.2, durationMs: 1800 }],
  },
  pulse: {
    id: 'pulse',
    ops: [{ op: 'pulse', scale: 1.25, durationMs: 900, loop: true }],
  },
  spin: {
    id: 'spin',
    ops: [{ op: 'spin', speed: 2.5, durationMs: 2000, loop: true }],
  },
  bob: {
    id: 'bob',
    ops: [{ op: 'bob', amplitude: 0.08, durationMs: 1200, loop: true }],
  },
  blink: {
    id: 'blink',
    ops: [{ op: 'blink', durationMs: 600 }],
  },
  fade: {
    id: 'fade',
    ops: [{ op: 'fade', opacity: 0.25, durationMs: 800 }],
  },
}

export function resolveEffectClip(
  id: string,
  custom?: Record<string, EffectClip>,
): EffectClip | null {
  const key = id.trim().toLowerCase()
  if (!key) return null
  if (custom?.[key]) return custom[key]
  return BUILTIN_EFFECTS[key] ?? null
}

export function normalizeEffectClip(raw: unknown): EffectClip | null {
  if (!raw || typeof raw !== 'object') return null
  const rec = raw as Record<string, unknown>
  const id = String(rec.id || '').trim()
  if (!id || !Array.isArray(rec.ops) || !rec.ops.length) return null
  const ops: EffectOp[] = []
  for (const row of rec.ops) {
    if (!row || typeof row !== 'object') continue
    const op = String((row as Record<string, unknown>).op || '').toLowerCase()
    if (
      op === 'glow' ||
      op === 'pulse' ||
      op === 'spin' ||
      op === 'bob' ||
      op === 'blink' ||
      op === 'fade'
    ) {
      ops.push(row as EffectOp)
    }
  }
  if (!ops.length) return null
  return { id, ops }
}
