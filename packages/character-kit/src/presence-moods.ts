import type { EmotionId } from './types.js'

export type PresenceMoodId =
  | 'neutral'
  | 'relaxed'
  | 'happy'
  | 'playful'
  | 'curious'
  | 'focused'
  | 'tired'
  | 'sad'
  | 'excited'
  | 'worried'
  | 'annoyed'

export interface PresenceMoodDef {
  id: PresenceMoodId
  description: string
  /** Default face while ambient (not speaking) */
  faceEmotion: EmotionId
  faceIntensity: number
  /** Scale ambient timing (<1 = fidget sooner) */
  tempo: number
  /** Scale long-idle threshold (<1 = rest sooner) */
  longIdleScale: number
  /** Standing rest-loop timeScale (tired slower, excited faster). */
  idleTimeScale: number
  /** One-shots while the sit rest loop is active. */
  sitFidgets: string[]
  microGestures: string[]
  mediumGestures: string[]
  longGestures: string[]
}

/** Catalog the LLM can list / set; drives IdlePresenceDirector pools. */
export const PRESENCE_MOODS: Record<PresenceMoodId, PresenceMoodDef> = {
  neutral: {
    id: 'neutral',
    description: 'Default calm companion; light weight shifts and glances',
    faceEmotion: 'neutral',
    faceIntensity: 0.35,
    tempo: 1,
    longIdleScale: 1,
    idleTimeScale: 1,
    sitFidgets: ['sit_wave'],
    microGestures: ['weight_shift', 'look_around', 'nod'],
    mediumGestures: ['scratch_nose', 'stretch', 'look_around'],
    longGestures: ['sit'],
  },
  relaxed: {
    id: 'relaxed',
    description: 'Soft, unhurried; stretches and slow shifts',
    faceEmotion: 'relaxed',
    faceIntensity: 0.55,
    tempo: 1.25,
    longIdleScale: 0.85,
    idleTimeScale: 0.88,
    sitFidgets: ['sit_wave'],
    microGestures: ['weight_shift', 'nod'],
    mediumGestures: ['stretch', 'scratch_nose', 'sleepy'],
    longGestures: ['sit'],
  },
  happy: {
    id: 'happy',
    description: 'Warm positive idle; more nods and light motion',
    faceEmotion: 'happy',
    faceIntensity: 0.55,
    tempo: 0.9,
    longIdleScale: 1.1,
    idleTimeScale: 1.05,
    sitFidgets: ['sit_wave'],
    microGestures: ['nod', 'weight_shift', 'look_around'],
    mediumGestures: ['stretch', 'wave', 'scratch_nose', 'v_sign', 'v_sign_short'],
    longGestures: ['sit'],
  },
  playful: {
    id: 'playful',
    description: 'Cheeky ambient; waves, looks around, surprises',
    faceEmotion: 'happy',
    faceIntensity: 0.65,
    tempo: 0.75,
    longIdleScale: 1.2,
    idleTimeScale: 1.12,
    sitFidgets: ['sit_wave'],
    microGestures: ['look_around', 'nod', 'weight_shift'],
    mediumGestures: ['wave', 'surprised', 'stretch', 'airplane', 'v_sign', 'v_sign_short'],
    longGestures: ['sit'],
  },
  curious: {
    id: 'curious',
    description: 'Attentive looking / thinking while idle',
    faceEmotion: 'surprised',
    faceIntensity: 0.25,
    tempo: 0.85,
    longIdleScale: 1.15,
    idleTimeScale: 1,
    sitFidgets: ['sit_wave'],
    microGestures: ['look_around', 'nod', 'think'],
    mediumGestures: ['think', 'look_around', 'scratch_nose'],
    longGestures: ['sit'],
  },
  focused: {
    id: 'focused',
    description: 'Quieter presence; thinking beats, fewer big fidgets',
    faceEmotion: 'neutral',
    faceIntensity: 0.4,
    tempo: 1.35,
    longIdleScale: 1.4,
    idleTimeScale: 0.92,
    sitFidgets: ['sit_wave'],
    microGestures: ['nod', 'weight_shift'],
    mediumGestures: ['think', 'look_around'],
    longGestures: ['sit'],
  },
  tired: {
    id: 'tired',
    description: 'Low energy; rests sooner, stretches more',
    faceEmotion: 'relaxed',
    faceIntensity: 0.45,
    tempo: 1.5,
    longIdleScale: 0.45,
    idleTimeScale: 0.72,
    sitFidgets: ['sit_wave'],
    microGestures: ['weight_shift'],
    mediumGestures: ['stretch', 'sleepy', 'scratch_nose'],
    longGestures: ['sit', 'sleepy'],
  },
  sad: {
    id: 'sad',
    description: 'Subdued ambient; sad posture cues, slow tempo',
    faceEmotion: 'sad',
    faceIntensity: 0.45,
    tempo: 1.4,
    longIdleScale: 0.7,
    idleTimeScale: 0.78,
    sitFidgets: ['sit_wave'],
    microGestures: ['weight_shift', 'nod'],
    mediumGestures: ['sad', 'stretch', 'look_around'],
    longGestures: ['sit'],
  },
  excited: {
    id: 'excited',
    description: 'High energy fidgets; waves and surprises',
    faceEmotion: 'happy',
    faceIntensity: 0.7,
    tempo: 0.65,
    longIdleScale: 1.5,
    idleTimeScale: 1.2,
    sitFidgets: ['sit_wave'],
    microGestures: ['weight_shift', 'nod', 'look_around'],
    mediumGestures: ['wave', 'surprised', 'stretch', 'clap'],
    longGestures: ['sit'],
  },
  /**
   * Plan §P6c — the first *negative-valence* moods with real clips. Before this
   * an anxious agent had to alias onto `focused`, so a worried companion read as
   * a calm one. `faceIntensity` stays low (0.4) so it reads as concern, not
   * alarm: `surprised` at full strength is a startle.
   */
  worried: {
    id: 'worried',
    description: 'Concerned ambient; uneasy fidgets, faster tempo, slow rests',
    faceEmotion: 'surprised',
    faceIntensity: 0.4,
    tempo: 0.78,
    longIdleScale: 1.06,
    idleTimeScale: 1.06,
    sitFidgets: ['sit_wave'],
    microGestures: ['look_around', 'think', 'weight_shift'],
    mediumGestures: ['think', 'look_around_turn', 'scratch_nose'],
    longGestures: ['sit'],
  },
  /**
   * Plan §P6c — mock-impatient / sassy ambient for a funny-pissed personality.
   * Deliberately low `faceIntensity` (0.35): the anger clip at full strength is
   * hostile, and this mood is meant to be *comedic* impatience.
   */
  annoyed: {
    id: 'annoyed',
    description: 'Impatient ambient; disagree beats, faster tempo, quick rests',
    faceEmotion: 'angry',
    faceIntensity: 0.35,
    tempo: 0.8,
    longIdleScale: 1.08,
    idleTimeScale: 1.08,
    sitFidgets: ['sit_wave'],
    microGestures: ['disagree', 'look_around', 'weight_shift'],
    mediumGestures: ['angry', 'disagree', 'think', 'look_around'],
    longGestures: ['sit'],
  },
}

