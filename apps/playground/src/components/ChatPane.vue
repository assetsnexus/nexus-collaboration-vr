<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import ModelPicker from './ModelPicker.vue'
import type { AgentPane } from '../lib/storage'
import { LLM_HTTPS_DEFAULT, LLM_PROXY, playgroundFetchBase, resolveToolsEndpoint } from '../lib/llm-endpoint'
import { hermesTrustUrl, type ChatMessage } from '../lib/hermes'
import {
  defaultInlineCatalog,
  parseInlineTags,
  type InlineTagCatalog,
} from '@openclaw/character-kit'
import { isNearBottom, scrollToBottom } from '../lib/stick-to-bottom'

const props = defineProps<{
  pane: AgentPane
  busy: boolean
  /** When true, agent name is shown in outer tabs — hide big title */
  tabbed?: boolean
  /** Live voice call active for this pane */
  callActive?: boolean
  callStatus?: string
  inlineTagsEnabled?: boolean
  debugTags?: boolean
  tagCatalog?: InlineTagCatalog
  openrouterBaseUrl?: string
  openrouterApiKey?: string
  waitHint?: string
}>()

const emit = defineEmits<{
  send: [payload: { text: string; files: File[] }]
  update: [patch: Partial<AgentPane>]
  remove: []
  resetSession: []
  checkHealth: []
  toggleCall: []
}>()

const draft = ref('')
const files = ref<File[]>([])
const fileInput = ref<HTMLInputElement | null>(null)
const showConn = ref(false)
const messagesEl = ref<HTMLElement | null>(null)
const messagesInnerEl = ref<HTMLElement | null>(null)
const stickToBottom = ref(true)
let contentResizeObserver: ResizeObserver | null = null

function onMessagesScroll() {
  const el = messagesEl.value
  if (!el) return
  stickToBottom.value = isNearBottom(el)
}

function flushScroll() {
  const el = messagesEl.value
  if (!el || !stickToBottom.value) return
  scrollToBottom(el)
}

function scheduleScroll() {
  void nextTick(() => {
    flushScroll()
    requestAnimationFrame(flushScroll)
  })
}

const displayMessages = computed(() =>
  props.pane.messages.filter(
    (m) => m.role === 'user' || m.role === 'assistant' || m.role === 'tool',
  ),
)

const trustUrl = computed(
  () => props.pane.lastTrustUrl || hermesTrustUrl(props.pane.baseUrl),
)

const picker = computed(() =>
  resolveToolsEndpoint({
    paneBaseUrl: props.pane.baseUrl,
    paneApiKey: props.pane.apiKey,
    openrouterBaseUrl: props.openrouterBaseUrl || 'https://openrouter.ai/api/v1',
    openrouterApiKey: props.openrouterApiKey ?? '',
  }),
)

const showTrustHint = computed(
  () =>
    props.pane.lastErrorKind === 'ssl' ||
    props.pane.lastErrorKind === 'network' ||
    props.pane.baseUrl.startsWith('https://'),
)

function onPaste(e: ClipboardEvent) {
  const items = e.clipboardData?.files
  if (!items?.length) return
  const next = [...files.value]
  for (const f of items) next.push(f)
  files.value = next
}

function onFilePick(e: Event) {
  const input = e.target as HTMLInputElement
  if (!input.files?.length) return
  files.value = [...files.value, ...Array.from(input.files)]
  input.value = ''
}

function submit() {
  const text = draft.value
  const f = files.value
  if (!text.trim() && !f.length) return
  stickToBottom.value = true
  emit('send', { text, files: f })
  draft.value = ''
  files.value = []
  scheduleScroll()
}

watch(
  () => {
    const msgs = displayMessages.value
    const last = msgs[msgs.length - 1]
    return [
      msgs.length,
      last?.role,
      typeof last?.content === 'string' ? last.content : JSON.stringify(last?.content ?? null),
      last?.tool_calls?.length ?? 0,
      props.busy,
    ]
  },
  () => scheduleScroll(),
)

