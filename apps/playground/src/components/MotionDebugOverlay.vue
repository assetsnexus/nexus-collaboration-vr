<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import type {
  CharacterActionEvent,
  ExpressionInfo,
  PresenceMoodDef,
} from '@openclaw/character-kit'
import MotionActionFeed from './MotionActionFeed.vue'

const props = defineProps<{
  open: boolean
  gestures: string[]
  expressions: ExpressionInfo[]
  moods: PresenceMoodDef[]
  currentMoodId: string
  logLine: string
  actions: CharacterActionEvent[]
}>()

const emit = defineEmits<{
  close: []
  'play-gesture': [id: string, loop: boolean]
  'set-mood': [id: string]
  'set-emotion': [emotion: string]
  'set-expression': [name: string, weight: number]
  'reset-face': []
  'reset-presence': []
  'force-long-rest': []
  refresh: []
  'clear-feed': []
}>()

const tab = ref<'live' | 'controls'>('live')

const loopGesture = defineModel<boolean>('loop', { default: false })

const currentMood = computed(
  () => props.moods.find((m) => m.id === props.currentMoodId) ?? null,
)

const conversationHints = new Set([
  'wave',
  'nod',
  'think',
  'talk',
  'sad',
  'agree',
  'disagree',
  'surprised',
  'look_around',
])

const ambientHints = new Set([
  'idle',
  'weight_shift',
  'scratch_nose',
  'stretch',
  'sit',
  'sit_wave',
  'crouch_idle',
  'look_around',
  'sleepy',
  'airplane',
])

function roleOf(id: string): string {
  const bits: string[] = []
  if (id === 'idle') bits.push('base')
  if (ambientHints.has(id)) bits.push('ambient')
  if (conversationHints.has(id)) bits.push('convo')
  return bits.join('+') || 'clip'
}

const KIND_ORDER = ['emotion', 'viseme', 'blink', 'look', 'custom'] as const
const KIND_HINT: Record<(typeof KIND_ORDER)[number], string> = {
  emotion: 'high-level face (set_emotion)',
  viseme: 'lip-sync — avoid while TTS plays',
  blink: 'auto-blink also drives these',
  look: 'eye look blendshapes',
  custom: 'model-specific shapes',
}

const expressionsByKind = computed(() =>
  KIND_ORDER.map((kind) => ({
    kind,
    hint: KIND_HINT[kind],
    items: props.expressions.filter((e) => e.kind === kind),
  })).filter((g) => g.items.length > 0),
)

const faceWeights = reactive<Record<string, number>>({})

watch(
  () => props.expressions.map((e) => e.name).join('\0'),
  () => {
    for (const key of Object.keys(faceWeights)) delete faceWeights[key]
    for (const e of props.expressions) faceWeights[e.name] = e.weight
  },
  { immediate: true },
)

function onFaceSlide(name: string, event: Event): void {
  const raw = Number((event.target as HTMLInputElement).value)
  const weight = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw / 100)) : 0
  faceWeights[name] = weight
  emit('set-expression', name, weight)
}

