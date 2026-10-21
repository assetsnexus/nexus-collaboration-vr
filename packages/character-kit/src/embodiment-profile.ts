/**
 * Embodiment profile (plan Part C1).
 *
 * The agent profile carries an `embodiment` block that tells the client how to
 * play a character: which VRM/gesture pack, the default ambient mood, the
 * greeting/farewell/etc. routines, per-face (public vs owner) intensity caps,
 * speaking intensity scales and a Zen / quiet preference.
 *
 * Everything here is TOLERANT: an absent / malformed profile must degrade to the
 * current behaviour, never throw. This module is framework-free (no `three`) so
 * both the React chat surface and headless hosts can parse it.
 */

import {
  PRESENCE_MOODS,
  resolvePresenceMood,
  type PresenceMoodDef,
  type PresenceMoodId,
} from './presence-moods.js'
import {
  parseInlineTags,
  defaultInlineCatalog,
  type InlineSequenceStep,
} from './inline-tags.js'
import { normalizeFaceWeight } from './face-score.js'

/** Which face of the agent is looking at us. */
export type EmbodimentFace = 'public' | 'owner'

/** A routine step is either a compact inline-tag string or a structured step. */
export type EmbodimentRoutineStep = string | InlineSequenceStep

export interface EmbodimentFaceProfileV1 {
  /** Ambient mood for this face. */
  mood?: string
  /** Absolute cap on emotion/face weight for this face (0..1 or 0..100). */
  intensityCap?: number
  /** Multiplier on gesture intensity (<= 0 drops gestures). */
  gestureIntensityScale?: number
  /** Prefer face-only beats on this face (Zen public surface). */
  preferFaceOnly?: boolean
}

export interface EmbodimentRoutinesV1 {
  greeting?: EmbodimentRoutineStep[]
  farewell?: EmbodimentRoutineStep[]
  onListen?: EmbodimentRoutineStep[]
  onThink?: EmbodimentRoutineStep[]
}

export interface EmbodimentIdleV1 {
  /** Ambient mood overrides seeded into PRESENCE_MOODS (partial per mood). */
  moodOverrides?: Record<string, Partial<PresenceMoodDef>>
}

export interface EmbodimentSpeakingV1 {
  /** Multiplier on emotion/face weight while speaking. Default 1. */
  emotionIntensityScale?: number
  /** Multiplier on gesture intensity while speaking. Default 1. */
  gestureIntensityScale?: number
}

export interface EmbodimentProfileV1 {
  v?: number
  vrmUrl?: string | null
  vrmAssetId?: string | null
  gestureManifestUrl?: string | null
  defaultMood?: string | null
  lipSyncEnabled?: boolean
  /** character-kit expression name overrides (logical -> model name). */
  expressionMap?: Record<string, string>
  /** Inline-tag gesture token aliases (e.g. `hi` -> `wave`). */
  gestureAliases?: Record<string, string>
  idle?: EmbodimentIdleV1
  routines?: EmbodimentRoutinesV1
  speaking?: EmbodimentSpeakingV1
  faces?: { public?: EmbodimentFaceProfileV1; owner?: EmbodimentFaceProfileV1 }
  zen?: { preferFaceOnly?: boolean }
}

export const EMBODIMENT_SPEAKING_DEFAULTS: Required<EmbodimentSpeakingV1> = {
  emotionIntensityScale: 1,
  gestureIntensityScale: 1,
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = Number(v.trim())
    if (Number.isFinite(n)) return n
  }
  return undefined
}

function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out = v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
  return out.length ? out : undefined
}

function asRoutine(v: unknown): EmbodimentRoutineStep[] | undefined {
  if (typeof v === 'string') {
    const t = v.trim()
    return t ? [t] : undefined
  }
  if (!Array.isArray(v)) return undefined
  const out: EmbodimentRoutineStep[] = []
  for (const item of v) {
    if (typeof item === 'string') {
      if (item.trim()) out.push(item)
      continue
    }
    if (isRecord(item) && typeof item.op === 'string') {
      out.push(item as unknown as InlineSequenceStep)
    }
  }
  return out.length ? out : undefined
}

function parseFaceProfile(v: unknown): EmbodimentFaceProfileV1 | undefined {
  if (!isRecord(v)) return undefined
  const face: EmbodimentFaceProfileV1 = {}
  const mood = asString(v.mood)
  if (mood) face.mood = mood
  const cap = asNumber(v.intensityCap ?? v.intensity_cap)
  if (cap !== undefined) face.intensityCap = cap
  const gestureScale = asNumber(v.gestureIntensityScale ?? v.gesture_intensity_scale)
  if (gestureScale !== undefined) face.gestureIntensityScale = gestureScale
  if (typeof v.preferFaceOnly === 'boolean') face.preferFaceOnly = v.preferFaceOnly
  return Object.keys(face).length ? face : undefined
}

