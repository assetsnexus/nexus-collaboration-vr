<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import AudioDock from './components/AudioDock.vue'
import AgentAddDialog from './components/AgentAddDialog.vue'
import AgentEditDialog from './components/AgentEditDialog.vue'
import AgentTabMenu from './components/AgentTabMenu.vue'
import CharacterViewport from './components/CharacterViewport.vue'
import ChatPane from './components/ChatPane.vue'
import ClothesPicker from './components/ClothesPicker.vue'
import MotionDebugOverlay from './components/MotionDebugOverlay.vue'
import {
  filesToContentParts,
  hermesChat,
  hermesHealth,
  hermesTrustUrl,
  HermesFetchError,
  type ChatMessage,
} from './lib/hermes'
import { buildCharacterSystemPrompt } from './lib/fish-annotations'
import { applyAgentIdentity, vrmLabelFromUrl } from './lib/agent-identity'
import { formatAvatarSnapshot } from './lib/avatar-snapshot'
import { paneUsesHermesChat, playgroundFetchBase, resolveToolsEndpoint } from './lib/llm-endpoint'
import { toolsChat } from './lib/tools-llm'
import {
  loadPanes,
  loadSettings,
  loadActivePaneId,
  newPane,
  resolvePaneClothes,
  resolvePaneVrmUrl,
  savePanes,
  saveSettings,
  saveActivePane,
  CLOTHES_OVERLAY_CATALOG,
  MOOD_CATALOG,
  VRM_CATALOG,
  type AgentPane,
  type ClothesOverlayItemSave,
  type PlaygroundSettings,
} from './lib/storage'
import {
  catalogIdFromUrl,
  demoFallbackUrl,
  filterDemoCatalog,
} from './lib/demo-mode'
import { mergeClothesIntoWardrobe, switchPaneVrm } from './lib/wardrobe'
import {
  CHAT_COLUMN_DEFAULT_PX,
  CHAT_COLUMN_KEY_STEP_PX,
  CHAT_COLUMN_MIN_PX,
  chatWidthFromPointer,
  clampChatColumnPx,
  chatSplitGapPx,
} from './lib/split-resize'
import {
  ACTION_FEED_MAX,
  AnimationDirector,
  CHARACTER_SKILL,
  compactClothesTransform,
  defaultInlineCatalog,
  isDeferredCharacterTool,
  isImmediateCharacterTool,
  DEFAULT_NOD_TIME_SCALE,
  listClothesFromVrmBuffer,
  listLogicalGestureIds,
  listPresenceMoods,
  normalizeClothesTransform,
  parseInlineTags,
  resolveCharacterToolName,
  type CharacterActionEvent,
  type CharacterController,
  type ClothesItem,
  type ClothesPieceTransform,
  type ExpressionInfo,
  groupClothesByCategory,
  type InlineTagCatalog,
  type PresenceMoodDef,
} from '@openclaw/character-kit'
import {
  BrowserWhisperStt,
  SpeachesStt,
  FishTts,
  createSileroVadSession,
  playViaAudioContext,
  vadPcmToWavBlob,
  type SttProvider,
  type VadFrameInfo,
  type VadSession,
} from '@openclaw/voice-kit'
import { readAnalyserRms, speechEnergy } from './lib/audio-meter'
import {
  chromeAfterFullscreenChange,
  exitStageFullscreen,
  isImmersive,
  isStageFullscreen,
  requestStageFullscreen,
} from './lib/immersive'
import { PushToTalkRecorder, pttShouldArm, type PttStopReason } from './lib/ptt'
import {
  logAgentExport,
  readClipboardText,
  stringifyAgentExport,
  writeClipboardText,
  type AgentExportConfig,
} from './lib/agent-export'
import { newId } from './lib/id'

const settings = reactive<PlaygroundSettings>(loadSettings())
const panes = ref<AgentPane[]>(loadPanes())

function modelKeyForPane(pane: AgentPane | undefined): string {
  return catalogIdFromUrl(pane?.vrmUrl || settings.vrmUrl, VRM_CATALOG)
}

function applyDemoModelFilter(list: AgentPane[]): AgentPane[] {
  const allowed = new Set(filterDemoCatalog(VRM_CATALOG, true).map((v) => v.url))
  const fallback = demoFallbackUrl(VRM_CATALOG)
  return list.map((pane) => {
    const url = pane.vrmUrl || settings.vrmUrl
    if (!url || allowed.has(url)) return pane
    return switchPaneVrm(pane, fallback, modelKeyForPane(pane), catalogIdFromUrl(fallback, VRM_CATALOG))
  })
}

if (settings.demoMode) {
  panes.value = applyDemoModelFilter(panes.value)
}

const envLlm = import.meta.env.VITE_LLM_API_KEY as string | undefined
const envOr = import.meta.env.VITE_OPENROUTER_API_KEY as string | undefined
for (const p of panes.value) {
  if (!p.apiKey && envLlm) p.apiKey = envLlm
}
if (!settings.openrouterApiKey && envOr) settings.openrouterApiKey = envOr

const activePaneId = ref(loadActivePaneId(panes.value))
saveActivePane(panes.value.find((p) => p.id === activePaneId.value))
const busy = ref(false)
const chatWaitHint = ref('')
const voiceStatus = ref('mic off')
const lastTranscript = ref('')
const showSettings = ref(false)
const showAddAgent = ref(false)
const addClipboardText = ref('')
const editPaneId = ref<string | null>(null)
const editStartTab = ref<'form' | 'json'>('form')
const tabMenu = ref<{ paneId: string; x: number; y: number } | null>(null)
const toast = ref('')
let toastTimer = 0
const showAgentConfig = ref(false)
const showMotionDebug = ref(false)
const motionDebugGestures = ref<string[]>([])
const motionDebugExpressions = ref<ExpressionInfo[]>([])
const motionDebugMoods = ref<PresenceMoodDef[]>(listPresenceMoods())
const motionDebugMoodId = ref('neutral')
const motionDebugLog = ref('')
const motionDebugLoop = ref(false)
const motionActionFeed = ref<CharacterActionEvent[]>([])
/** Continuous voice call (VAD → STT → chat → TTS). */
const inCall = ref(false)
const callStatus = ref('')
const callPaneId = ref<string | null>(null)
let callTurnBusy = false
const viewportRef = ref<InstanceType<typeof CharacterViewport> | null>(null)
const workspaceEl = ref<HTMLElement | null>(null)
const stageRootEl = ref<HTMLElement | null>(null)
const chatColumnEl = ref<HTMLElement | null>(null)
const splittingChat = ref(false)
const expanded = ref(false)
const nativeFullscreen = ref(false)
const chatCollapsed = ref(true)
const chatHover = ref(false)
const chatFocus = ref(false)
const micMuted = ref(false)
const micLive = ref(false)
const botMuted = ref(false)
const pttRecording = ref(false)
const userEnergy = ref(0)
const botEnergy = ref(0)
const userSpeaking = ref(false)
const botSpeaking = ref(false)

const immersive = computed(() =>
  isImmersive({ expanded: expanded.value, fullscreen: nativeFullscreen.value }),
)
const dockMicMuted = computed(() => micMuted.value || !micLive.value)
const dockStatus = computed(() => {
  if (pttRecording.value) return 'hold · Esc cancels'
  if (callStatus.value) return callStatus.value
  if (voiceStatus.value === 'mic off') return ''
  return voiceStatus.value
})

let vad: VadSession | null = null
let stt: SttProvider | null = null
let audioCtx: AudioContext | null = null
let stopTts: (() => void) | null = null
let ptt: PushToTalkRecorder | null = null
let pttArmed = false
let pttPointerId: number | null = null
let botAnalyser: AnalyserNode | null = null
let meterRaf = 0
let meterUserBuf: Uint8Array = new Uint8Array(128)
let meterBotBuf: Uint8Array = new Uint8Array(128)
let vadUserRms = 0
let vadSpeechProb = 0
let chatCollapseTimer: number | null = null
let resumeMicAfterPtt = false
/** longIdleMs: 10 min default; use 60_000 to demo crouch rest faster */
const director = new AnimationDirector(null, {
  presence: { longIdleMs: 10 * 60 * 1000 },
})
const stopActionFeed = director.onAction((ev) => {
  motionActionFeed.value = [ev, ...motionActionFeed.value].slice(0, ACTION_FEED_MAX)
})

function clearMotionActionFeed(): void {
  motionActionFeed.value = []
}

const activePane = computed(
  () => panes.value.find((p) => p.id === activePaneId.value) ?? panes.value[0],
)

const activeVrmUrl = computed(() => resolvePaneVrmUrl(activePane.value, settings))

const activeClothes = computed(() => resolvePaneClothes(activePane.value))
const liveClothes = ref<ClothesItem[]>([])
const clothesGroups = computed(() => groupClothesByCategory(liveClothes.value))
const clothesAllSelected = computed(() => {
  const pane = activePane.value
  if (!pane) return true
  if (pane.clothesIds === undefined) return pane.clothesId !== 'none'
  return false
})
const clothesSelectedIds = computed(() => {
  const pane = activePane.value
  if (!pane) return liveClothes.value.map((c) => c.id)
  if (pane.clothesIds !== undefined) return pane.clothesIds
  if (pane.clothesId === 'none') return []
  return liveClothes.value.map((c) => c.id)
})

const overlayCatalog = ref<Record<string, ClothesItem[]>>({})
const overlayLoadingIds = ref<string[]>([])

const overlayAddableItems = computed(() => {
  const id = activePane.value?.clothesOverlayId
  if (!id) return []
  return overlayCatalog.value[id] ?? []
})

const overlayCatalogLoading = computed(() => {
  const id = activePane.value?.clothesOverlayId
  return Boolean(id && overlayLoadingIds.value.includes(id))
})

const overlayCheckedIds = computed(() => {
  const pane = activePane.value
  const sourceId = pane?.clothesOverlayId
  if (!pane || !sourceId) return []
  return (pane.clothesOverlayItems ?? [])
    .filter((p) => p.sourceId === sourceId)
    .map((p) => p.itemId)
})

