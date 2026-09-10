import { envFlag } from './env'
import type { ChatMessage } from './hermes'
import {
  compactClothesTransform,
  DEFAULT_GAZE_LIMITS,
  DEFAULT_NOD_TIME_SCALE,
  normalizeClothesTransform,
  type ClothesPieceTransform,
  type PresenceMoodId,
} from '@openclaw/character-kit'
import { CHAT_COLUMN_DEFAULT_PX, CHAT_COLUMN_MIN_PX } from './split-resize'
import { DEFAULT_CHAT_MODEL, migrateChatModel } from './openrouter-models'
import { catalogIdFromUrl } from './demo-mode'
import { seedWardrobe, type AgentWardrobe } from './wardrobe'
import { DEFAULT_ZOOM_IN_GESTURE, DEFAULT_ZOOM_OUT_GESTURE } from './ack-target'
import { newId } from './id'
import { LLM_PROXY, migrateLegacyHermesBaseUrl } from './llm-endpoint'

export type { AgentWardrobe } from './wardrobe'

export interface ClothesOverlayItemSave {
  sourceId: string
  itemId: string
  transform?: Partial<ClothesPieceTransform>
}

export interface AgentPane {
  id: string
  label: string
  baseUrl: string
  apiKey: string
  model: string
  sessionId: string
  messages: ChatMessage[]
  vocabulary: string[]
  lastTrustUrl?: string
  lastErrorKind?: 'ssl' | 'network' | 'http' | null
  /** Ambient presence mood while this agent is active (persisted). */
  defaultMood?: PresenceMoodId | string
  /** VRM model URL for this agent (persisted). */
  vrmUrl?: string
  /** Legacy single clothes catalog id (migrated to clothesIds / overlay). */
  clothesId?: string
  /** Native slot ids to show. `undefined` = all (default); `[]` = none. */
  clothesIds?: string[]
  /**
   * Overlay character whose addable clothes are shown in the picker.
   * Switching this only refilters the list; it does not clear `clothesOverlayItems`.
   */
  clothesOverlayId?: string
  /** Additive overlay pieces mixed onto this agent (any overlay sources). */
  clothesOverlayItems?: ClothesOverlayItemSave[]
  /** Native + overlay clothes keyed by VRM catalog id (per bot, per model). */
  wardrobeByModel?: Record<string, AgentWardrobe>
  /** Nod (or other gesture) on every page click. Default true. */
  clickAckEnabled?: boolean
  /** Gesture id for click ack (default nod). */
  clickAckGesture?: string
  /** Playback speed multiplier for click ack (default 1). */
  clickAckSpeed?: number
  /** Gesture on canvas zoom in/out. Default true. */
  zoomAckEnabled?: boolean
  /** Zoom-in gesture (default v_sign). */
  zoomInGesture?: string
  /** Zoom-out gesture (default wave). */
  zoomOutGesture?: string
}

export interface PlaygroundSettings {
  sttProvider: 'browser-whisper' | 'speaches'
  whisperModel: string
  speachesUrl: string
  speachesKey: string
  fishApiKey: string
  fishReferenceId: string
  ttsEnabled: boolean
  /** hermes = server agent (no client tools). tools = OpenRouter-style tool_calls for VRM. */
  llmRuntime: 'tools' | 'hermes'
  openrouterApiKey: string
  openrouterBaseUrl: string
  /** Global fallback when a pane has no vrmUrl */
  vrmUrl: string
  gestureManifestUrl: string
  /** Compact [nod,2s,wave] tags in assistant text. Default true (VITE_INLINE_CHARACTER_TAGS). */
  inlineCharacterTags: boolean
  /** Show stripped motion/Fish tags as badges on messages. */
  debugCharacterTags: boolean
  /** Short persona; tool + Fish guides are appended at runtime */
  systemPrompt: string
  /** Chat column width in px; 3D stage fills the rest. */
  chatColumnPx: number
  /** Follow pointer across the browser window (eyes + head yaw). Default true. */
  pointerLook: boolean
  /** Yaw hips toward the camera as it orbits. Default false. Shared across agents. */
  bodyFollowCamera: boolean
  /** Max head turn toward mouse (degrees). Eyes may go further. */
  gazeHeadYawMaxDeg: number
  /** Max eye aim toward mouse (degrees). */
  gazeEyeYawMaxDeg: number
  /** Restrict the VRM picker to the public demo list. */
  demoMode: boolean
}

