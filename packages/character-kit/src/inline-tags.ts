import { splitTrailingSceneTarget, looksLikeSceneRef } from './scene-ref.js'
import { parseLookAtTarget } from './gaze.js'
import type { LookAtTarget } from './types.js'
import { GESTURE_VARIANT_GROUPS } from './gesture-variants.js'
import { listPresenceMoods } from './presence-moods.js'
import { resolveEmotionExpression } from './expressions.js'
import { parseClothesIdList, summarizeClothesSelection, resolveClothesSelection } from './clothes-parse.js'
import {
  FACE_FADE_IN_MS,
  parseFaceLayers,
  parseFaceScore,
  parseGestureFaceToken,
  type FaceLayer,
} from './face-score.js'

export type InlineSequenceOp =
  | 'play_gesture'
  | 'set_emotion'
  | 'set_expression'
  | 'set_mood'
  | 'set_clothes'
  | 'look_at'
  | 'wait'
  | 'walk'
  | 'turn'
  | 'jump'
  | 'teleport'
  | 'approach'
  | 'turn_to'

export interface InlineSequenceStep {
  op: InlineSequenceOp
  id?: string
  emotion?: string
  intensity?: number
  holdMs?: number
  name?: string
  weight?: number
  loop?: boolean
  crossFade?: number
  ms?: number
  mood?: string
  clothesId?: string
  clothesIds?: string[]
  clothesUrl?: string | null
  target?: LookAtTarget
  turn?: boolean
  faces?: FaceLayer[]
  fadeMs?: number
  walkArgs?: Record<string, unknown>
  degrees?: number
  speed?: number
  objectId?: string
  sceneTarget?: string
  approachFrom?: 'front' | 'left' | 'right' | 'back' | 'top' | 'from'
}

export interface InlineTagCatalog {
  gestures: string[]
  moods: string[]
  emotions: string[]
  expressions: string[]
  clothes?: string[]
}

export interface InlineTagBadge {
  raw: string
  kind:
    | 'gesture'
    | 'emotion'
    | 'mood'
    | 'wait'
    | 'look'
    | 'expression'
    | 'clothes'
    | 'fish'
    | 'chain'
    | 'walk'
    | 'turn'
    | 'jump'
    | 'teleport'
    | 'approach'
    | 'turn_to'
  placement: 'start' | 'mid' | 'end'
}

export interface ParsedInlineTags {
  displayText: string
  ttsText: string
  withSpeech: InlineSequenceStep[]
  afterTts: InlineSequenceStep[]
  badges: InlineTagBadge[]
  /**
   * Character face/gesture cues positioned in `ttsText` (Fish tags excluded).
   * `ttsIndex` is the character offset in `ttsText` where the cue should fire.
   */
  timedCues: TimedInlineCue[]
}

export interface TimedInlineCue {
  ttsIndex: number
  placement: 'start' | 'mid' | 'end'
  steps: InlineSequenceStep[]
  /** True for locomotion that should run at performance start, not phoneme-timed. */
  locomotion: boolean
}

export const GESTURE_TOKEN_ALIASES: Record<string, string> = {
  lough: 'laugh',
  laughing: 'laugh',
  chuckle: 'laugh',
  chuckling: 'laugh',
  nodding: 'nod',
  waving: 'wave',
  thinking: 'think',
}

/** Fish S2 tags that must stay in TTS; stripped from chat display. */
export const FISH_TTS_TAGS = new Set(
  [
    'happy',
    'sad',
    'angry',
    'excited',
    'calm',
    'nervous',
    'confident',
    'surprised',
    'satisfied',
    'delighted',
    'scared',
    'worried',
    'upset',
    'frustrated',
    'empathetic',
    'embarrassed',
    'proud',
    'relaxed',
    'grateful',
    'curious',
    'sarcastic',
    'hopeful',
    'determined',
    'whispering',
    'soft tone',
    'shouting',
    'screaming',
    'in a hurry tone',
    'emphasis',
    'laughing',
    'chuckling',
    'sighing',
    'gasping',
    'clear throat',
    'break',
    'long-break',
    'thinking aloud',
  ].map((t) => t.toLowerCase()),
)