const overlayTransforms = computed(() => {
  const pane = activePane.value
  const sourceId = pane?.clothesOverlayId
  const out: Record<string, Partial<ClothesPieceTransform> | undefined> = {}
  if (!pane || !sourceId) return out
  for (const p of pane.clothesOverlayItems ?? []) {
    if (p.sourceId !== sourceId) continue
    out[p.itemId] = p.transform
  }
  return out
})

const overlayAppliedCount = computed(() => activePane.value?.clothesOverlayItems?.length ?? 0)

const visibleVrmCatalog = computed(() => filterDemoCatalog(VRM_CATALOG, settings.demoMode))

const visibleOverlayCatalog = computed(() => {
  const base = filterDemoCatalog(CLOTHES_OVERLAY_CATALOG, settings.demoMode)
  const id = activePane.value?.clothesOverlayId
  if (id && !base.some((o) => o.id === id)) {
    const extra = CLOTHES_OVERLAY_CATALOG.find((o) => o.id === id)
    if (extra) return [...base, extra]
  }
  return base
})

function persistClothesPatch(
  patch: Parameters<typeof mergeClothesIntoWardrobe>[1],
): void {
  const pane = activePane.value
  if (!pane) return
  patchPane(pane.id, mergeClothesIntoWardrobe(pane, patch, modelKeyForPane(pane)))
}

function onSelectVrm(url: string): void {
  const pane = activePane.value
  if (!pane) return
  const from = modelKeyForPane(pane)
  const to = catalogIdFromUrl(url, VRM_CATALOG)
  patchPane(pane.id, switchPaneVrm(pane, url, from, to))
}

function toggleDemoMode(): void {
  const next = !settings.demoMode
  settings.demoMode = next
  if (next) panes.value = applyDemoModelFilter(panes.value)
}

const agentConfigSummary = computed(() => {
  const pane = activePane.value
  if (!pane) return ''
  const mood =
    MOOD_CATALOG.find((m) => m.id === (pane.defaultMood || 'neutral'))?.label ?? 'Neutral'
  const vrmUrl = pane.vrmUrl || activeVrmUrl.value
  const vrm = VRM_CATALOG.find((v) => v.url === vrmUrl)?.label ?? 'VRM'
  const overlays = pane.clothesOverlayItems?.length ?? 0
  const parts = [mood, vrm]
  if (overlays) parts.push(`${overlays} overlay${overlays === 1 ? '' : 's'}`)
  return parts.join(' · ')
})

async function loadOverlayCatalog(sourceId: string): Promise<void> {
  if (!sourceId || overlayCatalog.value[sourceId] || overlayLoadingIds.value.includes(sourceId)) {
    return
  }
  const entry = CLOTHES_OVERLAY_CATALOG.find((c) => c.id === sourceId)
  if (!entry) return
  overlayLoadingIds.value = [...overlayLoadingIds.value, sourceId]
  try {
    const res = await fetch(entry.url)
    if (!res.ok) throw new Error(`overlay catalog ${res.status}`)
    const items = listClothesFromVrmBuffer(await res.arrayBuffer())
    overlayCatalog.value = { ...overlayCatalog.value, [sourceId]: items }
  } catch (err) {
    console.error('[playground] overlay clothes catalog', sourceId, err)
    overlayCatalog.value = { ...overlayCatalog.value, [sourceId]: [] }
  } finally {
    overlayLoadingIds.value = overlayLoadingIds.value.filter((id) => id !== sourceId)
  }
}

watch(
  () => activePane.value?.clothesOverlayId,
  (id) => {
    if (id) void loadOverlayCatalog(id)
  },
  { immediate: true },
)

function persistNativeClothes(ids: string[] | undefined): void {
  const pane = activePane.value
  if (!pane) return
  if (ids === undefined) {
    persistClothesPatch({ clothesIds: undefined, clothesId: 'default' })
    return
  }
  if (ids.length === 0) {
    persistClothesPatch({ clothesIds: [], clothesId: 'none' })
    return
  }
  const all = liveClothes.value.map((c) => c.id)
  const same =
    all.length > 0 && ids.length === all.length && all.every((id) => ids.includes(id))
  if (same) {
    persistClothesPatch({ clothesIds: undefined, clothesId: 'default' })
    return
  }
  persistClothesPatch({ clothesIds: ids, clothesId: ids.join('+') })
}

function onToggleClothes(id: string, checked: boolean): void {
  const all = liveClothes.value.map((c) => c.id)
  let next = clothesAllSelected.value ? [...all] : [...clothesSelectedIds.value]
  if (checked) {
    if (!next.includes(id)) next.push(id)
  } else {
    next = next.filter((x) => x !== id)
  }
  persistNativeClothes(next)
}

function persistOverlayItems(items: ClothesOverlayItemSave[]): void {
  persistClothesPatch({ clothesOverlayItems: items.length ? items : undefined })
}

function onClothesOverlay(id: string): void {
  persistClothesPatch({ clothesOverlayId: id || undefined })
}

function onToggleOverlayItem(itemId: string, checked: boolean): void {
  const pane = activePane.value
  const sourceId = pane?.clothesOverlayId
  if (!pane || !sourceId) return
  const items = [...(pane.clothesOverlayItems ?? [])]
  const idx = items.findIndex((p) => p.sourceId === sourceId && p.itemId === itemId)
  if (checked) {
    if (idx < 0) items.push({ sourceId, itemId })
  } else if (idx >= 0) {
    items.splice(idx, 1)
  }
  persistOverlayItems(items)
}

function onOverlayTransform(itemId: string, transform: Partial<ClothesPieceTransform> | undefined): void {
  const pane = activePane.value
  const sourceId = pane?.clothesOverlayId
  if (!pane || !sourceId) return
  const items = (pane.clothesOverlayItems ?? []).map((p) => {
    if (p.sourceId !== sourceId || p.itemId !== itemId) return p
    const next: ClothesOverlayItemSave = { sourceId, itemId }
    if (transform && Object.keys(transform).length) {
      next.transform = compactClothesTransform(normalizeClothesTransform(transform))
    }
    return next
  })
  persistOverlayItems(items)
}

function applyActiveAgentAvatar(): void {
  const pane = activePane.value
  if (!pane) return
  syncDirector()
  const mood = pane.defaultMood || 'neutral'
  director.getPresence().setMood(mood)
  motionDebugMoodId.value = director.getPresence().getMood().id
}

watch(activePaneId, (id) => {
  const pane = panes.value.find((p) => p.id === id)
  saveActivePane(pane)
  applyActiveAgentAvatar()
  if (inCall.value && callPaneId.value && callPaneId.value !== id) {
    void endVoiceCall('switched agent')
  }
})

watch(
  () => activePane.value?.defaultMood,
  (mood) => {
    if (!mood) return
    syncDirector()
    director.getPresence().setMood(mood)
    motionDebugMoodId.value = director.getPresence().getMood().id
  },
)

watch(
  settings,
  () => saveSettings({ ...settings }),
  { deep: true },
)

watch(
  panes,
  () => {
    savePanes(panes.value)
    if (!panes.value.some((p) => p.id === activePaneId.value)) {
      activePaneId.value = loadActivePaneId(panes.value)
    }
  },
  { deep: true },
)

watch(
  showSettings,
  () => {
    void nextTick(() => clampChatColumnToWorkspace())
  },
)

watch(immersive, (on) => {
  if (on) chatCollapsed.value = true
  void nextTick(() => {
    clampChatColumnToWorkspace()
    viewportRef.value?.resize()
  })
})

function clampChatColumnToWorkspace(): void {
  const ws = workspaceEl.value
  const chat = chatColumnEl.value
  if (!ws || !chat) return
  const wsBox = ws.getBoundingClientRect()
  const chatBox = chat.getBoundingClientRect()
  settings.chatColumnPx = clampChatColumnPx(
    settings.chatColumnPx,
    wsBox.width,
    chatBox.left - wsBox.left + chatSplitGapPx(ws),
  )
}

function onWinSplitMove(e: PointerEvent): void {
  onSplitPointerMove(e)
}

function onWinSplitUp(e: PointerEvent): void {
  endSplitDrag(e)
}

function onSplitPointerDown(e: PointerEvent): void {
  if (e.button !== 0) return
  e.preventDefault()
  const handle = e.currentTarget as HTMLElement
  splittingChat.value = true
  document.documentElement.classList.add('is-chat-split-dragging')
  try {
    handle.setPointerCapture(e.pointerId)
  } catch {
    /* capture is optional (tests / lost pointer) */
  }
  window.addEventListener('pointermove', onWinSplitMove)
  window.addEventListener('pointerup', onWinSplitUp)
  window.addEventListener('pointercancel', onWinSplitUp)
}

function onSplitPointerMove(e: PointerEvent): void {
  if (!splittingChat.value) return
  const ws = workspaceEl.value
  const chat = chatColumnEl.value
  if (!ws || !chat) return
  settings.chatColumnPx = chatWidthFromPointer(e.clientX, ws, chat)
}

function endSplitDrag(e?: PointerEvent): void {
  if (!splittingChat.value) return
  splittingChat.value = false
  document.documentElement.classList.remove('is-chat-split-dragging')
  window.removeEventListener('pointermove', onWinSplitMove)
  window.removeEventListener('pointerup', onWinSplitUp)
  window.removeEventListener('pointercancel', onWinSplitUp)
  const handle = e?.currentTarget as HTMLElement | undefined
  if (!handle || e === undefined) return
  try {
    if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId)
  } catch {
    /* already released */
  }
}

function onSplitKeydown(e: KeyboardEvent): void {
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    e.preventDefault()
    const delta = e.key === 'ArrowRight' ? CHAT_COLUMN_KEY_STEP_PX : -CHAT_COLUMN_KEY_STEP_PX
    const ws = workspaceEl.value
    const chat = chatColumnEl.value
    if (!ws || !chat) {
      settings.chatColumnPx = Math.max(CHAT_COLUMN_MIN_PX, settings.chatColumnPx + delta)
      return
    }
    const wsBox = ws.getBoundingClientRect()
    const chatBox = chat.getBoundingClientRect()
    settings.chatColumnPx = clampChatColumnPx(
      settings.chatColumnPx + delta,
      wsBox.width,
      chatBox.left - wsBox.left + chatSplitGapPx(ws),
    )
    return
  }
  if (e.key === 'Home') {
    e.preventDefault()
    settings.chatColumnPx = CHAT_COLUMN_DEFAULT_PX
    clampChatColumnToWorkspace()
  }
}

