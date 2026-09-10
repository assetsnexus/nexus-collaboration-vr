<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import {
  parseAgentExport,
  readClipboardText,
  summarizeAgentExport,
  type AgentExportConfig,
} from '../lib/agent-export'

const props = defineProps<{
  open: boolean
  /** Text already read during the click that opened this dialog. */
  clipboardText?: string
}>()

const emit = defineEmits<{
  close: []
  blank: []
  import: [agent: AgentExportConfig]
}>()

const pasteText = ref('')
const pasteError = ref('')
const clipboardAgent = ref<AgentExportConfig | null>(null)
const clipboardHint = ref('')
const showPaste = ref(false)
const pasteEl = ref<HTMLTextAreaElement | null>(null)

function applyClipboardText(text: string | undefined | null): boolean {
  clipboardAgent.value = null
  clipboardHint.value = ''
  if (!text?.trim()) return false
  const result = parseAgentExport(text)
  if (result.ok) {
    clipboardAgent.value = result.agent
    clipboardHint.value = summarizeAgentExport(result.agent)
    pasteText.value = text
    console.info('[agent-add] clipboard agent detected', { label: result.agent.label })
    return true
  }
  if (text.trim().startsWith('{') || text.trim().startsWith('[')) {
    clipboardHint.value = result.error
    pasteText.value = text
  }
  return false
}

async function sniffClipboard(): Promise<void> {
  if (applyClipboardText(props.clipboardText)) return
  applyClipboardText(await readClipboardText())
}

function onPastePreview() {
  pasteError.value = ''
  const text = pasteText.value.trim()
  if (!text) return
  const result = parseAgentExport(text)
  if (!result.ok) pasteError.value = result.error
}

function importClipboard() {
  if (!clipboardAgent.value) return
  emit('import', clipboardAgent.value)
}

function importPaste() {
  const result = parseAgentExport(pasteText.value)
  if (!result.ok) {
    pasteError.value = result.error
    console.warn('[agent-add] paste parse failed', result.error)
    return
  }
  emit('import', result.agent)
}

function onDocKey(ev: KeyboardEvent) {
  if (!props.open) return
  if (ev.key === 'Escape') {
    ev.preventDefault()
    emit('close')
  }
}

function onWindowPaste(ev: ClipboardEvent) {
  if (!props.open || showPaste.value) return
  const t = ev.target
  if (t instanceof HTMLTextAreaElement || t instanceof HTMLInputElement) return
  const text = ev.clipboardData?.getData('text/plain') ?? ''
  if (!text.trim()) return
  const parsed = parseAgentExport(text)
  if (!parsed.ok) return
  ev.preventDefault()
  clipboardAgent.value = parsed.agent
  clipboardHint.value = summarizeAgentExport(parsed.agent)
  pasteText.value = text
}

watch(
  () => props.open,
  async (open) => {
    if (!open) {
      document.removeEventListener('keydown', onDocKey)
      window.removeEventListener('paste', onWindowPaste)
      return
    }
    pasteText.value = ''
    pasteError.value = ''
    showPaste.value = false
    clipboardAgent.value = null
    clipboardHint.value = ''
    document.addEventListener('keydown', onDocKey)
    window.addEventListener('paste', onWindowPaste)
    await sniffClipboard()
  },
)

watch(
  () => props.clipboardText,
  (text) => {
    if (props.open && text) applyClipboardText(text)
  },
)

watch(showPaste, async (on) => {
  if (!on) return
  await nextTick()
  pasteEl.value?.focus()
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onDocKey)
  window.removeEventListener('paste', onWindowPaste)
})
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="backdrop" @click.self="emit('close')">
      <div class="panel" role="dialog" aria-labelledby="agent-add-title" aria-modal="true">
        <header class="head">
          <div>
            <h2 id="agent-add-title">Add agent</h2>
            <p class="sub">Blank pane, import from clipboard, or paste a config.</p>
          </div>
          <button type="button" class="ghost" @click="emit('close')">Close</button>
        </header>

        <button
          v-if="clipboardAgent"
          type="button"
          class="quick-import"
          @click="importClipboard"
        >
          <span class="quick-kicker">Clipboard</span>
          <span class="quick-title">Import {{ clipboardAgent.label }}</span>
          <span class="quick-sub">{{ clipboardHint }}</span>
        </button>

        <p v-else-if="clipboardHint" class="clip-miss">
          Clipboard is not a valid agent.
          <button type="button" class="link" @click="showPaste = true">Open paste</button>
        </p>

        <div class="choices">
          <button type="button" class="choice" @click="emit('blank')">
            <span class="choice-title">Blank agent</span>
            <span class="choice-sub">New pane with default name, VRM, and connection.</span>
          </button>
          <button type="button" class="choice" @click="showPaste = !showPaste">
            <span class="choice-title">Paste config</span>
            <span class="choice-sub">JSON from Export to clipboard, or a bare agent object.</span>
          </button>
        </div>

        <div v-if="showPaste" class="paste">
          <label for="agent-paste">Agent JSON</label>
          <textarea
            id="agent-paste"
            ref="pasteEl"
            v-model="pasteText"
            rows="10"
            placeholder='{"kind":"openclaw.dev-vrm.agent","agent":{"label":"Agent A",…}}'
            @input="onPastePreview"
          />
          <p v-if="pasteError" class="error">{{ pasteError }}</p>
          <div class="paste-actions">
            <button type="button" class="primary" :disabled="!pasteText.trim()" @click="importPaste">
              Import pasted
            </button>
          </div>
        </div>
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
  width: min(440px, 100%);
  max-height: calc(100vh - 2rem);
  overflow: auto;
  background: var(--bg-pane, #12171c);
  border: 1px solid var(--line, #2a333d);
  border-radius: 14px;
  padding: 0.9rem 1rem 1.1rem;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
}
.head {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  align-items: flex-start;
  margin-bottom: 0.85rem;
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
.quick-import {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.12rem;
  width: 100%;
  margin: 0 0 0.7rem;
  padding: 0.65rem 0.75rem;
  text-align: left;
  border: 1px solid rgba(196, 163, 90, 0.45);
  background: rgba(196, 163, 90, 0.12);
  border-radius: 12px;
}
.quick-kicker {
  font-size: 0.62rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--accent, #c4a35a);
}
.quick-title {
  font-size: 0.95rem;
  font-weight: 600;
}
.quick-sub {
  font-size: 0.72rem;
  color: var(--muted, #8b97a5);
}
.clip-miss {
  margin: 0 0 0.7rem;
  font-size: 0.75rem;
  color: var(--muted, #8b97a5);
}
.link {
  border: none;
  background: transparent;
  padding: 0;
  color: var(--accent, #c4a35a);
  font-size: inherit;
  text-decoration: underline;
}
.choices {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}
.choice {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.15rem;
  width: 100%;
  text-align: left;
  padding: 0.65rem 0.75rem;
  background: #0c1014;
}
.choice:hover,
.choice:focus-visible {
  border-color: var(--accent, #c4a35a);
}
.choice-title {
  font-size: 0.88rem;
  font-weight: 600;
}
.choice-sub {
  font-size: 0.72rem;
  color: var(--muted, #8b97a5);
}
.paste {
  margin-top: 0.75rem;
}
.paste textarea {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.72rem;
  min-height: 140px;
}
.error {
  margin: 0.35rem 0 0;
  font-size: 0.75rem;
  color: var(--danger, #d4746a);
}
.paste-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 0.5rem;
}
</style>