function parseMoodOverrides(v: unknown): Record<string, Partial<PresenceMoodDef>> | undefined {
  if (!isRecord(v)) return undefined
  const out: Record<string, Partial<PresenceMoodDef>> = {}
  for (const [moodId, raw] of Object.entries(v)) {
    if (!moodId.trim() || !isRecord(raw)) continue
    const patch: Partial<PresenceMoodDef> = {}
    const resolving = raw as Record<string, unknown>
    const faceEmotion = asString(resolving.faceEmotion)
    if (faceEmotion) patch.faceEmotion = faceEmotion as PresenceMoodDef['faceEmotion']
    const faceIntensity = asNumber(resolving.faceIntensity)
    if (faceIntensity !== undefined) patch.faceIntensity = faceIntensity
    const tempo = asNumber(resolving.tempo)
    if (tempo !== undefined) patch.tempo = tempo
    const longIdleScale = asNumber(resolving.longIdleScale)
    if (longIdleScale !== undefined) patch.longIdleScale = longIdleScale
    const idleTimeScale = asNumber(resolving.idleTimeScale)
    if (idleTimeScale !== undefined) patch.idleTimeScale = idleTimeScale
    const sitFidgets = asStringArray(resolving.sitFidgets)
    if (sitFidgets) patch.sitFidgets = sitFidgets
    const microGestures = asStringArray(resolving.microGestures)
    if (microGestures) patch.microGestures = microGestures
    const mediumGestures = asStringArray(resolving.mediumGestures)
    if (mediumGestures) patch.mediumGestures = mediumGestures
    const longGestures = asStringArray(resolving.longGestures)
    if (longGestures) patch.longGestures = longGestures
    if (Object.keys(patch).length) out[moodId.trim()] = patch
  }
  return Object.keys(out).length ? out : undefined
}

/**
 * Parse an embodiment profile from an untrusted payload (agent profile,
 * presence doc, session payload). Returns `null` when there is nothing usable,
 * so callers can keep the current behaviour.
 */
export function parseEmbodimentProfile(raw: unknown): EmbodimentProfileV1 | null {
  if (!isRecord(raw)) return null
  const profile: EmbodimentProfileV1 = {}
  const vrmUrl = asString(raw.vrmUrl)
  if (vrmUrl) profile.vrmUrl = vrmUrl
  const vrmAssetId = asString(raw.vrmAssetId)
  if (vrmAssetId) profile.vrmAssetId = vrmAssetId
  const gestureManifestUrl = asString(raw.gestureManifestUrl)
  if (gestureManifestUrl) profile.gestureManifestUrl = gestureManifestUrl
  const defaultMood = asString(raw.defaultMood)
  if (defaultMood) profile.defaultMood = defaultMood
  if (typeof raw.lipSyncEnabled === 'boolean') profile.lipSyncEnabled = raw.lipSyncEnabled
  if (isRecord(raw.expressionMap)) {
    const map: Record<string, string> = {}
    for (const [k, val] of Object.entries(raw.expressionMap)) {
      if (typeof val === 'string' && k.trim()) map[k.trim()] = val
    }
    if (Object.keys(map).length) profile.expressionMap = map
  }
  if (isRecord(raw.gestureAliases)) {
    const map: Record<string, string> = {}
    for (const [k, val] of Object.entries(raw.gestureAliases)) {
      if (typeof val === 'string' && k.trim()) map[k.trim()] = val
    }
    if (Object.keys(map).length) profile.gestureAliases = map
  }
  if (isRecord(raw.idle)) {
    const moodOverrides = parseMoodOverrides(raw.idle.moodOverrides)
    if (moodOverrides) profile.idle = { moodOverrides }
  }
  if (isRecord(raw.routines)) {
    const routines: EmbodimentRoutinesV1 = {}
    const greeting = asRoutine(raw.routines.greeting)
    if (greeting) routines.greeting = greeting
    const farewell = asRoutine(raw.routines.farewell)
    if (farewell) routines.farewell = farewell
    const onListen = asRoutine(raw.routines.onListen)
    if (onListen) routines.onListen = onListen
    const onThink = asRoutine(raw.routines.onThink)
    if (onThink) routines.onThink = onThink
    if (Object.keys(routines).length) profile.routines = routines
  }
  if (isRecord(raw.speaking)) {
    const speaking: EmbodimentSpeakingV1 = {}
    const emotionScale = asNumber(raw.speaking.emotionIntensityScale)
    if (emotionScale !== undefined) speaking.emotionIntensityScale = emotionScale
    const gestureScale = asNumber(raw.speaking.gestureIntensityScale)
    if (gestureScale !== undefined) speaking.gestureIntensityScale = gestureScale
    if (Object.keys(speaking).length) profile.speaking = speaking
  }
  if (isRecord(raw.faces)) {
    const publicFace = parseFaceProfile(raw.faces.public)
    const ownerFace = parseFaceProfile(raw.faces.owner)
    if (publicFace || ownerFace) {
      profile.faces = {
        ...(publicFace ? { public: publicFace } : {}),
        ...(ownerFace ? { owner: ownerFace } : {}),
      }
    }
  }
  if (isRecord(raw.zen) && typeof raw.zen.preferFaceOnly === 'boolean') {
    profile.zen = { preferFaceOnly: raw.zen.preferFaceOnly }
  }
  return Object.keys(profile).length ? { v: 1, ...profile } : null
}