function resetChatSplit(): void {
  settings.chatColumnPx = CHAT_COLUMN_DEFAULT_PX
  clampChatColumnToWorkspace()
}

function syncImmersiveLayout(): void {
  void nextTick(() => {
    clampChatColumnToWorkspace()
    viewportRef.value?.resize()
  })
}

function clearChatCollapseTimer(): void {
  if (chatCollapseTimer == null) return
  window.clearTimeout(chatCollapseTimer)
  chatCollapseTimer = null
}

function scheduleChatAutoCollapse(): void {
  clearChatCollapseTimer()
  if (!immersive.value || chatCollapsed.value) return
  chatCollapseTimer = window.setTimeout(() => {
    chatCollapseTimer = null
    if (!immersive.value || chatHover.value || chatFocus.value) return
    chatCollapsed.value = true
  }, 2200)
}

function onChatPointerEnter(): void {
  chatHover.value = true
  clearChatCollapseTimer()
}

function onChatPointerLeave(): void {
  chatHover.value = false
  if (immersive.value && !chatFocus.value && !chatCollapsed.value) scheduleChatAutoCollapse()
}

function onChatFocusIn(): void {
  chatFocus.value = true
  clearChatCollapseTimer()
}

function onChatFocusOut(e: FocusEvent): void {
  const col = chatColumnEl.value
  if (col && e.relatedTarget instanceof Node && col.contains(e.relatedTarget)) return
  chatFocus.value = false
  if (immersive.value && !chatHover.value && !chatCollapsed.value) scheduleChatAutoCollapse()
}

function toggleChatDock(): void {
  chatCollapsed.value = !chatCollapsed.value
  if (!chatCollapsed.value) clearChatCollapseTimer()
}

function onStageRootPointerDown(e: PointerEvent): void {
  if (!immersive.value || chatCollapsed.value) return
  const el = e.target
  if (!(el instanceof Element)) return
  if (chatColumnEl.value?.contains(el)) return
  if (el.closest('[data-audio-dock]')) return
  chatCollapsed.value = true
}

function toggleExpanded(): void {
  expanded.value = !expanded.value
  if (expanded.value) chatCollapsed.value = true
  console.info('[playground] expand', expanded.value)
  syncImmersiveLayout()
}

async function toggleNativeFullscreen(): Promise<void> {
  const el = stageRootEl.value
  if (!el) return
  try {
    if (isStageFullscreen(el)) {
      await exitStageFullscreen()
    } else {
      chatCollapsed.value = true
      await requestStageFullscreen(el)
    }
    console.info('[playground] fullscreen', isStageFullscreen(el))
  } catch (err) {
    console.error('[playground] fullscreen', err)
  }
  syncImmersiveLayout()
}

function onFullscreenChange(): void {
  const next = chromeAfterFullscreenChange(
    { expanded: expanded.value, fullscreen: nativeFullscreen.value },
    isStageFullscreen(stageRootEl.value),
  )
  nativeFullscreen.value = next.fullscreen
  if (next.fullscreen) chatCollapsed.value = true
  syncImmersiveLayout()
}

function onVadFrame(info: VadFrameInfo): void {
  if (micMuted.value || pttRecording.value) return
  vadUserRms = info.rms
  vadSpeechProb = info.isSpeech
  userSpeaking.value = info.isSpeech > 0.5
}

function sizeMeterBuf(analyser: AnalyserNode, current: Uint8Array): Uint8Array {
  const n = analyser.frequencyBinCount
  return current.length === n ? current : new Uint8Array(n)
}

function pollMeters(): void {
  const pttAnalyser = pttRecording.value ? ptt?.getAnalyser() ?? null : null
  if (pttAnalyser) {
    meterUserBuf = sizeMeterBuf(pttAnalyser, meterUserBuf)
    userEnergy.value = speechEnergy(readAnalyserRms(pttAnalyser, meterUserBuf), 1)
    userSpeaking.value = true
  } else if (micMuted.value || !micLive.value) {
    userEnergy.value *= 0.72
    if (userEnergy.value < 0.02) userSpeaking.value = false
  } else {
    userEnergy.value = speechEnergy(vadUserRms, vadSpeechProb)
    vadUserRms *= 0.84
    vadSpeechProb *= 0.9
  }

  if (botAnalyser && botSpeaking.value && !botMuted.value) {
    meterBotBuf = sizeMeterBuf(botAnalyser, meterBotBuf)
    botEnergy.value = speechEnergy(readAnalyserRms(botAnalyser, meterBotBuf), 1)
  } else {
    botEnergy.value *= 0.72
  }
  meterRaf = requestAnimationFrame(pollMeters)
}

function toggleBotMute(): void {
  botMuted.value = !botMuted.value
  console.info('[playground] bot mute', botMuted.value)
  if (botMuted.value) {
    stopTts?.()
    stopTts = null
    botSpeaking.value = false
    botAnalyser = null
  }
}

async function onRecordPointerDown(e: PointerEvent): Promise<void> {
  if (!pttShouldArm(e.button) || pttArmed || busy.value) return
  pttArmed = true
  pttPointerId = e.pointerId
  await beginPtt()
}

async function onRecordPointerUp(e: PointerEvent): Promise<void> {
  if (!pttArmed) return
  if (pttPointerId !== null && e.pointerId !== pttPointerId) return
  pttArmed = false
  pttPointerId = null
  await finishPtt('submit')
}

function onRecordCancel(): void {
  if (!pttArmed && !pttRecording.value) return
  pttArmed = false
  pttPointerId = null
  void finishPtt('cancel')
}

function onGlobalKeydown(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return
  if (!pttArmed && !pttRecording.value) return
  e.preventDefault()
  pttArmed = false
  pttPointerId = null
  void finishPtt('cancel')
}

async function beginPtt(): Promise<void> {
  const pane = activePane.value
  if (!pane) {
    pttArmed = false
    return
  }
  resumeMicAfterPtt = micLive.value || inCall.value
  vad?.pause()
  micLive.value = false
  try {
    const ctx = await ensureAudio()
    if (!ptt) ptt = new PushToTalkRecorder(ctx)
    await ptt.start()
    pttRecording.value = true
    voiceStatus.value = 'recording…'
  } catch (err) {
    if (err instanceof Error && err.message === 'ptt superseded') return
    console.error('[playground] ptt start', err)
    pttRecording.value = false
    pttArmed = false
    voiceStatus.value = 'record failed'
    await restoreMicAfterPtt()
  }
}

async function finishPtt(reason: PttStopReason): Promise<void> {
  if (!pttRecording.value && reason === 'submit' && !ptt) return
  pttRecording.value = false
  const rec = ptt
  if (!rec) {
    await restoreMicAfterPtt()
    return
  }
  try {
    const result = await rec.stop(reason)
    if (reason === 'cancel') {
      voiceStatus.value = 'record cancelled'
      return
    }
    if (!result) {
      voiceStatus.value = resumeMicAfterPtt ? (inCall.value ? 'in call' : 'listening') : 'mic off'
      return
    }
    const pane = activePane.value
    if (!pane) return
    voiceStatus.value = 'transcribing…'
    const provider = ensureStt()
    await provider.prepare?.()
    const transcribed = await provider.transcribe(result.blob, { vocabulary: pane.vocabulary })
    lastTranscript.value = transcribed.text
    const text = transcribed.text.trim()
    if (!text) {
      voiceStatus.value = 'empty transcript'
      return
    }
    await runChat(pane, text, {
      forceTts: inCall.value,
      onPhase: (phase) => {
        voiceStatus.value = phase
      },
    })
  } catch (err) {
    console.error('[playground] ptt finish', err)
    voiceStatus.value = 'stt error'
  } finally {
    await restoreMicAfterPtt()
  }
}

async function restoreMicAfterPtt(): Promise<void> {
  if (!resumeMicAfterPtt || micMuted.value || !vad) {
    if (!micLive.value && !inCall.value && !pttRecording.value && voiceStatus.value === 'recording…') {
      voiceStatus.value = 'mic off'
    }
    return
  }
  try {
    await vad.start()
    micLive.value = true
    voiceStatus.value = inCall.value ? 'in call' : 'listening'
  } catch (err) {
    console.error('[playground] resume vad after ptt', err)
    voiceStatus.value = 'mic resume failed'
  }
}

function getController(): CharacterController | null {
  return viewportRef.value?.getController() ?? null
}

function syncDirector(): CharacterController | null {
  const c = getController()
  director.setController(c)
  return c
}

function refreshMotionDebug(): void {
  syncDirector()
  const c = getController()
  motionDebugGestures.value = c?.listGestures() ?? []
  motionDebugExpressions.value = c?.listExpressions() ?? []
  motionDebugMoods.value = director.getPresence().listMoods()
  motionDebugMoodId.value = director.getPresence().getMood().id
  motionDebugLog.value = `gestures=${motionDebugGestures.value.length} faces=${motionDebugExpressions.value.length} mood=${motionDebugMoodId.value}`
}

function onViewportReady(): void {
  syncDirector()
  applyActiveAgentAvatar()
  liveClothes.value = getController()?.listClothes() ?? []
  const pane = activePane.value
  if (pane?.clothesIds?.length) {
    const available = new Set(liveClothes.value.map((c) => c.id))
    const kept = pane.clothesIds.filter(
      (id) => available.has(id) || liveClothes.value.some((c) => c.category === id),
    )
    if (kept.length !== pane.clothesIds.length) persistNativeClothes(kept.length ? kept : undefined)
  }
  refreshMotionDebug()
}

function onViewportLocomoting(moving: boolean): void {
  if (moving) director.pausePresence('locomotion')
  else director.resumePresence()
}

function openMotionDebug(): void {
  showMotionDebug.value = true
  refreshMotionDebug()
}

function onDebugPlayGesture(id: string, loop: boolean): void {
  syncDirector()
  try {
    if ((id === 'sit' || id === 'sit_wave') && loop) {
      director.getPresence().enterLongRest()
      motionDebugLog.value = 'play sit (rest + seat)'
      return
    }
    getController()?.playGesture(id, loop, 0.25)
    motionDebugLog.value = `play ${id}${loop ? ' (loop)' : ''}`
  } catch (err) {
    motionDebugLog.value = err instanceof Error ? err.message : String(err)
  }
}