const BRACKET_RE = /\[([^\[\]]+)\]/g
const CHARACTER_JSON_RE = /CHARACTER:\s*(\{[^\n]*\})/gi

function lowerSet(ids: readonly string[]): Map<string, string> {
  return new Map(ids.map((id) => [id.toLowerCase(), id]))
}

function parseWaitMs(token: string): number | null {
  const t = token.trim().toLowerCase()
  const s = t.match(/^(\d+(?:\.\d+)?)\s*s(?:ec(?:onds?)?)?$/)
  if (s) return Math.round(Number(s[1]) * 1000)
  const ms = t.match(/^(\d+(?:\.\d+)?)\s*ms$/)
  if (ms) return Math.round(Number(ms[1]))
  const wait = t.match(/^wait(?::|=)\s*(\d+(?:\.\d+)?)(ms|s)?$/)
  if (wait) {
    const n = Number(wait[1])
    return wait[2] === 's' ? Math.round(n * 1000) : Math.round(n)
  }
  return null
}

function splitKv(token: string): { key: string; value: string } | null {
  const m = token.match(/^([a-z_]+)\s*[:=]\s*(.+)$/i)
  if (!m) return null
  return { key: m[1]!.toLowerCase(), value: m[2]!.trim() }
}

/** Parse `forward=1,right=-0.5,speed=2` or `to=1,0.5` style walk tag values. */
/** Parse `[walk:…]` value. Meters: forward/right, or aliases backward/back/left. */
export function parseWalkTagValue(value: string): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const parts = value.split(',').map((p) => p.trim()).filter(Boolean)
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!
    const eq = p.indexOf('=')
    if (eq < 0) {
      if (!out.objectId) out.objectId = p
      continue
    }
    const k = p.slice(0, eq).trim().toLowerCase()
    const v = p.slice(eq + 1).trim()
    if (k === 'to') {
      const x = Number(v)
      const zPart = parts[i + 1]
      const z = zPart && !zPart.includes('=') ? Number(zPart) : Number.NaN
      if (Number.isFinite(x) && Number.isFinite(z)) {
        out.to = { x, z }
        i++
      }
      continue
    }
    if (k === 'forward' || k === 'right' || k === 'speed' || k === 'distance' || k === 'orbitdeg') {
      const n = Number(v)
      if (Number.isFinite(n)) out[k === 'orbitdeg' ? 'orbitDeg' : k] = n
      continue
    }
    // Direction aliases (meters) — agents often write backward/left instead of negative axes.
    if (k === 'backward' || k === 'back') {
      const n = Number(v)
      if (Number.isFinite(n)) out.forward = -Math.abs(n)
      continue
    }
    if (k === 'left') {
      const n = Number(v)
      if (Number.isFinite(n)) out.right = -Math.abs(n)
      continue
    }
    if (k === 'side' || k === 'face' || k === 'gait' || k === 'objectid') {
      out[k === 'objectid' ? 'objectId' : k] = v
    }
  }
  return out
}

/** Parse `seat` or `seat,side=left,distance=1.5`. */
function parseTeleportTagValue(value: string): Record<string, unknown> {
  const parts = value.split(',').map((p) => p.trim()).filter(Boolean)
  const out: Record<string, unknown> = {}
  if (!parts.length) return out
  const first = parts[0]!
  if (!first.includes('=')) {
    out.objectId = first
    parts.shift()
  }
  for (const p of parts) {
    const eq = p.indexOf('=')
    if (eq < 0) continue
    const k = p.slice(0, eq).trim().toLowerCase()
    const v = p.slice(eq + 1).trim()
    if (k === 'side') out.side = v
    else if (k === 'distance' || k === 'orbitdeg') {
      const n = Number(v)
      if (Number.isFinite(n)) out[k === 'orbitdeg' ? 'orbitDeg' : k] = n
    } else if (k === 'objectid') out.objectId = v
    else if (k === 'x' || k === 'z') {
      const n = Number(v)
      if (Number.isFinite(n)) out[k] = n
    }
  }
  return out
}

