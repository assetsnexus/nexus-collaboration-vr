<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import ModelPicker from './ModelPicker.vue'
import {
  parseAgentExport,
  stringifyAgentExport,
  type AgentExportConfig,
} from '../lib/agent-export'
import { type AgentPane } from '../lib/storage'
import { LLM_HTTPS_DEFAULT, LLM_PROXY, playgroundFetchBase, resolveToolsEndpoint } from '../lib/llm-endpoint'

const props = defineProps<{
  open: boolean
  pane: AgentPane | null
  initialTab?: 'form' | 'json'
  vrmCatalog: Array<{ id: string; label: string; url: string }>
  moodCatalog: Array<{ id: string; label: string }>
  openrouterBaseUrl: string
  openrouterApiKey?: string
}>()

const emit = defineEmits<{
  close: []
  save: [patch: AgentExportConfig, opts: { replaceWardrobe: boolean }]
  resetSession: []
  checkHealth: []
}>()

const tab = ref<'form' | 'json'>('form')
const jsonText = ref('')
const jsonError = ref('')
const draft = ref<AgentExportConfig>({ label: 'Agent' })

const picker = computed(() =>
  resolveToolsEndpoint({
    paneBaseUrl: draft.value.baseUrl ?? '',
    paneApiKey: draft.value.apiKey ?? '',
    openrouterBaseUrl: props.openrouterBaseUrl,
    openrouterApiKey: props.openrouterApiKey ?? '',
  }),
)

const vocabText = computed({
  get: () => (draft.value.vocabulary ?? []).join(', '),
  set: (raw: string) => {
    draft.value = {
      ...draft.value,
      vocabulary: raw
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter(Boolean),
    }
  },
})

function loadFromPane(pane: AgentPane) {
  jsonError.value = ''
  draft.value = {
    label: pane.label,
    baseUrl: pane.baseUrl,
    apiKey: pane.apiKey,
    model: pane.model,
    vocabulary: [...pane.vocabulary],
    defaultMood: pane.defaultMood || 'neutral',
    vrmUrl: pane.vrmUrl,
    clothesId: pane.clothesId,
    clothesIds: pane.clothesIds ? [...pane.clothesIds] : undefined,
    clothesOverlayId: pane.clothesOverlayId,
    clothesOverlayItems: pane.clothesOverlayItems,
    wardrobeByModel: pane.wardrobeByModel,
  }
  jsonText.value = stringifyAgentExport(draft.value)
  tab.value = props.initialTab === 'json' ? 'json' : 'form'
  if (tab.value === 'json') {
    void nextTick(() => {
      const el = document.getElementById('agent-json')
      if (el instanceof HTMLTextAreaElement) {
        el.focus()
        el.select()
      }
    })
  }
}

function syncJsonFromDraft() {
  jsonText.value = stringifyAgentExport(draft.value)
  jsonError.value = ''
}

function applyJsonToDraft(): boolean {
  const result = parseAgentExport(jsonText.value)
  if (!result.ok) {
    jsonError.value = result.error
    return false
  }
  jsonError.value = ''
  draft.value = {
    ...draft.value,
    ...result.agent,
    clothesId: result.agent.clothesId ?? draft.value.clothesId,
    clothesIds: result.agent.clothesIds ?? draft.value.clothesIds,
    clothesOverlayId: result.agent.clothesOverlayId ?? draft.value.clothesOverlayId,
    clothesOverlayItems: result.agent.clothesOverlayItems ?? draft.value.clothesOverlayItems,
    wardrobeByModel: result.agent.wardrobeByModel ?? draft.value.wardrobeByModel,
  }
  return true
}

function switchTab(next: 'form' | 'json') {
  if (next === tab.value) return
  if (tab.value === 'json' && !applyJsonToDraft()) return
  if (next === 'json') syncJsonFromDraft()
  tab.value = next
}

function save() {
  if (tab.value === 'json' && !applyJsonToDraft()) return
  const label = draft.value.label.trim()
  if (!label) {
    jsonError.value = 'Agent name is required'
    tab.value = 'form'
    return
  }
  emit('save', { ...draft.value, label }, { replaceWardrobe: tab.value === 'json' })
}

function hermesHttps() {
  draft.value = { ...draft.value, baseUrl: LLM_HTTPS_DEFAULT }
}

function hermesProxy() {
  draft.value = { ...draft.value, baseUrl: LLM_PROXY }
}

function onDocKey(ev: KeyboardEvent) {
  if (!props.open) return
  if (ev.key === 'Escape') {
    ev.preventDefault()
    emit('close')
  }
}

watch(
  () => [props.open, props.pane?.id] as const,
  ([open]) => {
    if (!open || !props.pane) return
    loadFromPane(props.pane)
  },
)

watch(
  () => props.open,
  (open) => {
    if (open) document.addEventListener('keydown', onDocKey)
    else document.removeEventListener('keydown', onDocKey)
  },
)

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onDocKey)
})
</script>