function onEmotionChip(name: string): void {
  emit('set-emotion', name)
  for (const e of props.expressions) {
    if (e.kind === 'emotion') faceWeights[e.name] = e.name === name ? 0.85 : 0
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="backdrop" data-ack-ignore>
      <aside
        class="panel"
        role="dialog"
        aria-label="Motion debug"
        data-ack-ignore
        :class="{ 'tab-live': tab === 'live' }"
      >
        <header class="head">
          <div>
            <h2>Motion debug</h2>
            <p class="sub">{{ tab === 'live' ? 'Live AI action feed' : 'Gestures, moods, ambient routines' }}</p>
          </div>
          <div class="head-actions">
            <button type="button" class="ghost" @click="emit('refresh')">Refresh</button>
            <button type="button" class="ghost" @click="emit('close')">Close</button>
          </div>
        </header>

        <nav class="tabs" aria-label="Motion debug views">
          <button
            type="button"
            class="tab"
            :class="{ active: tab === 'live' }"
            @click="tab = 'live'"
          >
            Live
            <span v-if="actions.length" class="tab-count">{{ actions.length }}</span>
          </button>
          <button
            type="button"
            class="tab"
            :class="{ active: tab === 'controls' }"
            @click="tab = 'controls'"
          >
            Controls
          </button>
        </nav>

        <MotionActionFeed
          v-if="tab === 'live'"
          :events="actions"
          @clear="emit('clear-feed')"
        />

        <template v-else>
        <p v-if="logLine" class="log">{{ logLine }}</p>

        <section>
          <div class="sec-head">
            <h3>Moods</h3>
            <span class="badge">current · {{ currentMoodId }}</span>
          </div>
          <div class="chip-grid">
            <button
              v-for="m in moods"
              :key="m.id"
              type="button"
              class="chip"
              :class="{ active: m.id === currentMoodId }"
              :title="m.description"
              @click="emit('set-mood', m.id)"
            >
              {{ m.id }}
            </button>
          </div>
          <p v-if="currentMood" class="desc">{{ currentMood.description }}</p>
        </section>

        <section v-if="currentMood">
          <h3>Routines · {{ currentMoodId }}</h3>
          <div class="routine">
            <h4>Micro</h4>
            <div class="chip-grid">
              <button
                v-for="g in currentMood.microGestures"
                :key="'mi-' + g"
                type="button"
                class="chip sm"
                @click="emit('play-gesture', g, false)"
              >
                {{ g }}
              </button>
            </div>
          </div>
          <div class="routine">
            <h4>Medium</h4>
            <div class="chip-grid">
              <button
                v-for="g in currentMood.mediumGestures"
                :key="'me-' + g"
                type="button"
                class="chip sm"
                @click="emit('play-gesture', g, false)"
              >
                {{ g }}
              </button>
            </div>
          </div>
          <div class="routine">
            <h4>Long</h4>
            <div class="chip-grid">
              <button
                v-for="g in currentMood.longGestures"
                :key="'lo-' + g"
                type="button"
                class="chip sm"
                @click="emit('play-gesture', g, true)"
              >
                {{ g }}
              </button>
            </div>
          </div>
          <div class="row">
            <button type="button" @click="emit('reset-presence')">Reset idle clock</button>
            <button type="button" @click="emit('force-long-rest')">Force long rest</button>
          </div>
        </section>

        <section>
          <div class="sec-head">
            <h3>Face catalogue</h3>
            <span class="badge">{{ expressions.length }} shapes</span>
          </div>
          <p class="hint">Live list from the loaded VRM. Emotions are chips; sliders are raw weights.</p>
          <div v-if="!expressions.length" class="hint">No expressions yet — wait for the VRM to load, then Refresh.</div>
          <div v-for="group in expressionsByKind" :key="group.kind" class="face-group">
            <h4>{{ group.kind }} <span class="role">{{ group.hint }}</span></h4>
            <div v-if="group.kind === 'emotion'" class="chip-grid">
              <button
                v-for="e in group.items"
                :key="'fe-' + e.name"
                type="button"
                class="chip sm"
                @click="onEmotionChip(e.name)"
              >
                {{ e.name }}
              </button>
            </div>
            <div class="sliders">
              <label v-for="e in group.items" :key="'fs-' + e.name" class="slider-row">
                <span class="gid">{{ e.name }}</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  :value="Math.round((faceWeights[e.name] ?? 0) * 100)"
                  @input="onFaceSlide(e.name, $event)"
                />
                <span class="role">{{ Math.round((faceWeights[e.name] ?? 0) * 100) }}</span>
              </label>
            </div>
          </div>
          <div class="row">
            <button type="button" @click="emit('reset-face')">Reset face</button>
          </div>
        </section>

        <section>
          <div class="sec-head">
            <h3>Full gesture catalogue</h3>
            <label class="loop">
              <input v-model="loopGesture" type="checkbox" />
              loop
            </label>
          </div>
          <p class="hint">{{ gestures.length }} loaded · click to play</p>
          <div class="catalog">
            <button
              v-for="g in gestures"
              :key="g"
              type="button"
              class="catalog-item"
              @click="emit('play-gesture', g, loopGesture)"
            >
              <span class="gid">{{ g }}</span>
              <span class="role">{{ roleOf(g) }}</span>
            </button>
          </div>
        </section>
        </template>
      </aside>
    </div>
  </Teleport>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 80;
  background: transparent;
  display: flex;
  justify-content: flex-end;
  padding: 0.75rem;
  box-sizing: border-box;
  pointer-events: none;
}
.panel {
  pointer-events: auto;
  width: min(420px, 100%);
  max-height: calc(100vh - 1.5rem);
  overflow: auto;
  background: #12171c;
  border: 1px solid var(--line, #2a323c);
  border-radius: 14px;
  padding: 0.85rem 1rem 1.1rem;
  color: var(--ink, #e8ecef);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.panel.tab-live {
  overflow: hidden;
  height: min(720px, calc(100vh - 1.5rem));
}
.tabs {
  display: flex;
  gap: 0.25rem;
  margin: 0 0 0.65rem;
  flex-shrink: 0;
}
.tab {
  border: 1px solid var(--line, #2a323c);
  background: #0c1014;
  color: var(--muted, #8b969e);
  border-radius: 8px;
  padding: 0.28rem 0.6rem;
  font-size: 0.75rem;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}
.tab.active {
  border-color: var(--accent, #c4a574);
  color: var(--ink, #e8ecef);
  background: rgba(196, 165, 116, 0.12);
}
.tab-count {
  font-size: 0.62rem;
  font-variant-numeric: tabular-nums;
  color: var(--accent, #c4a574);
}
.head {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  align-items: flex-start;
  margin-bottom: 0.75rem;
}
.head h2 {
  margin: 0;
  font-family: var(--font-display, Georgia, serif);
  font-weight: 400;
  font-size: 1.35rem;
}
.sub {
  margin: 0.15rem 0 0;
  font-size: 0.75rem;
  color: var(--muted, #8b969e);
}
.head-actions {
  display: flex;
  gap: 0.35rem;
}
.ghost {
  background: transparent;
  border: 1px solid var(--line, #2a323c);
}
.log {
  margin: 0 0 0.75rem;
  font-size: 0.72rem;
  color: var(--muted, #8b969e);
  font-family: ui-monospace, monospace;
}
section {
  margin-bottom: 1rem;
  padding-bottom: 0.85rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}
section:last-child {
  border-bottom: none;
  margin-bottom: 0;
}
.sec-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}
h3 {
  margin: 0 0 0.5rem;
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted, #8b969e);
  font-weight: 600;
}
h4 {
  margin: 0.45rem 0 0.3rem;
  font-size: 0.72rem;
  color: var(--muted, #8b969e);
  font-weight: 500;
}
.badge {
  font-size: 0.7rem;
  padding: 0.15rem 0.45rem;
  border-radius: 999px;
  border: 1px solid var(--line, #2a323c);
  color: var(--accent, #c4a574);
}
.desc,
.hint {
  margin: 0.4rem 0 0;
  font-size: 0.75rem;
  color: var(--muted, #8b969e);
}
.chip-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}
.chip {
  border: 1px solid var(--line, #2a323c);
  background: #0c1014;
  color: inherit;
  border-radius: 8px;
  padding: 0.35rem 0.55rem;
  font-size: 0.8rem;
}
.chip.sm {
  padding: 0.25rem 0.45rem;
  font-size: 0.72rem;
}
.chip.active {
  border-color: var(--accent, #c4a574);
  color: var(--accent, #c4a574);
  background: rgba(196, 165, 116, 0.12);
}
.chip:hover {
  border-color: rgba(255, 255, 255, 0.25);
}
.row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-top: 0.55rem;
}
.loop {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.75rem;
  color: var(--muted, #8b969e);
}
.catalog {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  max-height: 240px;
  overflow: auto;
  margin-top: 0.4rem;
}
.catalog-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  text-align: left;
  border: 1px solid transparent;
  border-radius: 8px;
  background: #0c1014;
  color: inherit;
  padding: 0.4rem 0.55rem;
  font-size: 0.8rem;
}
.catalog-item:hover {
  border-color: var(--line, #2a323c);
}
.face-group {
  margin-top: 0.55rem;
}
.sliders {
  display: flex;
  flex-direction: column;
  gap: 0.28rem;
  margin-top: 0.35rem;
}
.slider-row {
  display: grid;
  grid-template-columns: minmax(4.5rem, 7rem) 1fr 2.2rem;
  gap: 0.4rem;
  align-items: center;
  font-size: 0.72rem;
}
.slider-row input[type='range'] {
  width: 100%;
  accent-color: var(--accent, #c4a574);
}
.gid {
  font-family: ui-monospace, monospace;
}
.role {
  font-size: 0.65rem;
  color: var(--muted, #8b969e);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
</style>