/** Keep commas that belong to `[look:1,1.4,-0.5]` instead of treating them as chain splits. */
export function splitChainParts(inner: string): string[] {
  const parts: string[] = []
  let buf = ''
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]!
    if (c !== ',') {
      buf += c
      continue
    }
    const behind = buf.trim().toLowerCase()
    const ahead = inner.slice(i + 1).trim()
    const inLook =
      behind.startsWith('look:') ||
      behind.startsWith('look ') ||
      /^look:[-\d.]+(?:,[-\d.]+)*$/.test(behind)
    const inWalkTo =
      behind.startsWith('walk:to=') ||
      behind.startsWith('teleport:') ||
      behind.startsWith('tp:')
    if ((inLook || inWalkTo) && /^-?\d/.test(ahead)) {
      buf += c
      continue
    }
    if (buf.trim()) parts.push(buf.trim())
    buf = ''
  }
  if (buf.trim()) parts.push(buf.trim())
  return parts
}

function resolveGestureId(token: string, gestures: Map<string, string>): string | null {
  const aliased = GESTURE_TOKEN_ALIASES[token] ?? token
  const hit = gestures.get(aliased)
  if (hit) return hit
  if (GESTURE_VARIANT_GROUPS[aliased]) return aliased
  if (GESTURE_TOKEN_ALIASES[token]) return aliased
  return null
}

const CHARACTER_KV_KEYS = new Set([
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
])

function faceLayersToStep(
  layers: FaceLayer[],
  catalog: InlineTagCatalog,
): InlineSequenceStep {
  const primary = layers[0]!
  const emotion = resolveEmotionExpression(primary.name, catalog.emotions) ?? primary.name
  return {
    op: 'set_emotion',
    emotion,
    intensity: primary.weight,
    faces: layers,
    fadeMs: FACE_FADE_IN_MS,
  }
}

function looksLikeFaceSpec(
  raw: string,
  catalog: InlineTagCatalog,
  maps: { emotions: Map<string, string>; expressions: Map<string, string> },
): FaceLayer[] | null {
  if (!raw.includes('=') && !raw.includes('+')) return null
  const kv = splitKv(raw)
  if (kv && CHARACTER_KV_KEYS.has(kv.key)) return null
  const layers = parseFaceLayers(raw)
  if (!layers.length) return null
  const available =
    catalog.emotions.length > 0
      ? catalog.emotions
      : ['neutral', 'happy', 'angry', 'sad', 'relaxed', 'surprised']
  const known = layers.some((layer) => {
    if (resolveEmotionExpression(layer.name, available)) return true
    if (maps.emotions.has(layer.name.toLowerCase())) return true
    if (maps.expressions.has(layer.name.toLowerCase())) return true
    return false
  })
  return known ? layers : null
}

function gestureFaceToStep(
  token: string,
  maps: { gestures: Map<string, string> },
): InlineSequenceStep | null {
  const parsed = parseGestureFaceToken(token)
  if (!parsed) return null
  const id =
    resolveGestureId(parsed.gesture.toLowerCase(), maps.gestures) ?? parsed.gesture
  const primary = parsed.layers[0]
  return {
    op: 'play_gesture',
    id,
    loop: false,
    emotion: primary?.name,
    intensity: primary?.weight,
    faces: parsed.layers,
    fadeMs: FACE_FADE_IN_MS,
  }
}