/** Bundled VRM options for the per-agent dropdown. */
export const VRM_CATALOG: Array<{ id: string; label: string; url: string }> = [
  { id: 'sample', label: 'Sample (pixiv)', url: '/assets/vrm/sample.vrm' },
  { id: 'optional-face', label: 'Optional Face', url: '/assets/vrm/optional-face.vrm' },
  { id: 'blue-or-green', label: 'Blue or Green', url: '/assets/vrm/blue-or-green.vrm' },
  { id: 'cat-ear', label: 'Cat Ear', url: '/assets/vrm/cat-ear.vrm' },
  { id: 'divitiae-animalia', label: 'Divitiae Animalia', url: '/assets/vrm/divitiae-animalia.vrm' },
  { id: 'hoodie', label: 'Hoodie', url: '/assets/vrm/hoodie.vrm' },
  { id: 'animal-path', label: 'Animal Path', url: '/assets/vrm/animal-path.vrm' },
  { id: 'tori', label: 'Tori', url: '/assets/vrm/tori.vrm' },
  { id: 'curt', label: 'Curt', url: '/assets/vrm/curt.vrm' },
  { id: 'apollo', label: 'Apollo', url: '/assets/vrm/apollo.vrm' },
  { id: 'bob', label: 'Bob', url: '/assets/vrm/bob.vrm' },
]

/** Outfit overlays: VRoid-style models with clothing meshes (not chibi animals). */
const CLOTHES_OVERLAY_IDS = new Set([
  'sample',
  'optional-face',
  'blue-or-green',
  'cat-ear',
  'divitiae-animalia',
  'hoodie',
])

/** Bundled outfits: none, this model's default clothes, or another VRM's clothing overlay. */
export const CLOTHES_NONE_ID = 'none'
export const CLOTHES_DEFAULT_ID = 'default'

export const CLOTHES_OVERLAY_CATALOG: Array<{ id: string; label: string; url: string }> =
  VRM_CATALOG.filter((v) => CLOTHES_OVERLAY_IDS.has(v.id))

/** @deprecated use native slot checkboxes + CLOTHES_OVERLAY_CATALOG */
export const CLOTHES_CATALOG: Array<{ id: string; label: string; url: string | null }> = [
  { id: CLOTHES_NONE_ID, label: 'None', url: null },
  { id: CLOTHES_DEFAULT_ID, label: 'Default', url: null },
  ...CLOTHES_OVERLAY_CATALOG,
]

export const MOOD_CATALOG: Array<{ id: string; label: string }> = [
  { id: 'neutral', label: 'Neutral' },
  { id: 'relaxed', label: 'Relaxed' },
  { id: 'happy', label: 'Happy' },
  { id: 'playful', label: 'Playful' },
  { id: 'curious', label: 'Curious' },
  { id: 'focused', label: 'Focused' },
  { id: 'tired', label: 'Tired' },
  { id: 'sad', label: 'Sad' },
  { id: 'excited', label: 'Excited' },
]

const SETTINGS_KEY = 'dev-vrm.playground.settings.v3'
const PANES_KEY = 'dev-vrm.playground.panes.v3'
const ACTIVE_PANE_KEY = 'dev-vrm.playground.active-pane.v1'

/** Previous default — rewritten on load to `{agent}` so tabs are not named after a mesh. */
export const LEGACY_XENI_SYSTEM_PROMPT =
  'You are Xeni, a helpful VRM companion. Prefer compact [nod] / [mood:playful] tags for simple motion; use character_* tools only for complex sequences. Keep spoken replies concise (1–4 sentences).'

export const DEFAULT_SYSTEM_PROMPT =
  'You are {agent}, a helpful VRM companion. Prefer compact [nod] / [mood:playful] tags for simple motion; use character_* tools only for complex sequences. Keep spoken replies concise (1–4 sentences).'

export const defaultSettings = (): PlaygroundSettings => ({
  sttProvider: 'browser-whisper',
  whisperModel: 'Xenova/whisper-base.en',
  speachesUrl: '/api/speaches',
  speachesKey: '',
  fishApiKey: '',
  fishReferenceId: '',
  ttsEnabled: false,
  inlineCharacterTags: envFlag('VITE_INLINE_CHARACTER_TAGS', true),
  debugCharacterTags: envFlag('VITE_DEBUG_CHARACTER_TAGS', false),
  llmRuntime: 'tools',
  openrouterApiKey: '',
  openrouterBaseUrl: 'https://openrouter.ai/api/v1',
  vrmUrl: '/assets/vrm/sample.vrm',
  gestureManifestUrl: '/assets/vrma/manifest.json',
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  chatColumnPx: CHAT_COLUMN_DEFAULT_PX,
  pointerLook: true,
  bodyFollowCamera: false,
  gazeHeadYawMaxDeg: DEFAULT_GAZE_LIMITS.headYawMaxDeg,
  gazeEyeYawMaxDeg: DEFAULT_GAZE_LIMITS.eyeYawMaxDeg,
  demoMode: false,
})

