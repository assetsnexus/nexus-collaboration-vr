/**
 * Face-name typos / VRM0 names. Do not alias gesture tokens here
 * (`lough` / `laugh` are body clips — see GESTURE_TOKEN_ALIASES).
 */
export const FACE_NAME_ALIASES: Record<string, string> = {
  angy: 'angry',
  angery: 'angry',
  mad: 'angry',
  happpy: 'happy',
  happyness: 'happy',
  joy: 'happy',
  smiling: 'happy',
  sorrow: 'sad',
  unhappy: 'sad',
  fun: 'relaxed',
}

export interface FaceLayer {
  name: string
  /** 0..1 blend weight */
  weight: number
}

const DEFAULT_UNSCORED = 0.4

/** `30` → 0.30 (percent). `0.3` stays 0.3. `30%` → 0.30. */
export function parseFaceScore(raw: string | number | undefined | null): number {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_UNSCORED
  if (typeof raw === 'number') return normalizeFaceWeight(raw)
  const t = raw.trim().replace(/%$/, '')
  if (!t) return DEFAULT_UNSCORED
  const n = Number(t)
  if (!Number.isFinite(n)) return DEFAULT_UNSCORED
  return normalizeFaceWeight(n)
}

/** Tool/tag intensities: values > 1 are treated as 0–100 percent. */
export function normalizeFaceWeight(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_UNSCORED
  const w = n > 1 ? n / 100 : n
  return Math.min(1, Math.max(0, w))
}

export function aliasFaceName(raw: string): string {
  const k = raw.trim().toLowerCase()
  return FACE_NAME_ALIASES[k] ?? k
}

/**
 * `angry=30` or `angry=30+surprised=10` or `angry`.
 * `+` layers extra shapes on the same beat (comma is the tag-chain separator).
 */
export function parseFaceLayers(spec: string): FaceLayer[] {
  const parts = spec.split('+').map((p) => p.trim()).filter(Boolean)
  const layers: FaceLayer[] = []
  for (const part of parts) {
    const eq = part.indexOf('=')
    const nameRaw = (eq >= 0 ? part.slice(0, eq) : part).trim()
    if (!nameRaw) continue
    const scoreRaw = eq >= 0 ? part.slice(eq + 1) : ''
    layers.push({
      name: aliasFaceName(nameRaw),
      weight: parseFaceScore(scoreRaw || undefined),
    })
  }
  return layers
}

export interface GestureFaceToken {
  gesture: string
  layers: FaceLayer[]
}

/** `wave|angry=30` / `lough|happy=30`. */
export function parseGestureFaceToken(token: string): GestureFaceToken | null {
  const pipe = token.indexOf('|')
  if (pipe <= 0) return null
  const gesture = token.slice(0, pipe).trim()
  const spec = token.slice(pipe + 1).trim()
  if (!gesture || !spec) return null
  const layers = parseFaceLayers(spec)
  if (!layers.length) return null
  return { gesture, layers }
}

export const FACE_FADE_IN_MS = 220
export const FACE_FADE_REST_MS = 480
export const FACE_FADE_MOOD_MS = 360