/**
 * Seed idle mood overrides into PRESENCE_MOODS. Deep-merges the provided
 * partials onto the catalog so the ambient director picks up character-specific
 * pacing without a code change. Returns the list of mood ids actually changed.
 */
export function seedPresenceMoodOverrides(
  overrides: Record<string, Partial<PresenceMoodDef>> | null | undefined,
): string[] {
  if (!overrides) return []
  const changed: string[] = []
  for (const [rawId, patch] of Object.entries(overrides)) {
    const def = resolvePresenceMood(rawId)
    if (!def || !patch) continue
    // Mutate in place: PRESENCE_MOODS entries are shared catalog objects.
    if (patch.faceEmotion) def.faceEmotion = patch.faceEmotion
    if (patch.faceIntensity !== undefined) def.faceIntensity = patch.faceIntensity
    if (patch.tempo !== undefined) def.tempo = patch.tempo
    if (patch.longIdleScale !== undefined) def.longIdleScale = patch.longIdleScale
    if (patch.idleTimeScale !== undefined) def.idleTimeScale = patch.idleTimeScale
    if (patch.sitFidgets) def.sitFidgets = [...patch.sitFidgets]
    if (patch.microGestures) def.microGestures = [...patch.microGestures]
    if (patch.mediumGestures) def.mediumGestures = [...patch.mediumGestures]
    if (patch.longGestures) def.longGestures = [...patch.longGestures]
    changed.push(def.id)
  }
  return changed
}

export interface ResolvedEmbodimentFace extends EmbodimentFaceProfileV1 {
  /** Normalized 0..1 cap (always set). */
  cap: number
  /** Normalized gesture scale (always set). */
  gestureScale: number
  preferFaceOnly: boolean
}

/**
 * Resolve the effective face config for a viewer, applying Zen globally and the
 * built-in public-face default (public is quieter than owner unless overridden).
 */
export function resolveEmbodimentFace(
  profile: EmbodimentProfileV1 | null | undefined,
  face: EmbodimentFace,
): ResolvedEmbodimentFace {
  const base = profile?.faces?.[face] || {}
  // Public default is a broad-but-not-silly cap; owner is uncapped.
  const defaultCap = face === 'public' ? 0.6 : 1
  const cap = normalizeFaceWeight(base.intensityCap ?? defaultCap)
  const gestureScale = base.gestureIntensityScale ?? 1
  const preferFaceOnly = Boolean(profile?.zen?.preferFaceOnly) || base.preferFaceOnly === true
  return {
    ...base,
    cap,
    gestureScale,
    preferFaceOnly,
  }
}

export type EmbodimentRoutineName = keyof EmbodimentRoutinesV1

const FACE_ONLY_OPS = new Set(['set_emotion', 'set_expression'])
const GESTURE_OPS = new Set([
  'play_gesture',
  'set_clothes',
  'walk',
  'turn',
  'jump',
  'teleport',
  'approach',
  'turn_to',
  'look_at',
])

/**
 * Apply face caps + speaking scales to parsed inline steps.
 *
 * - `emotionScale` multiplies every face weight.
 * - `cap` clamps the resulting weight.
 * - `dropGestures` (Zen / zero gesture scale) removes body ops, keeping faces.
 */
export function applyEmbodimentToSteps(
  steps: InlineSequenceStep[],
  opts: {
    emotionScale?: number
    cap?: number
    dropGestures?: boolean
  } = {},
): InlineSequenceStep[] {
  const emotionScale = opts.emotionScale ?? 1
  const cap = opts.cap ?? 1
  const out: InlineSequenceStep[] = []
  for (const step of steps) {
    const op = String(step.op)
    if (opts.dropGestures && GESTURE_OPS.has(op)) continue
    let next = step
    if (FACE_ONLY_OPS.has(op) || step.faces?.length) {
      const scaledFaces = step.faces?.map((layer) => ({
        ...layer,
        weight: Math.min(cap, normalizeFaceWeight(layer.weight * emotionScale)),
      }))
      const scaledIntensity =
        step.intensity !== undefined
          ? Math.min(cap, normalizeFaceWeight(step.intensity * emotionScale))
          : step.intensity
      next = {
        ...step,
        ...(scaledFaces ? { faces: scaledFaces } : {}),
        ...(scaledIntensity !== undefined ? { intensity: scaledIntensity } : {}),
      }
    }
    out.push(next)
  }
  return out
}