function tokenToStep(
  token: string,
  catalog: InlineTagCatalog,
  maps: {
    gestures: Map<string, string>
    moods: Map<string, string>
    emotions: Map<string, string>
    expressions: Map<string, string>
  },
): InlineSequenceStep | { loop: true } | null {
  const incoming = token.trim()
  if (!incoming) return null
  const split = splitTrailingSceneTarget(incoming)
  const body = split.body
  const sceneTarget = split.target
  const lower = body.toLowerCase()

  if (lower === 'loop') return { loop: true }

  if (lower === 'jump') return { op: 'jump' }

  const wait = parseWaitMs(lower)
  if (wait !== null) return { op: 'wait', ms: wait }

  const piped = gestureFaceToStep(body, maps)
  if (piped) {
    if (sceneTarget) piped.sceneTarget = sceneTarget
    return piped
  }

  const kv = splitKv(body)
  if (kv) {
    if (kv.key === 'mood' || kv.key === 'm') {
      const mood = maps.moods.get(kv.value.toLowerCase()) ?? kv.value
      return { op: 'set_mood', mood }
    }
    if (kv.key === 'walk') {
      return { op: 'walk', walkArgs: parseWalkTagValue(kv.value) }
    }
    if (kv.key === 'turn') {
      const degrees = Number(kv.value)
      return { op: 'turn', degrees: Number.isFinite(degrees) ? degrees : 0 }
    }
    if (kv.key === 'teleport' || kv.key === 'tp') {
      return { op: 'teleport', walkArgs: parseTeleportTagValue(kv.value), objectId: kv.value.split(',')[0]?.trim() }
    }
    if (kv.key === 'clothes' || kv.key === 'outfit' || kv.key === 'wear') {
      const ids = parseClothesIdList(kv.value)
      const selection = resolveClothesSelection({ ids })
      const clothesId = summarizeClothesSelection(selection)
      return {
        op: 'set_clothes',
        clothesId,
        clothesIds: selection.mode === 'items' ? selection.ids : undefined,
        id: clothesId,
      }
    }
    if (kv.key === 'emotion' || kv.key === 'e' || kv.key === 'face') {
      const layers = parseFaceLayers(kv.value)
      if (layers.length) return faceLayersToStep(layers, catalog)
      const emotion = resolveEmotionExpression(kv.value, catalog.emotions) ?? kv.value
      return { op: 'set_emotion', emotion, intensity: 0.4, fadeMs: FACE_FADE_IN_MS }
    }
    if (kv.key === 'gesture' || kv.key === 'g') {
      const piped = gestureFaceToStep(kv.value, maps)
      if (piped) return piped
      const id = resolveGestureId(kv.value.toLowerCase(), maps.gestures) ?? kv.value
      return { op: 'play_gesture', id, loop: false }
    }
    if (kv.key === 'look') {
      const parsed = parseLookAtTarget(kv.value)
      if (parsed === undefined) return { op: 'look_at', target: 'camera' }
      return {
        op: 'look_at',
        target: parsed,
        turn: parsed !== 'camera' && parsed !== null,
      }
    }
    if (kv.key === 'expr' || kv.key === 'expression') {
      const layers = parseFaceLayers(kv.value)
      if (layers.length) {
        const primary = layers[0]!
        return {
          op: 'set_expression',
          name: maps.expressions.get(primary.name.toLowerCase()) ?? primary.name,
          weight: primary.weight,
          faces: layers,
          fadeMs: FACE_FADE_IN_MS,
        }
      }
      const [name, weightRaw] = kv.value.split('=')
      const nameHit = maps.expressions.get((name ?? '').toLowerCase()) ?? name
      return {
        op: 'set_expression',
        name: nameHit,
        weight: weightRaw !== undefined ? parseFaceScore(weightRaw) : 0.4,
        fadeMs: FACE_FADE_IN_MS,
      }
    }
    if (kv.key === 'wait') {
      const ms = parseWaitMs(kv.value) ?? Number(kv.value)
      if (Number.isFinite(ms)) return { op: 'wait', ms }
    }
    if (kv.key === 'approach') {
      const parts = kv.value.split(',').map((p) => p.trim()).filter(Boolean)
      const target = parts[0] || kv.value
      let from: InlineSequenceStep['approachFrom']
      for (const p of parts.slice(1)) {
        const eq = p.indexOf('=')
        if (eq < 0) continue
        const k = p.slice(0, eq).trim().toLowerCase()
        const v = p.slice(eq + 1).trim().toLowerCase()
        if (k === 'from' || k === 'side') from = v as InlineSequenceStep['approachFrom']
      }
      return { op: 'approach', sceneTarget: target, objectId: target, approachFrom: from }
    }
    if (kv.key === 'turnto' || kv.key === 'turn_to') {
      return { op: 'turn_to', sceneTarget: kv.value, objectId: kv.value }
    }
    const asGesture = resolveGestureId(kv.key, maps.gestures)
    if (asGesture && looksLikeSceneRef(kv.value)) {
      return { op: 'play_gesture', id: asGesture, loop: false, sceneTarget: kv.value }
    }
  }

  const scoredFace = looksLikeFaceSpec(body, catalog, maps)
  if (scoredFace) return faceLayersToStep(scoredFace, catalog)

  const gesture = resolveGestureId(lower, maps.gestures)
  if (gesture) return { op: 'play_gesture', id: gesture, loop: false, sceneTarget }

  const moodOnly = maps.moods.get(lower)
  const emotionHit = maps.emotions.get(lower)
  if (moodOnly && !emotionHit && !gesture) {
    return { op: 'set_mood', mood: moodOnly }
  }

  const emotion = resolveEmotionExpression(body, catalog.emotions)
  if (emotion && maps.emotions.has(emotion.toLowerCase())) {
    return { op: 'set_emotion', emotion, intensity: 0.4, fadeMs: FACE_FADE_IN_MS }
  }
  if (moodOnly) return { op: 'set_mood', mood: moodOnly }

  const expr = maps.expressions.get(lower)
  if (expr) return { op: 'set_expression', name: expr, weight: 1 }

  if (lower === 'camera') return { op: 'look_at', target: 'camera' }

  // laugh / lough with no clip → happy face
  if (lower === 'laugh' || lower === 'lough' || lower === 'laughing') {
    return { op: 'set_emotion', emotion: 'happy', intensity: 0.4, fadeMs: FACE_FADE_IN_MS }
  }

  console.warn('[character-skill] unknown inline token', incoming)
  return null
}