function onDebugSetMood(id: string): void {
  syncDirector()
  const ok = director.getPresence().setMood(id)
  motionDebugMoodId.value = director.getPresence().getMood().id
  motionDebugLog.value = ok ? `mood=${id}` : `unknown mood ${id}`
  if (ok && activePane.value) {
    patchPane(activePane.value.id, { defaultMood: id })
  }
}

function onDebugSetEmotion(emotion: string): void {
  syncDirector()
  getController()?.setEmotion(emotion, 0.85, 2500)
  motionDebugLog.value = `emotion=${emotion}`
}

function onDebugSetExpression(name: string, weight: number): void {
  syncDirector()
  getController()?.setExpression(name, weight)
  motionDebugLog.value = `expression ${name}=${weight.toFixed(2)}`
}

function onDebugResetFace(): void {
  syncDirector()
  getController()?.resetFace()
  motionDebugLog.value = 'face reset'
}

function onDebugResetPresence(): void {
  syncDirector()
  director.getPresence().resetClock('debug')
  director.getPresence().resume()
  motionDebugLog.value = 'presence clock reset + resume'
}

function onDebugForceLongRest(): void {
  syncDirector()
  director.getPresence().enterLongRest()
  motionDebugLog.value = 'force long rest · sit'
}

onMounted(() => {
  // kick thinking after first paint + apply active agent mood
  window.setTimeout(() => {
    syncDirector()
    applyActiveAgentAvatar()
    director.scheduleThinking()
  }, 1500)
  window.addEventListener('resize', clampChatColumnToWorkspace)
  document.addEventListener('fullscreenchange', onFullscreenChange)
  window.addEventListener('keydown', onGlobalKeydown)
  meterRaf = requestAnimationFrame(pollMeters)
  void nextTick(() => clampChatColumnToWorkspace())
})

function ensureStt(): SttProvider {
  if (settings.sttProvider === 'speaches') {
    stt = new SpeachesStt({
      baseUrl: settings.speachesUrl,
      apiKey: settings.speachesKey || undefined,
    })
  } else {
    stt = new BrowserWhisperStt({ model: settings.whisperModel })
  }
  return stt
}

async function ensureAudio(): Promise<AudioContext> {
  if (!audioCtx) audioCtx = new AudioContext()
  if (audioCtx.state === 'suspended') await audioCtx.resume()
  return audioCtx
}

interface ChatRunOptions {
  /** Force Fish TTS for this turn (voice call). */
  forceTts?: boolean
  onPhase?: (phase: string) => void
}

function shouldSpeak(opts: ChatRunOptions = {}): boolean {
  if (botMuted.value) return false
  return Boolean(settings.fishApiKey) && (Boolean(opts.forceTts) || settings.ttsEnabled)
}

function liveAvatarSnapshot(pane: AgentPane): string {
  const c = syncDirector()
  const pose = c?.getLocomotionSnapshot()
  const vrmUrl = resolvePaneVrmUrl(pane, settings)
  return formatAvatarSnapshot({
    agentName: pane.label,
    vrmLabel: vrmLabelFromUrl(vrmUrl, VRM_CATALOG),
    mood: director.getPresence().getMood().id || pane.defaultMood || 'neutral',
    clothesId: pane.clothesId || 'default',
    clothesIds: c?.getClothesIds() ?? pane.clothesIds ?? [],
    overlays: (pane.clothesOverlayItems ?? []).map((p) => `${p.sourceId}:${p.itemId}`),
    gesture: c?.getGestureId() ?? null,
    idleLoop: c?.getIdleLoopId(),
    pose: pose
      ? {
          x: pose.x,
          z: pose.z,
          facing: pose.facing,
          grounded: pose.grounded,
          moving: pose.moving,
        }
      : undefined,
  })
}

function systemPromptForChat(pane: AgentPane, opts: ChatRunOptions = {}): string {
  const c = syncDirector()
  const exprs = c?.listExpressions() ?? []
  const vrmUrl = resolvePaneVrmUrl(pane, settings)
  return buildCharacterSystemPrompt({
    basePrompt: [
      applyAgentIdentity(
        settings.systemPrompt,
        pane.label,
        vrmLabelFromUrl(vrmUrl, VRM_CATALOG),
      ),
      liveAvatarSnapshot(pane),
    ].join('\n\n'),
    ttsEnabled: shouldSpeak(opts),
    gestureIds: c?.listGestures() ?? [],
    expressions: exprs,
    moods: listPresenceMoods().map((m) => m.id),
    clothes: ['none', 'default', ...(c?.listClothes().map((x) => x.id) ?? [])],
    inlineTagsEnabled: settings.inlineCharacterTags,
  })
}

function currentTagCatalog(): InlineTagCatalog {
  const c = getController()
  if (!c) return defaultInlineCatalog()
  const exprs = c.listExpressions()
  return {
    gestures: [...c.listGestures(), ...listLogicalGestureIds()],
    moods: listPresenceMoods().map((m) => m.id),
    emotions: exprs.filter((e) => e.kind === 'emotion').map((e) => e.name),
    expressions: exprs.map((e) => e.name),
    clothes: ['none', 'default', ...c.listClothes().map((x) => x.id)],
  }
}