<template>
  <Teleport to="body">
    <div v-if="open && pane" class="backdrop" @click.self="emit('close')">
      <div class="panel" role="dialog" aria-labelledby="agent-edit-title" aria-modal="true">
        <header class="head">
          <div>
            <h2 id="agent-edit-title">Edit {{ pane.label }}</h2>
            <p class="sub">Connection, avatar, and the JSON you can export.</p>
          </div>
          <button type="button" class="ghost" @click="emit('close')">Close</button>
        </header>

        <nav class="tabs" aria-label="Edit views">
          <button type="button" class="tab" :class="{ active: tab === 'form' }" @click="switchTab('form')">
            Form
          </button>
          <button type="button" class="tab" :class="{ active: tab === 'json' }" @click="switchTab('json')">
            JSON
          </button>
        </nav>

        <div v-show="tab === 'form'" class="form">
          <div class="field">
            <label>Agent name</label>
            <input :value="draft.label" @input="draft.label = ($event.target as HTMLInputElement).value" />
          </div>
          <div class="field">
            <label>Base URL</label>
            <input :value="draft.baseUrl" @input="draft.baseUrl = ($event.target as HTMLInputElement).value" />
            <p class="hint">
              OpenAI-compatible bases end with <code>/v1</code>. Use <strong>Proxy</strong> for the
              Vite <code>/api/llm</code> rewrite, or paste any <code>/v1</code> URL for Tools runtime.
            </p>
          </div>
          <div class="url-modes">
            <button type="button" title="Self-signed HTTPS API" @click="hermesHttps">HTTPS</button>
            <button type="button" title="Vite proxy (no cert)" @click="hermesProxy">Proxy</button>
            <button type="button" @click="emit('checkHealth')">Check</button>
          </div>
          <div class="field">
            <label>API key</label>
            <input
              type="password"
              :value="draft.apiKey"
              @input="draft.apiKey = ($event.target as HTMLInputElement).value"
            />
          </div>
          <div class="field model-row">
            <label>Chat model</label>
            <ModelPicker
              :model="draft.model || ''"
              :base-url="playgroundFetchBase(picker.baseUrl)"
              :api-key="picker.apiKey"
              @update:model="draft.model = $event"
            />
            <span class="model-id">{{ draft.model }}</span>
          </div>
          <div class="field">
            <label>Session</label>
            <div class="session-row">
              <input :value="pane.sessionId" readonly />
              <button type="button" title="New session (clears chat, keeps avatar)" @click="emit('resetSession')">↻</button>
            </div>
          </div>
          <div class="row">
            <label class="field grow">
              Mood
              <select
                :value="draft.defaultMood || 'neutral'"
                @change="draft.defaultMood = ($event.target as HTMLSelectElement).value"
              >
                <option v-for="m in moodCatalog" :key="m.id" :value="m.id">{{ m.label }}</option>
              </select>
            </label>
            <label class="field grow">
              VRM
              <select
                :value="draft.vrmUrl"
                @change="draft.vrmUrl = ($event.target as HTMLSelectElement).value"
              >
                <option v-for="v in vrmCatalog" :key="v.id" :value="v.url">{{ v.label }}</option>
              </select>
            </label>
          </div>
          <div class="field">
            <label>Vocabulary</label>
            <textarea v-model="vocabText" rows="3" />
          </div>
          <p class="hint">Clothes stay in the Avatar bar. Wardrobe is in the JSON tab.</p>
        </div>

        <div v-show="tab === 'json'" class="json">
          <label for="agent-json">Export JSON</label>
          <textarea id="agent-json" v-model="jsonText" rows="16" />
          <p class="hint">Includes API key. Messages and session id are not exported.</p>
        </div>

        <p v-if="jsonError" class="error">{{ jsonError }}</p>
        <footer class="foot">
          <button type="button" @click="emit('close')">Cancel</button>
          <button type="button" class="primary" @click="save">Save</button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 110;
  background: rgba(6, 8, 10, 0.62);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  box-sizing: border-box;
}
.panel {
  width: min(520px, 100%);
  max-height: calc(100vh - 2rem);
  overflow: auto;
  background: var(--bg-pane, #12171c);
  border: 1px solid var(--line, #2a333d);
  border-radius: 14px;
  padding: 0.9rem 1rem 1rem;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
}
.head {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  align-items: flex-start;
  margin-bottom: 0.65rem;
}
.head h2 {
  margin: 0;
  font-family: var(--font-display, Georgia, serif);
  font-weight: 400;
  font-size: 1.35rem;
}
.sub {
  margin: 0.2rem 0 0;
  font-size: 0.75rem;
  color: var(--muted, #8b97a5);
}
.ghost {
  background: transparent;
}
.tabs {
  display: flex;
  gap: 0.25rem;
  margin: 0 0 0.75rem;
}
.tab {
  border: 1px solid var(--line, #2a333d);
  background: #0c1014;
  color: var(--muted, #8b97a5);
  border-radius: 8px;
  padding: 0.28rem 0.6rem;
  font-size: 0.75rem;
}
.tab.active {
  border-color: var(--accent, #c4a35a);
  color: var(--ink, #e8edf2);
  background: rgba(196, 163, 90, 0.12);
}
.row {
  display: flex;
  gap: 0.55rem;
  flex-wrap: wrap;
}
.grow {
  flex: 1;
  min-width: 8rem;
}
.url-modes,
.session-row,
.foot {
  display: flex;
  gap: 0.35rem;
  flex-wrap: wrap;
}
.url-modes {
  margin: -0.35rem 0 0.65rem;
}
.session-row input {
  flex: 1;
  min-width: 0;
}
.model-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.45rem;
}
.model-id {
  font-size: 0.72rem;
  color: var(--muted, #8b97a5);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.json textarea {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.72rem;
  min-height: 220px;
}
.hint {
  margin: 0.35rem 0 0;
  font-size: 0.72rem;
  color: var(--muted, #8b97a5);
}
.error {
  margin: 0.45rem 0 0;
  font-size: 0.75rem;
  color: var(--danger, #d4746a);
}
.foot {
  justify-content: flex-end;
  margin-top: 0.85rem;
}
</style>