function parseChain(inner: string, catalog: InlineTagCatalog): InlineSequenceStep[] {
  const maps = {
    gestures: lowerSet(catalog.gestures),
    moods: lowerSet(catalog.moods),
    emotions: lowerSet(catalog.emotions),
    expressions: lowerSet(catalog.expressions),
  }
  const parts = splitChainParts(inner)
  const steps: InlineSequenceStep[] = []
  for (const part of parts) {
    const step = tokenToStep(part, catalog, maps)
    if (!step) continue
    if (!('op' in step)) {
      const prev = [...steps].reverse().find((s) => s.op === 'play_gesture')
      if (prev) prev.loop = true
      continue
    }
    steps.push(step)
  }
  return steps
}

export function isFishAnnotation(inner: string): boolean {
  const t = inner.trim().toLowerCase()
  if (FISH_TTS_TAGS.has(t)) return true
  if (t.includes(',') || t.includes('|') || t.includes('=')) return false
  // Reject breath/laugh spam — Fish turns these into long non-lexical audio.
  if (/(heh|hah|haha|hash|huh|eee|ahh|umm|lol|hehe|huhu|\blaugh)/i.test(t)) return false
  // Short emotion phrases only: [warm and happy], [slightly sad]
  if (!/^[a-z]+(?:[\s-][a-z]+){1,3}$/.test(t)) return false
  return /(happy|sad|angry|calm|warm|soft|gentle|nervous|excited|confident|surprised|worried|proud|curious|hopeful|scared|upset|tired|bright|quiet|loud|empathetic|embarrassed|grateful|sarcastic|determined|relaxed|delighted|satisfied|frustrated)/i.test(
    t,
  )
}

function isCharacterBracket(inner: string, catalog: InlineTagCatalog): boolean {
  const t = inner.trim()
  if (t.includes(',') || t.includes('|')) return true
  if (parseWaitMs(t) !== null) return true
  if (splitKv(t)) return true
  const maps = {
    gestures: lowerSet(catalog.gestures),
    moods: lowerSet(catalog.moods),
    emotions: lowerSet(catalog.emotions),
    expressions: lowerSet(catalog.expressions),
  }
  const step = tokenToStep(t, catalog, maps)
  return Boolean(step && !('loop' in step && !('op' in step)))
}