onMounted(() => {
  scheduleScroll()
  const inner = messagesInnerEl.value
  if (!inner || typeof ResizeObserver === 'undefined') return
  contentResizeObserver = new ResizeObserver(() => flushScroll())
  contentResizeObserver.observe(inner)
})

onBeforeUnmount(() => {
  contentResizeObserver?.disconnect()
  contentResizeObserver = null
})

function previewContent(m: ChatMessage): string {
  let raw = ''
  if (typeof m.content === 'string') raw = m.content
  else if (Array.isArray(m.content)) {
    raw = m.content
      .map((p) => {
        if (p.type === 'text') return String(p.text ?? '')
        if (p.type === 'image_url') return '[image]'
        return ''
      })
      .join(' ')
  } else if (m.tool_calls?.length) {
    return ''
  } else {
    return ''
  }
  if (m.role !== 'assistant' || props.inlineTagsEnabled === false) return raw
  return parseInlineTags(raw, props.tagCatalog ?? defaultInlineCatalog(), {
    enabled: true,
  }).displayText
}

function messageBadges(m: ChatMessage) {
  if (!props.debugTags || m.role !== 'assistant') return []
  const raw = typeof m.content === 'string' ? m.content : ''
  if (!raw) return []
  return parseInlineTags(raw, props.tagCatalog ?? defaultInlineCatalog(), {
    enabled: props.inlineTagsEnabled !== false,
  }).badges
}

function toolCallCards(m: ChatMessage) {
  return (m.tool_calls ?? []).map((t) => {
    let args: unknown = t.function.arguments
    try {
      args = JSON.parse(t.function.arguments)
    } catch {
      /* keep raw */
    }
    return {
      id: t.id,
      name: t.function.name,
      args,
    }
  })
}

function toolResultPreview(m: ChatMessage): string {
  if (typeof m.content !== 'string') return ''
  try {
    const j = JSON.parse(m.content) as { ok?: boolean; name?: string; message?: string }
    const mark = j.ok === false ? '✗' : '✓'
    return `${mark} ${j.name ?? 'tool'}: ${j.message ?? m.content}`
  } catch {
    return m.content.slice(0, 200)
  }
}

function openTrustTab() {
  window.open(trustUrl.value, '_blank', 'noopener,noreferrer')
}

function useHttps() {
  emit('update', { baseUrl: LLM_HTTPS_DEFAULT })
}

function useProxy() {
  emit('update', { baseUrl: LLM_PROXY })
}
</script>