/** Normalize a routine's string steps through the inline-tag parser. */
export function resolveEmbodimentRoutine(
  profile: EmbodimentProfileV1 | null | undefined,
  name: EmbodimentRoutineName,
): InlineSequenceStep[] {
  const routine = profile?.routines?.[name]
  if (!routine?.length) return []
  const out: InlineSequenceStep[] = []
  for (const step of routine) {
    if (typeof step !== 'string') {
      out.push(step)
      continue
    }
    const parsed = parseInlineTags(step, defaultInlineCatalog(), { enabled: true })
    // A standalone routine tag has no surrounding speech, so the parser may
    // classify it as an after-TTS beat. Combine both in parse order.
    const beats = [...parsed.withSpeech, ...parsed.afterTts]
    if (beats.length) out.push(...beats)
    // A bare word that parsed to nothing is treated as a gesture id.
    else {
      const id = step.trim()
      if (/^[a-z0-9_]+$/i.test(id)) out.push({ op: 'play_gesture', id })
    }
  }
  return out
}

/** Default ambient mood for a face, falling back to the profile default. */
export function resolveEmbodimentMood(
  profile: EmbodimentProfileV1 | null | undefined,
  face: EmbodimentFace,
): PresenceMoodId | null {
  const faceMood = profile?.faces?.[face]?.mood
  const candidate = faceMood || profile?.defaultMood
  if (!candidate) return null
  return resolvePresenceMood(candidate)?.id ?? null
}

/** True when the profile seeds anything meaningful for the ambient director. */
export function hasEmbodimentIdleOverrides(
  profile: EmbodimentProfileV1 | null | undefined,
): boolean {
  return Boolean(profile?.idle?.moodOverrides && Object.keys(profile.idle.moodOverrides).length)
}

/** True when the profile declares at least one routine beat. */
export function HAS_EMBODIMENT_ROUTINES(
  profile: EmbodimentProfileV1 | null | undefined,
): boolean {
  return Boolean(profile?.routines && Object.keys(profile.routines).length)
}

/**
 * Rewrite compact inline-tag gesture tokens using `gestureAliases`
 * (e.g. `[hi]` -> `[wave]`, `[hi|happy=30]` -> `[wave|happy=30]`).
 *
 * Tokens are matched case-insensitively against the alias map; unknown tokens
 * pass through untouched.
 */
export function applyGestureAliasesToText(
  text: string,
  gestureAliases: Record<string, string> | null | undefined,
): string {
  if (!text || !gestureAliases || !Object.keys(gestureAliases).length) return text
  const lookup = new Map<string, string>()
  for (const [from, to] of Object.entries(gestureAliases)) {
    const key = from.trim().toLowerCase()
    if (key && typeof to === 'string' && to.trim()) lookup.set(key, to.trim())
  }
  if (!lookup.size) return text
  return text.replace(/\[([^\]]+)\]/g, (match, inner: string) => {
    const body = String(inner)
    // Preserve a leading `key:` namespace (e.g. `mood:`, `emotion:`) untouched.
    if (/^[a-z_]+:/i.test(body)) return match
    const [head, ...tail] = body.split('|')
    const chainParts = String(head).split(',')
    const rewritten = chainParts.map((part) => {
      const trimmed = part.trim()
      const mapped = lookup.get(trimmed.toLowerCase())
      return mapped ?? trimmed
    })
    const nextHead = rewritten.join(', ')
    const next = tail.length ? `${nextHead}|${tail.join('|')}` : nextHead
    return `[${next}]`
  })
}

/** Test/reset helper: restore catalog defaults after a seeded override. */
export function snapshotPresenceMoods(): Record<string, PresenceMoodDef> {
  const out: Record<string, PresenceMoodDef> = {}
  for (const [id, def] of Object.entries(PRESENCE_MOODS)) {
    out[id] = { ...def, sitFidgets: [...def.sitFidgets], microGestures: [...def.microGestures], mediumGestures: [...def.mediumGestures], longGestures: [...def.longGestures] }
  }
  return out
}

export function restorePresenceMoods(snapshot: Record<string, PresenceMoodDef>): void {
  for (const [id, def] of Object.entries(snapshot)) {
    const target = (PRESENCE_MOODS as Record<string, PresenceMoodDef>)[id]
    if (!target) continue
    Object.assign(target, def, {
      sitFidgets: [...def.sitFidgets],
      microGestures: [...def.microGestures],
      mediumGestures: [...def.mediumGestures],
      longGestures: [...def.longGestures],
    })
  }
}