export function listPresenceMoods(): PresenceMoodDef[] {
  return Object.values(PRESENCE_MOODS)
}

/** Seed / config labels that are not catalog ids. */
const PRESENCE_MOOD_ALIASES: Record<string, PresenceMoodId> = {
  calm: 'relaxed',
  warm: 'happy',
  gentle: 'relaxed',
  default: 'neutral',
  // Native emotion engine (`NativeEmotionEngine.moodToPresence`) emits richer
  // PAD words than the ambient catalog. Map them onto real ids so
  // `setMood('alert'|'energetic')` never silently returns false and leaves the
  // last mood sticky. `happy`/`sad` are already canonical ids.
  alert: 'focused',
  energetic: 'excited',
  content: 'relaxed',
  cheerful: 'happy',
  bored: 'tired',
  down: 'sad',
  sleepy: 'tired',
  attentive: 'curious',
  // Plan §P6c — richer aliases onto the two new negative-valence moods, plus
  // the "amused" family that belongs on `playful`.
  anxious: 'worried',
  concerned: 'worried',
  nervous: 'worried',
  uneasy: 'worried',
  impatient: 'annoyed',
  irritated: 'annoyed',
  frustrated: 'annoyed',
  pissed: 'annoyed',
  grumpy: 'annoyed',
  exasperated: 'annoyed',
  amused: 'playful',
  cheeky: 'playful',
  smug: 'playful',
}

/**
 * Coerce any inbound mood label (engine output, profile seed, LLM tool arg) to a
 * canonical `PresenceMoodId`, or `null` when nothing matches. Case- and
 * whitespace-tolerant; shared by the emotion engine and the character host.
 */
export function coercePresenceMoodId(id: string | null | undefined): PresenceMoodId | null {
  if (typeof id !== 'string') return null
  const key = id.trim().toLowerCase()
  if (!key) return null
  const aliased = PRESENCE_MOOD_ALIASES[key] ?? (key as PresenceMoodId)
  return Object.prototype.hasOwnProperty.call(PRESENCE_MOODS, aliased) ? aliased : null
}

export function resolvePresenceMood(id: string): PresenceMoodDef | null {
  const coerced = coercePresenceMoodId(id)
  return coerced ? PRESENCE_MOODS[coerced] : null
}