<template>
  <section class="pane" :class="{ tabbed }">
    <header class="pane-head">
      <input
        v-if="!tabbed"
        class="title"
        :value="pane.label"
        @input="emit('update', { label: ($event.target as HTMLInputElement).value })"
      />
      <span v-else class="head-label">{{ pane.label }}</span>
      <div class="head-actions">
        <ModelPicker
          :model="pane.model"
          :base-url="playgroundFetchBase(picker.baseUrl)"
          :api-key="picker.apiKey"
          @update:model="emit('update', { model: $event })"
        />
        <button type="button" title="Connection settings" @click="showConn = !showConn">
          {{ showConn ? 'Hide' : 'Conn' }}
        </button>
        <button type="button" title="New session (clears chat, keeps avatar)" @click="emit('resetSession')">↻</button>
        <button v-if="!tabbed" type="button" title="Remove pane" @click="emit('remove')">×</button>
      </div>
    </header>

    <div v-show="showConn" class="meta">
      <div class="field">
        <label>Base URL</label>
        <input
          :value="pane.baseUrl"
          @input="emit('update', { baseUrl: ($event.target as HTMLInputElement).value })"
        />
      </div>
      <div class="url-modes">
        <button type="button" title="Self-signed HTTPS API" @click="useHttps">HTTPS</button>
        <button type="button" title="Vite proxy (no cert)" @click="useProxy">Proxy</button>
        <button type="button" @click="emit('checkHealth')">Check</button>
      </div>
      <div v-if="showTrustHint" class="trust">
        <p>
          Self-signed TLS: open the health URL, accept the browser warning once, then retry chat.
        </p>
        <button type="button" class="primary" @click="openTrustTab">
          Open trust URL
        </button>
        <div class="trust-url">{{ trustUrl }}</div>
      </div>
      <div class="field">
        <label>API key</label>
        <input
          type="password"
          :value="pane.apiKey"
          @input="emit('update', { apiKey: ($event.target as HTMLInputElement).value })"
        />
      </div>
      <div class="field">
        <label>Session</label>
        <input :value="pane.sessionId" readonly />
      </div>
      <div v-if="tabbed" class="field rename">
        <label>Agent name</label>
        <input
          :value="pane.label"
          @input="emit('update', { label: ($event.target as HTMLInputElement).value })"
        />
      </div>
    </div>

    <div ref="messagesEl" class="messages" @scroll.passive="onMessagesScroll">
      <div ref="messagesInnerEl" class="messages-inner">
      <div
        v-for="(m, i) in displayMessages"
        :key="i"
        class="msg"
        :class="m.role"
      >
        <div class="role">{{ m.role === 'tool' ? 'tool result' : m.role }}</div>
        <div v-if="m.role === 'assistant' && m.tool_calls?.length" class="tool-cards">
          <div v-for="tc in toolCallCards(m)" :key="tc.id" class="tool-card">
            <div class="tool-name">⚙ {{ tc.name }}</div>
            <pre class="tool-args">{{ JSON.stringify(tc.args, null, 2) }}</pre>
          </div>
        </div>
        <div v-if="m.role === 'tool'" class="tool-result">{{ toolResultPreview(m) }}</div>
        <div v-else-if="previewContent(m)" class="body">{{ previewContent(m) }}</div>
        <div v-if="messageBadges(m).length" class="tag-badges">
          <span
            v-for="(b, bi) in messageBadges(m)"
            :key="bi"
            class="tag-badge"
            :data-kind="b.kind"
            :title="b.placement"
          >{{ b.raw }}</span>
        </div>
      </div>
        <div v-if="busy && waitHint" class="msg assistant pending">
          <div class="role">assistant</div>
          <div class="body">{{ waitHint }}</div>
        </div>
      </div>
    </div>

    <div class="composer" @paste="onPaste">
      <div v-if="files.length" class="files">
        <span v-for="(f, i) in files" :key="i">{{ f.name }}</span>
      </div>
      <textarea
        v-model="draft"
        :placeholder="callActive ? 'In call — speak, or End call' : 'Message… (paste images)'"
        rows="3"
        :disabled="callActive"
        @keydown.enter.exact.prevent="submit"
      />
      <div class="composer-actions">
        <input ref="fileInput" type="file" multiple hidden @change="onFilePick" />
        <button type="button" @click="fileInput?.click()">Attach</button>
        <button
          type="button"
          class="call"
          :class="{ active: callActive }"
          :disabled="busy && !callActive"
          :title="
            callActive
              ? 'End voice call'
              : 'Start voice call (VAD → STT → reply → TTS)'
          "
          @click="emit('toggleCall')"
        >
          {{ callActive ? 'End call' : 'Call' }}
        </button>
        <button type="button" class="primary" :disabled="busy || callActive" @click="submit">
          Send
        </button>
      </div>
      <p v-if="callActive || callStatus" class="call-status">
        {{ callActive ? 'In call' : '' }}{{ callActive && callStatus ? ' · ' : '' }}{{ callStatus }}
      </p>
    </div>
  </section>
</template>