export function loadSettings(): PlaygroundSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY) ?? localStorage.getItem('dev-vrm.playground.settings.v2')
    if (!raw) return defaultSettings()
    const merged = { ...defaultSettings(), ...JSON.parse(raw) } as PlaygroundSettings
    if (/CHARACTER:/.test(merged.systemPrompt) || merged.systemPrompt === LEGACY_XENI_SYSTEM_PROMPT) {
      merged.systemPrompt = defaultSettings().systemPrompt
    }
    if (merged.inlineCharacterTags === undefined) {
      merged.inlineCharacterTags = envFlag('VITE_INLINE_CHARACTER_TAGS', true)
    }
    if (merged.debugCharacterTags === undefined) {
      merged.debugCharacterTags = envFlag('VITE_DEBUG_CHARACTER_TAGS', false)
    }
    if (!merged.vrmUrl || merged.vrmUrl === '/assets/vrm/xeni.vrm') {
      merged.vrmUrl = '/assets/vrm/sample.vrm'
    }
    if (!Number.isFinite(merged.chatColumnPx) || merged.chatColumnPx < CHAT_COLUMN_MIN_PX) {
      merged.chatColumnPx = CHAT_COLUMN_DEFAULT_PX
    }
    if (merged.pointerLook === undefined) merged.pointerLook = true
    merged.bodyFollowCamera = merged.bodyFollowCamera === true
    if (!Number.isFinite(merged.gazeHeadYawMaxDeg) || merged.gazeHeadYawMaxDeg === 35) {
      merged.gazeHeadYawMaxDeg = DEFAULT_GAZE_LIMITS.headYawMaxDeg
    }
    if (!Number.isFinite(merged.gazeEyeYawMaxDeg) || merged.gazeEyeYawMaxDeg === 55) {
      merged.gazeEyeYawMaxDeg = DEFAULT_GAZE_LIMITS.eyeYawMaxDeg
    }
    if (merged.demoMode === undefined) merged.demoMode = false
    return merged
  } catch {
    return defaultSettings()
  }
}

export function saveSettings(s: PlaygroundSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
}

export function newPane(partial?: Partial<AgentPane>): AgentPane {
  const id = newId()
  return {
    id,
    label: partial?.label ?? 'Agent',
    baseUrl: partial?.baseUrl ?? LLM_PROXY,
    apiKey: partial?.apiKey ?? '',
    model: migrateChatModel(partial?.model) || DEFAULT_CHAT_MODEL,
    sessionId: partial?.sessionId ?? newId(),
    messages: partial?.messages ?? [],
    vocabulary: partial?.vocabulary ?? ['Agent', 'OpenClaw'],
    lastTrustUrl: partial?.lastTrustUrl,
    lastErrorKind: partial?.lastErrorKind ?? null,
    defaultMood: partial?.defaultMood ?? 'neutral',
    vrmUrl: partial?.vrmUrl ?? '/assets/vrm/sample.vrm',
    clothesId: partial?.clothesId ?? CLOTHES_DEFAULT_ID,
    clothesIds: partial?.clothesIds,
    clothesOverlayId: partial?.clothesOverlayId,
    clothesOverlayItems: partial?.clothesOverlayItems,
    wardrobeByModel: partial?.wardrobeByModel,
    clickAckEnabled: partial?.clickAckEnabled !== false,
    clickAckGesture: partial?.clickAckGesture ?? 'nod',
    clickAckSpeed: Number.isFinite(partial?.clickAckSpeed)
      ? Number(partial?.clickAckSpeed)
      : DEFAULT_NOD_TIME_SCALE,
    zoomAckEnabled: partial?.zoomAckEnabled !== false,
    zoomInGesture: partial?.zoomInGesture ?? DEFAULT_ZOOM_IN_GESTURE,
    zoomOutGesture: partial?.zoomOutGesture ?? DEFAULT_ZOOM_OUT_GESTURE,
  }
}