function badgeKind(steps: InlineSequenceStep[]): InlineTagBadge['kind'] {
  if (steps.length > 1) return 'chain'
  const op = steps[0]?.op
  if (op === 'play_gesture') return 'gesture'
  if (op === 'set_emotion') return 'emotion'
  if (op === 'set_mood') return 'mood'
  if (op === 'set_clothes') return 'clothes'
  if (op === 'wait') return 'wait'
  if (op === 'look_at') return 'look'
  if (op === 'set_expression') return 'expression'
  if (op === 'walk') return 'walk'
  if (op === 'turn') return 'turn'
  if (op === 'jump') return 'jump'
  if (op === 'teleport') return 'teleport'
  return 'chain'
}

function stripMatch(text: string, start: number, end: number): string {
  return (text.slice(0, start) + text.slice(end)).replace(/[ \t]+\n/g, '\n')
}

/**
 * Parse compact [nod,2s,laugh] cues + legacy CHARACTER:{…} lines.
 * Character tags are stripped from display and TTS. Fish annotations stay in TTS.
 */
export function parseInlineTags(
  content: string,
  catalog: InlineTagCatalog,
  opts: { enabled?: boolean } = {},
): ParsedInlineTags {
  const enabled = opts.enabled !== false
  const empty: ParsedInlineTags = {
    displayText: content,
    ttsText: content,
    withSpeech: [],
    afterTts: [],
    badges: [],
    timedCues: [],
  }
  if (!enabled || !content) return empty

  type Hit = {
    start: number
    end: number
    raw: string
    kind: 'character' | 'fish' | 'json'
    steps: InlineSequenceStep[]
  }

  const hits: Hit[] = []

  for (const m of content.matchAll(CHARACTER_JSON_RE)) {
    if (m.index === undefined) continue
    try {
      const obj = JSON.parse(m[1]!) as {
        emotion?: string
        gesture?: string
        look?: 'camera' | null
        loop?: boolean
        intensity?: number
      }
      const steps: InlineSequenceStep[] = []
      if (obj.emotion) {
        steps.push({
          op: 'set_emotion',
          emotion: obj.emotion,
          intensity: obj.intensity !== undefined ? parseFaceScore(obj.intensity) : 0.4,
        })
      }
      if (obj.gesture) {
        steps.push({ op: 'play_gesture', id: obj.gesture, loop: Boolean(obj.loop) })
      }
      if (obj.look !== undefined) {
        steps.push({ op: 'look_at', target: obj.look === 'camera' ? 'camera' : null })
      }
      hits.push({
        start: m.index,
        end: m.index + m[0].length,
        raw: m[0],
        kind: 'json',
        steps,
      })
    } catch {
      /* ignore */
    }
  }

  for (const m of content.matchAll(BRACKET_RE)) {
    if (m.index === undefined) continue
    const inner = m[1] ?? ''
    const raw = m[0]
    if (isFishAnnotation(inner) && !inner.includes(',') && !inner.includes('|') && !inner.includes('=')) {
      hits.push({
        start: m.index,
        end: m.index + raw.length,
        raw,
        kind: 'fish',
        steps: [],
      })
      continue
    }
    if (!isCharacterBracket(inner, catalog)) continue
    const steps = parseChain(inner, catalog)
    hits.push({
      start: m.index,
      end: m.index + raw.length,
      raw,
      kind: 'character',
      steps,
    })
  }

  hits.sort((a, b) => a.start - b.start)
  // drop overlapping (JSON vs brackets)
  const filtered: Hit[] = []
  let lastEnd = -1
  for (const h of hits) {
    if (h.start < lastEnd) continue
    filtered.push(h)
    lastEnd = h.end
  }

  const spokenLen = content.length
  const isWs = (i: number) => i >= 0 && i < spokenLen && /\s/.test(content[i]!)

  const trailing: Hit[] = []
  {
    let cursor = spokenLen
    while (cursor > 0 && isWs(cursor - 1)) cursor--
    for (let i = filtered.length - 1; i >= 0; i--) {
      const h = filtered[i]!
      if (h.kind === 'fish' && h.steps.length === 0) break
      if (h.end > cursor) continue
      if (content.slice(h.end, cursor).trim() !== '') break
      trailing.unshift(h)
      cursor = h.start
      while (cursor > 0 && isWs(cursor - 1)) cursor--
    }
  }
  const trailingSet = new Set(trailing)

  const leading: Hit[] = []
  {
    let cursor = 0
    while (cursor < spokenLen && isWs(cursor)) cursor++
    for (const h of filtered) {
      if (trailingSet.has(h)) break
      if (h.kind === 'fish' && h.steps.length === 0) {
        if (h.start <= cursor) {
          cursor = h.end
          while (cursor < spokenLen && isWs(cursor)) cursor++
        }
        continue
      }
      if (content.slice(cursor, h.start).trim() !== '') break
      leading.push(h)
      cursor = h.end
      while (cursor < spokenLen && isWs(cursor)) cursor++
    }
  }
  const leadingSet = new Set(leading)

  const withSpeech: InlineSequenceStep[] = []
  const afterTts: InlineSequenceStep[] = []
  const badges: InlineTagBadge[] = []

  for (const h of filtered) {
    const placement: InlineTagBadge['placement'] = trailingSet.has(h)
      ? 'end'
      : leadingSet.has(h)
        ? 'start'
        : 'mid'
    if (h.kind === 'fish') {
      badges.push({ raw: h.raw, kind: 'fish', placement })
      if (h.steps.length) {
        if (trailingSet.has(h)) afterTts.push(...h.steps)
        else withSpeech.push(...h.steps)
      }
      continue
    }
    badges.push({
      raw: h.raw,
      kind: badgeKind(h.steps),
      placement,
    })
    if (trailingSet.has(h)) afterTts.push(...h.steps)
    else withSpeech.push(...h.steps)
  }

  // Rebuild display (strip character + fish) and tts (strip character only)
  let displayText = content
  let ttsText = content
  for (const h of [...filtered].sort((a, b) => b.start - a.start)) {
    displayText = stripMatch(displayText, h.start, h.end)
    if (h.kind !== 'fish') ttsText = stripMatch(ttsText, h.start, h.end)
  }

  displayText = displayText.replace(/\n{3,}/g, '\n\n').trim()
  ttsText = ttsText.replace(/\n{3,}/g, '\n\n').trim()

  // Map original hit starts → indices in ttsText (character tags removed, Fish kept).
  const timedCues: TimedInlineCue[] = []
  {
    const charHits = filtered
      .filter((h) => h.kind !== 'fish' && h.steps.length > 0)
      .sort((a, b) => a.start - b.start)
    for (const h of charHits) {
      let removedBefore = 0
      for (const other of filtered) {
        if (other.kind === 'fish') continue
        if (other.end <= h.start) removedBefore += other.end - other.start
      }
      const ttsIndex = Math.max(0, h.start - removedBefore)
      const placement: TimedInlineCue['placement'] = trailingSet.has(h)
        ? 'end'
        : leadingSet.has(h)
          ? 'start'
          : 'mid'
      const locomotion = h.steps.some(
        (s) =>
          s.op === 'walk' ||
          s.op === 'approach' ||
          s.op === 'teleport' ||
          s.op === 'turn' ||
          s.op === 'jump' ||
          s.op === 'turn_to',
      )
      timedCues.push({ ttsIndex, placement, steps: h.steps, locomotion })
    }
  }

  if (badges.length) {
    console.info('[character-skill] inline tags', {
      withSpeech: withSpeech.length,
      afterTts: afterTts.length,
      timedCues: timedCues.length,
      badges: badges.map((b) => b.raw),
    })
  }

  return { displayText, ttsText, withSpeech, afterTts, badges, timedCues }
}

export function defaultInlineCatalog(): InlineTagCatalog {
  return {
    gestures: [
      'idle',
      'wave',
      'nod',
      'think',
      'talk',
      'sad',
      'agree',
      'disagree',
      'look_around',
      'laugh',
      ...Object.keys(GESTURE_VARIANT_GROUPS),
    ],
    moods: listPresenceMoods().map((m) => m.id),
    emotions: ['neutral', 'happy', 'angry', 'sad', 'relaxed', 'surprised'],
    expressions: [],
    clothes: ['none', 'default'],
  }
}