async function runChat(
  pane: AgentPane,
  userContent: ChatMessage['content'],
  opts: ChatRunOptions = {},
) {
  busy.value = true
  chatWaitHint.value = `Waiting for ${pane.label}…`
  pane.lastErrorKind = null
  stopTts?.()
  stopTts = null
  syncDirector()
  director.stopThinking()
  const speechGen = director.beginSpeechBeat()

  try {
    const history = pane.messages.filter(
      (m) => m.role !== 'assistant' || !String(m.content ?? '').startsWith('Error:'),
    )
    pane.messages = [...history, { role: 'user', content: userContent }]

    const viaHermes = paneUsesHermesChat(settings.llmRuntime, pane.baseUrl)
    if (!viaHermes) {
      await runToolsChat(pane, history, userContent, speechGen, opts)
    } else {
      if (settings.llmRuntime === 'tools') {
        console.info('[playground] chat via agent gateway (pane /v1)', {
          agent: pane.label,
          base: playgroundFetchBase(pane.baseUrl),
        })
      }
      await runHermesChat(pane, history, userContent, speechGen, opts)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (err instanceof HermesFetchError) {
      pane.lastTrustUrl = err.trustUrl
      pane.lastErrorKind = err.kind
    } else {
      pane.lastErrorKind = 'network'
    }
    pane.messages = [
      ...pane.messages,
      { role: 'assistant', content: `Error: ${message}` },
    ]
    console.error('[playground] chat error', err)
  } finally {
    director.endSpeechBeat(speechGen)
    busy.value = false
    chatWaitHint.value = ''
  }
}

type ToolCallMsg = NonNullable<ChatMessage['tool_calls']>[number]

async function playReplyPerformance(
  text: string,
  speechGen: number,
  opts: ChatRunOptions,
  pendingPerf: ToolCallMsg[] = [],
): Promise<void> {
  const parsed = parseInlineTags(text, currentTagCatalog(), {
    enabled: settings.inlineCharacterTags,
  })
  const speakText = parsed.ttsText || parsed.displayText
  const jobs: Array<Promise<unknown>> = []
  if (pendingPerf.length) {
    jobs.push(director.applyToolCalls(pendingPerf, speechGen))
  }
  if (parsed.withSpeech.length) {
    jobs.push(director.runSequence(parsed.withSpeech, speechGen, 'tag'))
  } else if (!pendingPerf.length && speakText) {
    jobs.push(
      director.runToolCall(
        'character_play_gesture',
        { id: 'talk', loop: true },
        speechGen,
        'auto',
      ),
    )
  }

  if (speakText && shouldSpeak(opts)) {
    opts.onPhase?.('speaking…')
    await Promise.all([...jobs, speakWithCancel(speakText, speechGen, { endBeat: false })])
  } else {
    await Promise.all(jobs)
  }
  if (parsed.afterTts.length && director.isCurrent(speechGen)) {
    await director.runSequence(parsed.afterTts, speechGen, 'tag')
  }
  director.endSpeechBeat(speechGen)
}

async function runToolsChat(
  pane: AgentPane,
  history: ChatMessage[],
  userContent: ChatMessage['content'],
  speechGen: number,
  opts: ChatRunOptions = {},
) {
  const endpoint = resolveToolsEndpoint({
    paneBaseUrl: pane.baseUrl,
    paneApiKey: pane.apiKey,
    openrouterBaseUrl: settings.openrouterBaseUrl,
    openrouterApiKey: settings.openrouterApiKey.trim() || (import.meta.env.VITE_OPENROUTER_API_KEY as string) || '',
  })
  if (endpoint.source === 'openrouter' && !endpoint.apiKey) {
    throw new Error('OpenRouter API key required for tools runtime (Settings or VITE_OPENROUTER_API_KEY)')
  }

  console.info('[playground] tools-chat', {
    agent: pane.label,
    source: endpoint.source,
    base: playgroundFetchBase(endpoint.baseUrl),
    model: pane.model,
  })

  const msgs: ChatMessage[] = [
    { role: 'system', content: systemPromptForChat(pane, opts) },
    ...history,
    { role: 'user', content: userContent },
  ]

  /** Queued until spoken text (or next tool_calls flush). */
  let pendingPerf: ToolCallMsg[] = []

  let round = 0
  while (round < 6) {
    round++
    chatWaitHint.value = `Waiting for ${pane.label}… (${round}/6)`

    const res = await toolsChat(
      {
        baseUrl: endpoint.baseUrl,
        apiKey: endpoint.apiKey,
        model: pane.model,
      },
      msgs,
      { tools: CHARACTER_SKILL.allTools() },
    )
    const assistant = res.choices[0]?.message
    if (!assistant) throw new Error('empty completion')

    pane.messages = [...pane.messages, assistant]
    msgs.push(assistant)

    if (assistant.tool_calls?.length) {
      syncDirector()

      // Next tool_calls batch arrived → start previously queued performance now
      if (pendingPerf.length) {
        const flush = pendingPerf
        pendingPerf = []
        void director.applyToolCalls(flush, speechGen)
      }

      const results: Array<{ ok: boolean; name?: string; message: string; data?: unknown }> = []
      for (const tc of assistant.tool_calls) {
        const raw = tc.function?.name ?? ''
        const name = resolveCharacterToolName(raw)
        let args: Record<string, unknown> = {}
        try {
          args = JSON.parse(tc.function?.arguments || '{}') as Record<string, unknown>
        } catch {
          results.push({ ok: false, name, message: 'invalid JSON arguments' })
          continue
        }
        if (isImmediateCharacterTool(raw)) {
          results.push(await director.runToolCall(name, args, speechGen))
        } else if (isDeferredCharacterTool(raw)) {
          pendingPerf.push(tc)
          results.push({
            ok: true,
            name,
            message: 'scheduled — starts with spoken reply or next tool round',
          })
        } else {
          results.push(await director.runToolCall(name, args, speechGen))
        }
      }

      for (let i = 0; i < assistant.tool_calls.length; i++) {
        const tc = assistant.tool_calls[i]!
        const match = results[i]
        const toolMsg: ChatMessage = {
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify(match ?? { ok: false, message: 'no result' }),
        }
        pane.messages = [...pane.messages, toolMsg]
        msgs.push(toolMsg)
      }
      continue
    }

    const text = typeof assistant.content === 'string' ? assistant.content.trim() : ''
    if (!text && !pendingPerf.length && !assistant.tool_calls?.length) {
      console.warn('[playground] empty LLM completion', { agent: pane.label, round })
    }
    syncDirector()
    const perf = pendingPerf
    pendingPerf = []
    if (director.isCurrent(speechGen)) {
      await playReplyPerformance(text, speechGen, opts, perf)
    } else {
      console.warn('[playground] speech beat stale; kept LLM reply', { agent: pane.label })
    }
    break
  }
}

async function runHermesChat(
  pane: AgentPane,
  history: ChatMessage[],
  userContent: ChatMessage['content'],
  speechGen: number,
  opts: ChatRunOptions = {},
) {
  if (!pane.apiKey.trim()) {
    throw new Error('Hermes API key empty — or switch Settings → LLM runtime to Tools (OpenRouter)')
  }
  console.info('[playground] hermes-chat', {
    agent: pane.label,
    base: playgroundFetchBase(pane.baseUrl),
    model: pane.model,
  })
  const msgs: ChatMessage[] = [
    { role: 'system', content: systemPromptForChat(pane, opts) },
    ...history,
    { role: 'user', content: userContent },
  ]
  const res = await hermesChat(
    {
      baseUrl: pane.baseUrl,
      apiKey: pane.apiKey,
      model: pane.model,
      sessionId: pane.sessionId,
    },
    msgs,
  )
  const assistant = res.choices[0]?.message
  if (!assistant) throw new Error('empty completion')
  pane.messages = [...pane.messages, assistant]
  const text = typeof assistant.content === 'string' ? assistant.content : ''
  syncDirector()
  await playReplyPerformance(text, speechGen, opts)
}

async function speakWithCancel(
  text: string,
  speechGen: number,
  opts: { endBeat?: boolean } = {},
) {
  stopTts?.()
  stopTts = null
  const endBeat = opts.endBeat !== false
  // new speech soft-cancels prior timeline but keep this generation
  if (!director.isCurrent(speechGen)) return

  try {
    const ctx = await ensureAudio()
    const controller = syncDirector()
    if (controller) await controller.ensureLipSync(ctx)

    const tts = new FishTts({
      apiKey: settings.fishApiKey,
      referenceId: settings.fishReferenceId || undefined,
    })
    const result = await tts.speak(text, { voice: settings.fishReferenceId || undefined })
    if (!director.isCurrent(speechGen)) return

    const { stream, stop, ended, analyser } = await playViaAudioContext(result.audio, ctx)
    stopTts = stop
    botAnalyser = analyser
    botSpeaking.value = true
    const lip = controller?.getLipSync()
    if (lip && stream) {
      await lip.useStream(stream)
    }
    await ended
  } catch (err) {
    console.warn('[playground] TTS/lip-sync failed', err)
  } finally {
    stopTts = null
    botSpeaking.value = false
    botAnalyser = null
    if (endBeat) director.endSpeechBeat(speechGen)
  }
}

async function onSend(pane: AgentPane, payload: { text: string; files: File[] }) {
  activePaneId.value = pane.id
  const content =
    payload.files.length > 0
      ? await filesToContentParts(payload.text, payload.files)
      : payload.text
  await runChat(pane, content)
}

async function destroyVad(): Promise<void> {
  try {
    vad?.pause()
    vad?.destroy()
  } catch (err) {
    console.warn('[playground] vad destroy', err)
  }
  vad = null
  micLive.value = false
}

async function endVoiceCall(reason?: string): Promise<void> {
  const was = inCall.value
  inCall.value = false
  callPaneId.value = null
  callTurnBusy = false
  stopTts?.()
  stopTts = null
  await destroyVad()
  callStatus.value = reason ? `ended · ${reason}` : ''
  if (was) voiceStatus.value = 'mic off'
  if (reason) {
    window.setTimeout(() => {
      if (!inCall.value) callStatus.value = ''
    }, 2500)
  }
}

async function handleCallUtterance(paneId: string, pcm: Float32Array): Promise<void> {
  if (!inCall.value || callPaneId.value !== paneId || callTurnBusy) return
  if (micMuted.value || pttRecording.value) return
  const pane = panes.value.find((p) => p.id === paneId)
  if (!pane) return

  callTurnBusy = true
  vad?.pause()
  try {
    callStatus.value = 'transcribing…'
    voiceStatus.value = 'transcribing…'
    const provider = ensureStt()
    const blob = vadPcmToWavBlob(pcm)
    const result = await provider.transcribe(blob, { vocabulary: pane.vocabulary })
    lastTranscript.value = result.text
    const text = result.text.trim()
    if (!text || !inCall.value || callPaneId.value !== paneId) {
      callStatus.value = 'listening…'
      voiceStatus.value = 'in call'
      return
    }

    callStatus.value = 'thinking…'
    voiceStatus.value = 'thinking…'
    await runChat(pane, text, {
      forceTts: true,
      onPhase: (phase) => {
        if (!inCall.value || callPaneId.value !== paneId) return
        callStatus.value = phase
        voiceStatus.value = phase
      },
    })

    if (inCall.value && callPaneId.value === paneId) {
      callStatus.value = 'listening…'
      voiceStatus.value = 'in call'
    }
  } catch (err) {
    console.error('[playground] call turn', err)
    callStatus.value = 'error — still listening'
    voiceStatus.value = 'call error'
  } finally {
    callTurnBusy = false
    if (inCall.value && callPaneId.value === paneId && vad && !micMuted.value) {
      try {
        await vad.start()
        micLive.value = true
      } catch (err) {
        console.error('[playground] resume vad after call turn', err)
        callStatus.value = 'mic resume failed'
      }
    }
  }
}

async function startVoiceCall(pane: AgentPane): Promise<void> {
  if (!settings.fishApiKey?.trim()) {
    callStatus.value = 'Fish API key required (Settings)'
    return
  }

  activePaneId.value = pane.id
  if (inCall.value) await endVoiceCall()

  // One-shot header mic must not fight the call loop
  await destroyVad()

  inCall.value = true
  callPaneId.value = pane.id
  callTurnBusy = false
  callStatus.value = 'connecting…'
  voiceStatus.value = 'starting call'

  try {
    await ensureAudio()
    const provider = ensureStt()
    await provider.prepare?.()

    const paneId = pane.id
    vad = await createSileroVadSession({
      onSpeechStart: () => {
        if (!inCall.value || callPaneId.value !== paneId || callTurnBusy) return
        callStatus.value = 'listening…'
        voiceStatus.value = 'listening…'
      },
      onSpeechEnd: (pcm) => {
        void handleCallUtterance(paneId, pcm)
      },
      onFrameProcessed: onVadFrame,
      onStatus: (s) => {
        if (!inCall.value) return
        if (s === 'listening' && !callTurnBusy) {
          callStatus.value = 'listening…'
          voiceStatus.value = 'in call'
        }
      },
    })

    await vad.start()
    micLive.value = true
    micMuted.value = false
    callStatus.value = 'listening…'
    voiceStatus.value = 'in call'
  } catch (err) {
    console.error('[playground] start call', err)
    const message = err instanceof Error ? err.message : String(err)
    await endVoiceCall(message)
    callStatus.value = `failed · ${message}`
  }
}

async function toggleVoiceCall(pane: AgentPane): Promise<void> {
  if (inCall.value && callPaneId.value === pane.id) {
    await endVoiceCall()
    return
  }
  await startVoiceCall(pane)
}

async function toggleMic() {
  if (pttRecording.value) return

  if (micMuted.value && vad) {
    micMuted.value = false
    try {
      await vad.start()
      micLive.value = true
      voiceStatus.value = inCall.value ? 'in call' : 'listening'
      console.info('[playground] mic unmuted')
    } catch (err) {
      console.error('[playground] unmute mic', err)
      voiceStatus.value = 'mic resume failed'
    }
    return
  }

  if (vad?.listening) {
    micMuted.value = true
    vad.pause()
    micLive.value = false
    userSpeaking.value = false
    voiceStatus.value = 'mic muted'
    console.info('[playground] mic muted')
    return
  }

  const pane = activePane.value
  if (!pane) return

  await ensureAudio()
  const provider = ensureStt()
  await provider.prepare?.()

  // Recreate so callbacks always bind the current active pane
  await destroyVad()
  vad = await createSileroVadSession({
    onSpeechStart: () => {
      if (inCall.value) return
      voiceStatus.value = 'listening…'
    },
    onSpeechEnd: async (pcm) => {
      if (inCall.value || pttRecording.value || micMuted.value) return
      voiceStatus.value = 'transcribing…'
      try {
        const current = activePane.value
        if (!current) return
        const blob = vadPcmToWavBlob(pcm)
        const result = await provider.transcribe(blob, { vocabulary: current.vocabulary })
        lastTranscript.value = result.text
        voiceStatus.value = `stt:${result.provider}`
        if (result.text.trim()) {
          await runChat(current, result.text.trim())
        }
      } catch (err) {
        voiceStatus.value = 'stt error'
        console.error(err)
      }
    },
    onFrameProcessed: onVadFrame,
    onStatus: (s) => {
      if (inCall.value) return
      if (s === 'listening') voiceStatus.value = 'listening'
    },
  })

  micMuted.value = false
  await vad.start()
  micLive.value = true
  voiceStatus.value = 'listening'
}

function addPane() {
  const p = newPane({
    label: `Agent ${panes.value.length + 1}`,
    vrmUrl: settings.demoMode ? demoFallbackUrl(VRM_CATALOG) : undefined,
  })
  insertPane(p)
  closeAddAgentDialog()
}

function insertPane(p: AgentPane) {
  const next = settings.demoMode ? applyDemoModelFilter([p])[0]! : p
  panes.value = [...panes.value, next]
  activePaneId.value = next.id
  logAgentExport('pane-added', { label: next.label, id: next.id })
}

function flashToast(message: string) {
  toast.value = message
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => {
    toast.value = ''
  }, 2200)
}