export function defaultPanes(apiKeys: { a?: string; b?: string } = {}): AgentPane[] {
  return [
    newPane({
      label: 'Agent A',
      baseUrl: LLM_PROXY,
      apiKey: apiKeys.a ?? '',
      model: DEFAULT_CHAT_MODEL,
      defaultMood: 'curious',
      vrmUrl: '/assets/vrm/sample.vrm',
    }),
    newPane({
      label: 'Agent B',
      baseUrl: LLM_PROXY,
      apiKey: apiKeys.b ?? '',
      model: DEFAULT_CHAT_MODEL,
      defaultMood: 'focused',
      vrmUrl: '/assets/vrm/sample.vrm',
    }),
  ]
}

function overlayFromPane(p: AgentPane): string | undefined {
  if (p.clothesOverlayId) return p.clothesOverlayId
  const old = CLOTHES_OVERLAY_CATALOG.find((c) => c.id === p.clothesId)
  return old?.id
}

function migrateClothesIds(p: AgentPane): string[] | undefined {
  if (Array.isArray(p.clothesIds)) return p.clothesIds
  const id = p.clothesId
  if (!id || id === CLOTHES_DEFAULT_ID) return undefined
  if (id === CLOTHES_NONE_ID) return []
  if (CLOTHES_OVERLAY_CATALOG.some((c) => c.id === id)) return undefined
  return id.split(/[+|,;]+/).map((s) => s.trim()).filter(Boolean)
}

function summarizeNativeClothesId(clothesIds: string[] | undefined, clothesId?: string): string {
  if (clothesIds && clothesIds.length === 0) return CLOTHES_NONE_ID
  if (clothesIds && clothesIds.length) return clothesIds.join('+')
  if (!clothesId || CLOTHES_OVERLAY_CATALOG.some((c) => c.id === clothesId)) {
    return CLOTHES_DEFAULT_ID
  }
  return clothesId
}

function normalizeOverlayItems(raw: unknown): ClothesOverlayItemSave[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const catalog = new Set(CLOTHES_OVERLAY_CATALOG.map((c) => c.id))
  const out: ClothesOverlayItemSave[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const rec = item as { sourceId?: unknown; itemId?: unknown; transform?: unknown }
    const sourceId = String(rec.sourceId ?? '').trim()
    const itemId = String(rec.itemId ?? '').trim()
    if (!sourceId || !itemId || !catalog.has(sourceId)) continue
    const key = `${sourceId}::${itemId}`
    if (seen.has(key)) continue
    seen.add(key)
    const transform = compactClothesTransform(
      normalizeClothesTransform(rec.transform as Partial<ClothesPieceTransform> | undefined),
    )
    out.push(transform ? { sourceId, itemId, transform } : { sourceId, itemId })
  }
  return out.length ? out : undefined
}

function normalizePane(p: AgentPane, fallbackVrm: string): AgentPane {
  const baseUrl = migrateLegacyHermesBaseUrl(p.baseUrl)
  const clothesOverlayId = overlayFromPane(p)
  const clothesIds = migrateClothesIds(p)
  const clothesId = summarizeNativeClothesId(clothesIds, p.clothesId)
  const vrmUrl = p.vrmUrl || fallbackVrm
  const clothesOverlayItems = normalizeOverlayItems(p.clothesOverlayItems)
  const seeded = seedWardrobe(
    {
      ...p,
      vrmUrl,
      clothesId,
      clothesIds,
      clothesOverlayId,
      clothesOverlayItems,
      wardrobeByModel: normalizeWardrobeMap(p.wardrobeByModel),
    },
    catalogIdFromUrl(vrmUrl, VRM_CATALOG),
  )
  return {
    ...p,
    baseUrl,
    defaultMood: p.defaultMood ?? 'neutral',
    vrmUrl,
    clothesId,
    clothesIds,
    clothesOverlayId,
    clothesOverlayItems: seeded.clothesOverlayItems,
    wardrobeByModel: seeded.wardrobeByModel,
    model: migrateChatModel(p.model),
    clickAckEnabled: p.clickAckEnabled !== false,
    clickAckGesture: (p.clickAckGesture || 'nod').trim() || 'nod',
    clickAckSpeed: normalizeClickAckSpeed(p.clickAckSpeed),
    zoomAckEnabled: p.zoomAckEnabled !== false,
    zoomInGesture: (p.zoomInGesture || DEFAULT_ZOOM_IN_GESTURE).trim() || DEFAULT_ZOOM_IN_GESTURE,
    zoomOutGesture: (p.zoomOutGesture || DEFAULT_ZOOM_OUT_GESTURE).trim() || DEFAULT_ZOOM_OUT_GESTURE,
  }
}