<style scoped>
.pane {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
  height: 100%;
  background: var(--bg-pane);
  border: 1px solid var(--line);
  border-radius: 14px;
  overflow: hidden;
}
.pane.tabbed {
  border-radius: 0 0 14px 14px;
  border-top: none;
}
.pane-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.55rem 0.75rem;
  border-bottom: 1px solid var(--line);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.03), transparent);
}
.title,
.head-label {
  border: none;
  background: transparent;
  font-family: var(--font-display);
  font-size: 1.25rem;
  padding: 0;
}
.head-actions {
  margin-left: auto;
  display: flex;
  gap: 0.35rem;
}
.meta {
  padding: 0.65rem 0.75rem 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.35rem 0.5rem;
  border-bottom: 1px solid var(--line);
  max-height: 40vh;
  overflow: auto;
}
.meta .field:nth-child(1),
.meta .trust,
.meta .url-modes,
.meta .rename {
  grid-column: 1 / -1;
}
.url-modes {
  display: flex;
  gap: 0.35rem;
  flex-wrap: wrap;
}
.trust {
  background: var(--accent-soft);
  border: 1px solid rgba(196, 163, 90, 0.35);
  border-radius: 10px;
  padding: 0.55rem 0.65rem;
  margin-bottom: 0.35rem;
}
.trust p {
  margin: 0 0 0.45rem;
  font-size: 0.78rem;
  color: var(--ink);
  line-height: 1.35;
}
.trust-url {
  margin-top: 0.35rem;
  font-size: 0.68rem;
  color: var(--muted);
  word-break: break-all;
}
.messages {
  flex: 1;
  overflow: auto;
  padding: 0.75rem;
  min-height: 0;
  overflow-anchor: none;
}
.messages-inner {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}
.msg {
  border-radius: 10px;
  padding: 0.5rem 0.65rem;
  background: var(--bg-elev);
  border: 1px solid transparent;
}
.msg.user {
  border-color: var(--accent-soft);
}
.msg.assistant {
  background: #0f1419;
}
.msg.pending {
  opacity: 0.72;
  font-style: italic;
}
.msg.tool {
  background: transparent;
  border: 1px dashed var(--line);
  padding: 0.35rem 0.55rem;
}
.tool-cards {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin-bottom: 0.35rem;
}
.tool-card {
  border: 1px solid rgba(196, 163, 90, 0.35);
  background: rgba(196, 163, 90, 0.08);
  border-radius: 8px;
  padding: 0.4rem 0.55rem;
}
.tool-name {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--accent);
  margin-bottom: 0.2rem;
}
.tool-args {
  margin: 0;
  font-size: 0.7rem;
  line-height: 1.35;
  white-space: pre-wrap;
  color: var(--muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.tool-result {
  font-size: 0.78rem;
  color: var(--ok);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.role {
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
  margin-bottom: 0.2rem;
}
.body {
  white-space: pre-wrap;
  font-size: 0.9rem;
  line-height: 1.4;
}
.tag-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  margin-top: 0.4rem;
}
.tag-badge {
  font-size: 0.68rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  padding: 0.12rem 0.4rem;
  border-radius: 999px;
  border: 1px solid var(--line);
  color: var(--accent);
  background: rgba(196, 163, 90, 0.1);
}
.tag-badge[data-kind='fish'] {
  color: #8fd4a8;
  border-color: rgba(90, 180, 120, 0.45);
  background: rgba(90, 180, 120, 0.1);
}
.tag-badge[data-kind='mood'] {
  color: #9ec4e8;
  border-color: rgba(110, 160, 210, 0.45);
}
.composer {
  padding: 0.75rem;
  border-top: 1px solid var(--line);
  flex-shrink: 0;
}
.files {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-bottom: 0.4rem;
  font-size: 0.75rem;
  color: var(--accent);
}
.composer-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.4rem;
  margin-top: 0.45rem;
}
.call {
  border-color: rgba(90, 180, 120, 0.45);
  color: #8fd4a8;
}
.call.active {
  background: rgba(90, 180, 120, 0.2);
  border-color: #5ab478;
  color: #c8f0d4;
}
.call-status {
  margin: 0.35rem 0 0;
  font-size: 0.72rem;
  color: var(--muted);
  text-align: right;
}
</style>