async function openAddAgentDialog() {
  showAddAgent.value = true
  addClipboardText.value = ''
  const text = await readClipboardText()
  if (text) addClipboardText.value = text
}

function closeAddAgentDialog() {
  showAddAgent.value = false
  addClipboardText.value = ''
}

function importAgentConfig(config: AgentExportConfig) {
  const p = newPane({
    label: config.label,
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    model: config.model,
    vocabulary: config.vocabulary,
    defaultMood: config.defaultMood,
    vrmUrl: config.vrmUrl,
    clothesId: config.clothesId,
    clothesIds: config.clothesIds,
    clothesOverlayId: config.clothesOverlayId,
    clothesOverlayItems: config.clothesOverlayItems as AgentPane['clothesOverlayItems'],
    wardrobeByModel: config.wardrobeByModel as AgentPane['wardrobeByModel'],
  })
  insertPane(p)
  closeAddAgentDialog()
  flashToast(`Imported ${p.label}`)
}

function openTabMenu(ev: MouseEvent, paneId: string) {
  ev.preventDefault()
  activePaneId.value = paneId
  tabMenu.value = { paneId, x: ev.clientX, y: ev.clientY }
}

const tabMenuPane = computed(
  () => panes.value.find((p) => p.id === tabMenu.value?.paneId) ?? null,
)

const editPane = computed(
  () => panes.value.find((p) => p.id === editPaneId.value) ?? null,
)

async function exportPane(id: string) {
  const pane = panes.value.find((p) => p.id === id)
  if (!pane) return
  try {
    const json = stringifyAgentExport(pane)
    await writeClipboardText(json)
    logAgentExport('copied', { label: pane.label, bytes: json.length })
    flashToast(`Copied ${pane.label}`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn('[agent-export] copy failed', msg)
    editStartTab.value = 'json'
    editPaneId.value = id
    flashToast('Clipboard blocked — copy from JSON')
  }
  tabMenu.value = null
}

function openEditPane(id: string) {
  activePaneId.value = id
  editStartTab.value = 'form'
  editPaneId.value = id
  tabMenu.value = null
}

function removeMenuPane() {
  const id = tabMenu.value?.paneId
  tabMenu.value = null
  if (id) removePane(id)
}

function saveEditedAgent(config: AgentExportConfig, opts: { replaceWardrobe: boolean }) {
  const id = editPaneId.value
  const pane = panes.value.find((p) => p.id === id)
  if (!pane || !id) return

  const nextVrm = config.vrmUrl || pane.vrmUrl
  let base = pane
  if (nextVrm && nextVrm !== pane.vrmUrl) {
    base = switchPaneVrm(pane, nextVrm, modelKeyForPane(pane), catalogIdFromUrl(nextVrm, VRM_CATALOG))
  }

  const patch: Partial<AgentPane> = {
    ...base,
    label: config.label,
    baseUrl: config.baseUrl ?? base.baseUrl,
    apiKey: config.apiKey ?? base.apiKey,
    model: config.model ?? base.model,
    vocabulary: config.vocabulary ?? base.vocabulary,
    defaultMood: config.defaultMood ?? base.defaultMood,
    vrmUrl: base.vrmUrl,
  }
  if (opts.replaceWardrobe) {
    patch.clothesId = config.clothesId ?? base.clothesId
    patch.clothesIds = config.clothesIds ?? base.clothesIds
    patch.clothesOverlayId = config.clothesOverlayId ?? base.clothesOverlayId
    patch.clothesOverlayItems =
      (config.clothesOverlayItems as AgentPane['clothesOverlayItems']) ?? base.clothesOverlayItems
    patch.wardrobeByModel =
      (config.wardrobeByModel as AgentPane['wardrobeByModel']) ?? base.wardrobeByModel
  }

  patchPane(id, patch)
  if (settings.demoMode) panes.value = applyDemoModelFilter(panes.value)
  logAgentExport('edited', { label: config.label, id, replaceWardrobe: opts.replaceWardrobe })
  editPaneId.value = null
  flashToast(`Saved ${config.label}`)
}

function removePane(id: string) {
  if (panes.value.length <= 1) return
  if (inCall.value && callPaneId.value === id) void endVoiceCall('pane removed')
  panes.value = panes.value.filter((p) => p.id !== id)
  if (activePaneId.value === id) activePaneId.value = panes.value[0]!.id
}

function patchPane(id: string, patch: Partial<AgentPane>) {
  panes.value = panes.value.map((p) => (p.id === id ? { ...p, ...patch } : p))
}

function resetSession(id: string) {
  const pane = panes.value.find((p) => p.id === id)
  patchPane(id, { sessionId: newId(), messages: [], lastErrorKind: null })
  console.info('[playground] session reset (chat only)', {
    agent: pane?.label,
    vrmUrl: pane?.vrmUrl,
  })
}

async function checkHealth(id: string) {
  const pane = panes.value.find((p) => p.id === id)
  if (!pane) return
  const result = await hermesHealth(pane.baseUrl)
  if (result.ok) {
    patchPane(id, { lastErrorKind: null })
    pane.messages = [
      ...pane.messages,
      { role: 'assistant', content: `Health OK: ${result.detail}` },
    ]
  } else {
    const kind = pane.baseUrl.startsWith('https://') ? 'ssl' : 'network'
    patchPane(id, {
      lastErrorKind: kind,
      lastTrustUrl: hermesTrustUrl(pane.baseUrl),
    })
    pane.messages = [
      ...pane.messages,
      {
        role: 'assistant',
        content: `Health failed: ${result.detail}. Use “Open trust URL” if this is self-signed HTTPS, or switch to Proxy.`,
      },
    ]
  }
}

function updateVocab(raw: string) {
  const pane = activePane.value
  if (!pane) return
  const vocabulary = raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean)
  patchPane(pane.id, { vocabulary })
}

onBeforeUnmount(() => {
  inCall.value = false
  stopTts?.()
  stopActionFeed()
  director.dispose()
  vad?.destroy()
  stt?.dispose?.()
  ptt?.dispose()
  cancelAnimationFrame(meterRaf)
  clearChatCollapseTimer()
  void audioCtx?.close()
  window.removeEventListener('resize', clampChatColumnToWorkspace)
  document.removeEventListener('fullscreenchange', onFullscreenChange)
  window.removeEventListener('keydown', onGlobalKeydown)
  document.documentElement.classList.remove('is-chat-split-dragging')
  window.clearTimeout(toastTimer)
  if (document.fullscreenElement) void document.exitFullscreen()
})
</script>