function normalizeClickAckSpeed(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n)) return DEFAULT_NOD_TIME_SCALE
  return Math.min(3, Math.max(0.35, n))
}

function normalizeWardrobeMap(raw: unknown): Record<string, AgentWardrobe> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const out: Record<string, AgentWardrobe> = {}
  for (const [key, slot] of Object.entries(raw as Record<string, AgentWardrobe>)) {
    if (!key.trim() || !slot || typeof slot !== 'object') continue
    out[key] = {
      clothesId: slot.clothesId,
      clothesIds: Array.isArray(slot.clothesIds) ? slot.clothesIds : undefined,
      clothesOverlayId: slot.clothesOverlayId,
      clothesOverlayItems: normalizeOverlayItems(slot.clothesOverlayItems),
    }
  }
  return Object.keys(out).length ? out : undefined
}

export function loadPanes(): AgentPane[] {
  const fallbackVrm = loadSettings().vrmUrl
  try {
    const raw =
      localStorage.getItem(PANES_KEY) ??
      localStorage.getItem('dev-vrm.playground.panes.v2')
    if (!raw) return defaultPanes()
    const parsed = JSON.parse(raw) as AgentPane[]
    return parsed.map((p) => normalizePane(p, fallbackVrm))
  } catch {
    return defaultPanes()
  }
}

export function savePanes(panes: AgentPane[]): void {
  localStorage.setItem(PANES_KEY, JSON.stringify(panes))
}

export interface SavedActivePane {
  id: string
  label: string
}

export function loadActivePaneId(panes: AgentPane[]): string {
  const fallback = panes[0]?.id ?? ''
  if (!panes.length) return ''
  try {
    const raw = localStorage.getItem(ACTIVE_PANE_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<SavedActivePane>
    const id = typeof parsed.id === 'string' ? parsed.id : ''
    if (id && panes.some((p) => p.id === id)) return id
    const label = typeof parsed.label === 'string' ? parsed.label.trim().toLowerCase() : ''
    if (label) {
      const match = panes.find((p) => p.label.trim().toLowerCase() === label)
      if (match) return match.id
    }
  } catch {
    /* keep fallback */
  }
  return fallback
}

export function saveActivePane(pane: Pick<AgentPane, 'id' | 'label'> | undefined): void {
  if (!pane) return
  localStorage.setItem(
    ACTIVE_PANE_KEY,
    JSON.stringify({ id: pane.id, label: pane.label } satisfies SavedActivePane),
  )
}

export function resolvePaneVrmUrl(pane: AgentPane | undefined, settings: PlaygroundSettings): string {
  return pane?.vrmUrl || settings.vrmUrl || '/assets/vrm/sample.vrm'
}

export function resolvePaneClothes(pane: AgentPane | undefined): {
  id: string
  ids: string[] | undefined
  overlayPieces: Array<{
    sourceId: string
    sourceUrl: string
    itemId: string
    transform?: Partial<ClothesPieceTransform>
  }>
} {
  const overlayPieces = (pane?.clothesOverlayItems ?? [])
    .map((p) => {
      const src = CLOTHES_OVERLAY_CATALOG.find((c) => c.id === p.sourceId)
      if (!src) return null
      return {
        sourceId: p.sourceId,
        sourceUrl: src.url,
        itemId: p.itemId,
        transform: p.transform,
      }
    })
    .filter((p): p is NonNullable<typeof p> => p != null)

  if (pane?.clothesIds) {
    const id =
      pane.clothesIds.length === 0 ? CLOTHES_NONE_ID : pane.clothesIds.join('+')
    return { id, ids: pane.clothesIds, overlayPieces }
  }
  const rawId = pane?.clothesId || CLOTHES_DEFAULT_ID
  if (rawId === CLOTHES_NONE_ID) return { id: rawId, ids: [], overlayPieces }
  if (CLOTHES_OVERLAY_CATALOG.some((c) => c.id === rawId)) {
    return { id: CLOTHES_DEFAULT_ID, ids: undefined, overlayPieces }
  }
  return { id: rawId, ids: undefined, overlayPieces }
}