<template>
  <div class="shell" :class="{ immersive }">
    <header v-show="!immersive" class="top">
      <div class="brand">
        <h1>AI Agent VRM</h1>
        <p>VRM playground — chat, voice, character tools</p>
      </div>
      <div class="top-actions">
        <button
          type="button"
          :class="{ primary: settings.demoMode }"
          :aria-pressed="settings.demoMode"
          title="Demo mode: Hoodie, Tori, Curt, Apollo, Bob, Sample"
          @click="toggleDemoMode"
        >
          Demo{{ settings.demoMode ? ' · on' : '' }}
        </button>
        <button
          type="button"
          :class="{ primary: showMotionDebug }"
          title="Test gestures, moods, ambient routines"
          @click="showMotionDebug ? (showMotionDebug = false) : openMotionDebug()"
        >
          Motion
        </button>
        <button type="button" @click="showSettings = !showSettings">Settings</button>
        <button type="button" @click="openAddAgentDialog">+ Agent</button>
      </div>
    </header>

    <MotionDebugOverlay
      v-model:loop="motionDebugLoop"
      :open="showMotionDebug"
      :gestures="motionDebugGestures"
      :expressions="motionDebugExpressions"
      :moods="motionDebugMoods"
      :current-mood-id="motionDebugMoodId"
      :log-line="motionDebugLog"
      :actions="motionActionFeed"
      @close="showMotionDebug = false"
      @refresh="refreshMotionDebug"
      @clear-feed="clearMotionActionFeed"
      @play-gesture="onDebugPlayGesture"
      @set-mood="onDebugSetMood"
      @set-emotion="onDebugSetEmotion"
      @set-expression="onDebugSetExpression"
      @reset-face="onDebugResetFace"
      @reset-presence="onDebugResetPresence"
      @force-long-rest="onDebugForceLongRest"
    />

    <div
      ref="workspaceEl"
      class="workspace"
      :class="{ 'with-settings': showSettings && !immersive, splitting: splittingChat, immersive }"
    >
      <aside v-if="showSettings && !immersive" class="settings">
        <h2>Voice &amp; media</h2>
        <div class="field">
          <label>LLM runtime</label>
          <select v-model="settings.llmRuntime">
            <option value="tools">Tools (OpenRouter) — VRM tool_calls</option>
            <option value="hermes">Gateway agent — no client tools</option>
          </select>
        </div>
        <template v-if="settings.llmRuntime === 'tools'">
          <div class="field">
            <label>OpenRouter API key</label>
            <input v-model="settings.openrouterApiKey" type="password" />
          </div>
          <div class="field">
            <label>OpenRouter base URL</label>
            <input v-model="settings.openrouterBaseUrl" />
            <p class="hint">
              Per-agent Base URL ending in <code>/v1</code> overrides this for that tab.
            </p>
          </div>
        </template>
        <div class="field">
          <label>STT provider</label>
          <select v-model="settings.sttProvider">
            <option value="browser-whisper">Browser Whisper (default)</option>
            <option value="speaches">Speaches sidecar</option>
          </select>
        </div>
        <div v-if="settings.sttProvider === 'browser-whisper'" class="field">
          <label>Whisper model</label>
          <input v-model="settings.whisperModel" />
        </div>
        <template v-else>
          <div class="field">
            <label>Speaches URL</label>
            <input v-model="settings.speachesUrl" />
          </div>
          <div class="field">
            <label>Speaches API key</label>
            <input v-model="settings.speachesKey" type="password" />
          </div>
        </template>
        <div class="field">
          <label>
            <input v-model="settings.ttsEnabled" type="checkbox" /> Enable Fish TTS
          </label>
        </div>
        <div class="field">
          <label>
            <input v-model="settings.inlineCharacterTags" type="checkbox" />
            Inline motion tags ([nod,2s,wave]) — env VITE_INLINE_CHARACTER_TAGS
          </label>
        </div>
        <div class="field">
          <label>
            <input v-model="settings.debugCharacterTags" type="checkbox" />
            Debug: show stripped tags as badges
          </label>
        </div>
        <div class="field">
          <label>Fish API key</label>
          <input v-model="settings.fishApiKey" type="password" />
        </div>
        <div class="field">
          <label>Fish reference / voice id</label>
          <input v-model="settings.fishReferenceId" />
        </div>
        <div class="field">
          <label>Default VRM URL (fallback)</label>
          <input v-model="settings.vrmUrl" />
          <p class="hint">Per-agent model is set under the agent tabs.</p>
        </div>
        <div class="field">
          <label>Gesture manifest URL</label>
          <input v-model="settings.gestureManifestUrl" />
        </div>
        <div class="field">
          <label>System prompt</label>
          <textarea v-model="settings.systemPrompt" rows="4" />
          <p class="hint">
            <code>{{ '{agent}' }}</code> becomes the active tab name. The VRM mesh
            (filename) is appearance only.
          </p>
        </div>
        <div v-if="activePane" class="field">
          <label>Active agent vocabulary</label>
          <textarea
            :value="activePane.vocabulary.join(', ')"
            rows="3"
            @change="updateVocab(($event.target as HTMLTextAreaElement).value)"
          />
        </div>
        <p class="hint">Last transcript: {{ lastTranscript || '—' }}</p>
      </aside>

      <div
        ref="stageRootEl"
        class="stage-root"
        :class="{ immersive, 'chat-collapsed': immersive && chatCollapsed }"
        :style="{ '--chat-col': `${settings.chatColumnPx}px` }"
        @pointerdown="onStageRootPointerDown"
      >
      <section
        ref="chatColumnEl"
        class="chat-column"
        :class="{ docked: immersive, collapsed: immersive && chatCollapsed }"
        @pointerenter="onChatPointerEnter"
        @pointerleave="onChatPointerLeave"
        @focusin="onChatFocusIn"
        @focusout="onChatFocusOut"
      >
        <button
          v-if="immersive"
          type="button"
          class="chat-fab"
          :class="{ open: !chatCollapsed }"
          :title="chatCollapsed ? 'Open chat' : 'Hide chat'"
          :aria-expanded="!chatCollapsed"
          @click.stop="toggleChatDock"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="currentColor"
              d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2Z"
            />
          </svg>
          <span>{{ chatCollapsed ? activePane?.label || 'Chat' : 'Hide' }}</span>
        </button>
        <div v-show="!immersive || !chatCollapsed" class="chat-body">
        <div class="agent-tabs" role="tablist" aria-label="Agents">
          <button
            v-for="pane in panes"
            :key="pane.id"
            type="button"
            role="tab"
            class="tab"
            :class="{ active: pane.id === activePaneId }"
            :aria-selected="pane.id === activePaneId"
            :aria-haspopup="'menu'"
            @click="activePaneId = pane.id"
            @contextmenu.prevent="openTabMenu($event, pane.id)"
          >
            <span class="tab-label">{{ pane.label }}</span>
            <span
              class="tab-menu-btn"
              title="Agent menu"
              @click.stop="openTabMenu($event, pane.id)"
            >⋮</span>
            <span
              v-if="panes.length > 1"
              class="tab-close"
              title="Remove agent"
              @click.stop="removePane(pane.id)"
            >×</span>
          </button>
          <button type="button" class="tab add" title="Add agent" @click="openAddAgentDialog">+</button>
        </div>
        <div
          v-if="activePane"
          class="agent-avatar-bar"
          :class="{ collapsed: !showAgentConfig }"
        >
          <button
            type="button"
            class="avatar-bar-toggle"
            :aria-expanded="showAgentConfig"
            @click="showAgentConfig = !showAgentConfig"
          >
            <span class="toggle-label">Avatar</span>
            <span v-if="!showAgentConfig" class="toggle-summary">{{ agentConfigSummary }}</span>
            <span class="toggle-chevron" aria-hidden="true">{{ showAgentConfig ? '▴' : '▾' }}</span>
          </button>
          <div v-show="showAgentConfig" class="avatar-bar-body">
            <div class="bar-row">
              <label class="bar-field">
                <span>Mood</span>
                <select
                  :value="activePane.defaultMood || 'neutral'"
                  @change="
                    patchPane(activePane.id, {
                      defaultMood: ($event.target as HTMLSelectElement).value,
                    })
                  "
                >
                  <option v-for="m in MOOD_CATALOG" :key="m.id" :value="m.id">{{ m.label }}</option>
                </select>
              </label>
              <label class="bar-field grow">
                <span>VRM</span>
                <select
                  :value="activePane.vrmUrl || activeVrmUrl"
                  @change="onSelectVrm(($event.target as HTMLSelectElement).value)"
                >
                  <option v-for="v in visibleVrmCatalog" :key="v.id" :value="v.url">{{ v.label }}</option>
                </select>
              </label>
            </div>
            <div class="bar-row">
              <ClothesPicker
                :groups="clothesGroups"
                :selected-ids="clothesSelectedIds"
                :all-selected="clothesAllSelected"
                :overlay-id="activePane.clothesOverlayId || ''"
                :overlay-options="visibleOverlayCatalog"
                :overlay-items="overlayAddableItems"
                :overlay-checked-ids="overlayCheckedIds"
                :overlay-loading="overlayCatalogLoading"
                :overlay-transforms="overlayTransforms"
                :applied-count="overlayAppliedCount"
                @toggle="onToggleClothes"
                @all="persistNativeClothes(undefined)"
                @none="persistNativeClothes([])"
                @set-overlay="onClothesOverlay"
                @toggle-overlay="onToggleOverlayItem"
                @update-overlay-transform="onOverlayTransform"
              />
            </div>
          </div>
        </div>
        <ChatPane
          v-if="activePane"
          :key="activePane.id"
          tabbed
          :pane="activePane"
          :busy="busy && activePaneId === activePane.id"
          :wait-hint="chatWaitHint"
          :call-active="inCall && callPaneId === activePane.id"
          :call-status="callPaneId === activePane.id ? callStatus : ''"
          :inline-tags-enabled="settings.inlineCharacterTags"
          :debug-tags="settings.debugCharacterTags"
          :tag-catalog="currentTagCatalog()"
          :openrouter-base-url="settings.openrouterBaseUrl"
          :openrouter-api-key="settings.openrouterApiKey || envOr"
          @send="onSend(activePane, $event)"
          @update="patchPane(activePane.id, $event)"
          @remove="removePane(activePane.id)"
          @reset-session="resetSession(activePane.id)"
          @check-health="checkHealth(activePane.id)"
          @toggle-call="toggleVoiceCall(activePane)"
        />
        <button
          type="button"
          class="split-handle"
          aria-label="Resize chat column"
          :aria-valuenow="Math.round(settings.chatColumnPx)"
          title="Drag to resize chat · double-click to reset"
          @pointerdown="onSplitPointerDown"
          @pointermove="onSplitPointerMove"
          @pointerup="endSplitDrag"
          @pointercancel="endSplitDrag"
          @dblclick="resetChatSplit"
          @keydown="onSplitKeydown"
        />
        </div>
      </section>

      <div class="stage">
        <CharacterViewport
          ref="viewportRef"
          :vrm-url="activeVrmUrl"
          :gesture-manifest-url="settings.gestureManifestUrl"
          :clothes-id="activeClothes.id"
          :clothes-ids="activeClothes.ids"
          :clothes-overlay-pieces="activeClothes.overlayPieces"
          :pointer-look="settings.pointerLook"
          :body-follow-camera="settings.bodyFollowCamera === true"
          :gaze-head-yaw-max-deg="settings.gazeHeadYawMaxDeg"
          :gaze-eye-yaw-max-deg="settings.gazeEyeYawMaxDeg"
          :click-ack-enabled="activePane?.clickAckEnabled !== false"
          :click-ack-gesture="activePane?.clickAckGesture || 'nod'"
          :click-ack-speed="activePane?.clickAckSpeed ?? DEFAULT_NOD_TIME_SCALE"
          :zoom-ack-enabled="activePane?.zoomAckEnabled !== false"
          :zoom-in-gesture="activePane?.zoomInGesture || 'v_sign'"
          :zoom-out-gesture="activePane?.zoomOutGesture || 'wave'"
          :expanded="expanded"
          :fullscreen="nativeFullscreen"
          @update:pointer-look="settings.pointerLook = $event"
          @update:body-follow-camera="settings.bodyFollowCamera = $event"
          @update:gaze-head-yaw-max-deg="settings.gazeHeadYawMaxDeg = $event"
          @update:gaze-eye-yaw-max-deg="settings.gazeEyeYawMaxDeg = $event"
          @update:click-ack-enabled="activePane && patchPane(activePane.id, { clickAckEnabled: $event })"
          @update:click-ack-gesture="activePane && patchPane(activePane.id, { clickAckGesture: $event })"
          @update:click-ack-speed="activePane && patchPane(activePane.id, { clickAckSpeed: $event })"
          @update:zoom-ack-enabled="activePane && patchPane(activePane.id, { zoomAckEnabled: $event })"
          @update:zoom-in-gesture="activePane && patchPane(activePane.id, { zoomInGesture: $event })"
          @update:zoom-out-gesture="activePane && patchPane(activePane.id, { zoomOutGesture: $event })"
          @ready="onViewportReady"
          @locomoting="onViewportLocomoting"
          @toggle-expand="toggleExpanded"
          @toggle-fullscreen="toggleNativeFullscreen"
        />
        <AudioDock
          data-audio-dock
          class="audio-dock"
          :user-energy="userEnergy"
          :bot-energy="botEnergy"
          :user-active="userSpeaking || pttRecording"
          :bot-active="botSpeaking"
          :mic-muted="dockMicMuted"
          :bot-muted="botMuted"
          :recording="pttRecording"
          :status="dockStatus"
          @toggle-mic="toggleMic"
          @toggle-bot-mute="toggleBotMute"
          @record-down="onRecordPointerDown"
          @record-up="onRecordPointerUp"
          @record-cancel="onRecordCancel"
        />
      </div>
      </div>
    </div>

    <AgentTabMenu
      :open="Boolean(tabMenu && tabMenuPane)"
      :x="tabMenu?.x ?? 0"
      :y="tabMenu?.y ?? 0"
      :label="tabMenuPane?.label ?? ''"
      :can-remove="panes.length > 1"
      @close="tabMenu = null"
      @export="tabMenuPane && exportPane(tabMenuPane.id)"
      @edit="tabMenuPane && openEditPane(tabMenuPane.id)"
      @remove="removeMenuPane"
    />
    <AgentAddDialog
      :open="showAddAgent"
      :clipboard-text="addClipboardText"
      @close="closeAddAgentDialog"
      @blank="addPane"
      @import="importAgentConfig"
    />
    <AgentEditDialog
      :open="Boolean(editPane)"
      :pane="editPane"
      :initial-tab="editStartTab"
      :vrm-catalog="visibleVrmCatalog"
      :mood-catalog="MOOD_CATALOG"
      :openrouter-base-url="settings.openrouterBaseUrl"
      :openrouter-api-key="settings.openrouterApiKey || envOr"
      @close="editPaneId = null; editStartTab = 'form'"
      @save="saveEditedAgent"
      @reset-session="editPaneId && resetSession(editPaneId)"
      @check-health="editPaneId && checkHealth(editPaneId)"
    />
    <p v-if="toast" class="toast" role="status">{{ toast }}</p>
  </div>
</template>

<style scoped>
.shell {
  height: 100%;
  min-height: 100%;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 0.85rem 1rem 1rem;
  box-sizing: border-box;
}
.shell.immersive {
  padding: 0;
  gap: 0;
}
.top {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  flex-shrink: 0;
}
.brand h1 {
  margin: 0;
  font-family: var(--font-display);
  font-size: clamp(1.75rem, 3.5vw, 2.4rem);
  font-weight: 400;
  letter-spacing: 0.01em;
  line-height: 1;
}
.brand p {
  margin: 0.2rem 0 0;
  color: var(--muted);
  font-size: 0.85rem;
}
.top-actions {
  display: flex;
  gap: 0.45rem;
  flex-wrap: wrap;
}
.workspace {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.85rem;
}
.workspace.with-settings {
  grid-template-columns: minmax(220px, 260px) 1fr;
}
.workspace.immersive {
  gap: 0;
}
.stage-root {
  display: grid;
  grid-template-columns: var(--chat-col, 380px) 1fr;
  gap: 0.85rem;
  min-height: 0;
  min-width: 0;
}
.stage-root:fullscreen {
  width: 100%;
  height: 100%;
  background: #0a0c0e;
}
.stage-root.immersive {
  display: block;
  position: relative;
  height: 100%;
  min-height: 0;
  background: #0a0c0e;
}
.settings {
  background: var(--bg-pane);
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 0.85rem;
  overflow: auto;
  min-height: 0;
}
.settings h2 {
  margin: 0 0 0.75rem;
  font-family: var(--font-display);
  font-weight: 400;
  font-size: 1.25rem;
}
.hint {
  font-size: 0.75rem;
  color: var(--muted);
}
.chat-column {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
}
.chat-body {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  min-width: 0;
}
.chat-fab {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  width: fit-content;
  margin: 0;
  padding: 0.38rem 0.7rem 0.38rem 0.5rem;
  border-radius: 999px;
  background: rgba(12, 16, 20, 0.88);
  border: 1px solid var(--line);
  color: var(--ink);
  font-size: 0.78rem;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  pointer-events: auto;
}
.chat-fab svg {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
  color: var(--accent);
}
.chat-fab.open {
  align-self: flex-start;
}
.stage-root.immersive .chat-column.docked {
  position: absolute;
  left: 12px;
  top: 12px;
  z-index: 8;
  width: min(var(--chat-col, 380px), calc(100% - 24px));
  max-height: calc(100% - 24px);
  pointer-events: none;
}
.stage-root.immersive .chat-column.docked > * {
  pointer-events: auto;
}
.stage-root.immersive .chat-column.docked.collapsed {
  width: auto;
}
.stage-root.immersive .chat-column.docked:not(.collapsed) {
  height: calc(100% - 96px);
  max-height: calc(100% - 96px);
}
.stage-root.immersive .chat-column.docked .split-handle {
  display: none;
}
.stage-root.immersive .stage {
  position: absolute;
  inset: 0;
}
.stage-root.immersive :deep(.viewport) {
  border-radius: 0;
  border: none;
  min-height: 100%;
}
.split-handle {
  position: absolute;
  top: 0;
  right: -0.7rem;
  width: 0.85rem;
  height: 100%;
  z-index: 4;
  cursor: col-resize;
  touch-action: none;
  border: none;
  border-radius: 0;
  padding: 0;
  background: transparent;
}
.split-handle::after {
  content: '';
  position: absolute;
  top: 18%;
  bottom: 18%;
  left: 50%;
  width: 3px;
  transform: translateX(-50%);
  border-radius: 999px;
  background: var(--line);
  transition: background 0.15s ease;
}
.split-handle:hover::after,
.split-handle:focus-visible::after,
.workspace.splitting .split-handle::after {
  background: var(--accent);
}
.agent-tabs {
  display: flex;
  align-items: stretch;
  gap: 0;
  overflow-x: auto;
  border: 1px solid var(--line);
  border-bottom: none;
  border-radius: 14px 14px 0 0;
  background: #0c1014;
}
.agent-avatar-bar {
  display: flex;
  flex-direction: column;
  gap: 0;
  background: #0e1318;
  border: 1px solid var(--line);
  border-bottom: none;
  flex-shrink: 0;
}
.agent-avatar-bar.collapsed {
  padding: 0;
}
.avatar-bar-toggle {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  margin: 0;
  padding: 0.35rem 0.65rem;
  border: none;
  border-radius: 0;
  background: transparent;
  color: var(--muted);
  font-size: 0.7rem;
  text-align: left;
  cursor: pointer;
}
.avatar-bar-toggle:hover {
  color: var(--ink);
  background: rgba(255, 255, 255, 0.03);
}
.toggle-label {
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-size: 0.65rem;
  flex-shrink: 0;
}
.toggle-summary {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-transform: none;
  letter-spacing: 0;
  font-size: 0.75rem;
  color: var(--ink);
}
.toggle-chevron {
  margin-left: auto;
  flex-shrink: 0;
  font-size: 0.7rem;
}
.avatar-bar-body {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding: 0 0.65rem 0.45rem;
}
.bar-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.55rem;
  align-items: flex-end;
}
.bar-field {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 7.5rem;
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--muted);
}
.bar-field.grow {
  flex: 1;
  min-width: 10rem;
}
.bar-field select {
  text-transform: none;
  letter-spacing: 0;
  font-size: 0.85rem;
  padding: 0.35rem 0.45rem;
}
.tab {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  border: none;
  border-right: 1px solid var(--line);
  border-radius: 0;
  background: transparent;
  color: var(--muted);
  padding: 0.55rem 0.85rem;
  font-family: var(--font-display);
  font-size: 1.05rem;
  white-space: nowrap;
}
.tab:hover {
  color: var(--ink);
  background: rgba(255, 255, 255, 0.03);
}
.tab.active {
  color: var(--ink);
  background: var(--bg-pane);
  box-shadow: inset 0 -2px 0 var(--accent);
}
.tab.add {
  border-right: none;
  margin-left: auto;
  font-family: var(--font-body);
  font-size: 1.1rem;
  color: var(--accent);
}
.tab-close {
  display: inline-flex;
  width: 1.1rem;
  height: 1.1rem;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  font-family: var(--font-body);
  font-size: 0.85rem;
  opacity: 0.55;
}
.tab-menu-btn {
  display: inline-flex;
  width: 1.1rem;
  height: 1.1rem;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  font-family: var(--font-body);
  font-size: 0.95rem;
  line-height: 1;
  opacity: 0.4;
}
.tab:hover .tab-menu-btn,
.tab.active .tab-menu-btn {
  opacity: 0.8;
}
.tab-menu-btn:hover {
  opacity: 1;
  background: rgba(255, 255, 255, 0.08);
  color: var(--ink);
}
.tab-close:hover {
  opacity: 1;
  background: rgba(212, 116, 106, 0.25);
  color: var(--danger);
}
.toast {
  position: fixed;
  left: 50%;
  bottom: 1.25rem;
  transform: translateX(-50%);
  z-index: 140;
  margin: 0;
  padding: 0.45rem 0.8rem;
  border-radius: 999px;
  background: rgba(18, 23, 28, 0.94);
  border: 1px solid var(--line);
  color: var(--ink);
  font-size: 0.8rem;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}
.stage {
  position: relative;
  min-height: 0;
  min-width: 0;
}
.audio-dock {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 6;
}
@media (max-width: 960px) {
  .workspace,
  .workspace.with-settings {
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr;
  }
  .workspace.with-settings .settings {
    grid-row: 1;
  }
  .stage-root {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(280px, 45vh) minmax(320px, 50vh);
  }
  .chat-column {
    min-height: 45vh;
  }
  .split-handle {
    display: none;
  }
  .stage {
    min-height: 320px;
  }
  .stage-root.immersive {
    grid-template-rows: 1fr;
  }
  .stage-root.immersive .chat-column {
    min-height: 0;
  }
}
</style>
