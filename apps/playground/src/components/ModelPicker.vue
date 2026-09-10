<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import {
  FAVORITE_MODELS,
  filterCatalog,
  loadOpenRouterModels,
  peekOpenRouterModels,
  shortModelLabel,
  type OpenRouterCatalogModel,
} from '../lib/openrouter-models'

const props = defineProps<{
  model: string
  baseUrl: string
  apiKey?: string
}>()

const emit = defineEmits<{
  'update:model': [id: string]
}>()

const open = ref(false)
const query = ref('')
const loading = ref(false)
const error = ref('')
const catalog = ref<OpenRouterCatalogModel[]>([])
const highlight = ref(0)
const rootEl = ref<HTMLElement | null>(null)
const popEl = ref<HTMLElement | null>(null)
const searchEl = ref<HTMLInputElement | null>(null)
const popStyle = ref<Record<string, string>>({})

const filtered = computed(() => filterCatalog(catalog.value, query.value))

const rows = computed(() => {
  const favs = filtered.value.favorites.map((f) => ({
    id: f.id,
    title: f.label,
    sub: f.hint,
    favorite: true,
  }))
  const rest = filtered.value.rest.map((m) => ({
    id: m.id,
    title: m.name,
    sub: m.id,
    favorite: false,
  }))
  return [...favs, ...rest]
})

watch(rows, () => {
  highlight.value = 0
})

async function ensureCatalog() {
  const cached = peekOpenRouterModels()
  if (cached?.length) {
    catalog.value = cached
    return
  }
  if (catalog.value.length) return
  loading.value = true
  error.value = ''
  try {
    catalog.value = await loadOpenRouterModels({
      baseUrl: props.baseUrl,
      apiKey: props.apiKey,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    error.value = msg
    console.warn('[model-picker] catalog fetch failed', msg)
  } finally {
    loading.value = false
    await nextTick()
    if (open.value) placePop()
  }
}

function placePop() {
  const btn = rootEl.value?.querySelector('button.gear')
  if (!(btn instanceof HTMLElement)) return
  const r = btn.getBoundingClientRect()
  const width = Math.min(352, window.innerWidth - 16)
  let left = r.right - width
  if (left < 8) left = 8
  const popH = popEl.value?.offsetHeight || 320
  const below = r.bottom + 6
  const above = r.top - 6 - popH
  const top =
    below + popH <= window.innerHeight - 8
      ? below
      : Math.max(8, above)
  popStyle.value = {
    position: 'fixed',
    top: `${Math.round(top)}px`,
    left: `${Math.round(left)}px`,
    width: `${width}px`,
  }
}

async function toggle() {
  open.value = !open.value
  if (!open.value) return
  query.value = ''
  placePop()
  await ensureCatalog()
  await nextTick()
  placePop()
  searchEl.value?.focus()
}

function select(id: string) {
  console.info('[model-picker] model', id)
  emit('update:model', id)
  open.value = false
}

function onDocPointer(ev: PointerEvent) {
  if (!open.value) return
  const t = ev.target
  if (!(t instanceof Node)) return
  if (rootEl.value?.contains(t) || popEl.value?.contains(t)) return
  open.value = false
}

function onKey(ev: KeyboardEvent) {
  if (!open.value) return
  if (ev.key === 'Escape') {
    ev.preventDefault()
    open.value = false
    return
  }
  if (ev.key === 'ArrowDown') {
    ev.preventDefault()
    highlight.value = Math.min(rows.value.length - 1, highlight.value + 1)
    return
  }
  if (ev.key === 'ArrowUp') {
    ev.preventDefault()
    highlight.value = Math.max(0, highlight.value - 1)
    return
  }
  if (ev.key === 'Enter') {
    ev.preventDefault()
    const hit = rows.value[highlight.value]
    if (hit) {
      select(hit.id)
      return
    }
    const custom = query.value.trim()
    if (custom.includes('/')) select(custom)
  }
}

watch(open, (on) => {
  if (on) {
    document.addEventListener('pointerdown', onDocPointer, true)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', placePop)
  } else {
    document.removeEventListener('pointerdown', onDocPointer, true)
    document.removeEventListener('keydown', onKey)
    window.removeEventListener('resize', placePop)
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocPointer, true)
  document.removeEventListener('keydown', onKey)
  window.removeEventListener('resize', placePop)
})
</script>

<template>
  <div ref="rootEl" class="picker">
    <button
      type="button"
      class="gear"
      :class="{ open }"
      title="Chat model"
      :aria-expanded="open"
      aria-haspopup="listbox"
      @click="toggle"
    >
      <span class="icon" aria-hidden="true">⚙</span>
      <span class="current">{{ shortModelLabel(model) }}</span>
    </button>
    <Teleport to="body">
      <div
        v-if="open"
        ref="popEl"
        class="pop"
        role="listbox"
        :style="popStyle"
        :aria-label="`Models (${rows.length})`"
      >
        <input
          ref="searchEl"
          v-model="query"
          class="search"
          type="search"
          placeholder="Search models…"
          autocomplete="off"
          spellcheck="false"
        />
        <p v-if="loading" class="status">Loading catalog…</p>
        <p v-else-if="error && !catalog.length" class="status err">
          {{ error }} — favorites still work
        </p>
        <div v-if="!query.trim()" class="fav-row">
          <button
            v-for="fav in FAVORITE_MODELS"
            :key="fav.id"
            type="button"
            class="fav"
            :class="{ on: model === fav.id }"
            :title="fav.id"
            @click="select(fav.id)"
          >
            {{ fav.label }}
          </button>
        </div>
        <ul class="list">
          <li v-for="(row, i) in rows" :key="row.id">
            <button
              type="button"
              class="opt"
              :class="{ on: model === row.id, hi: i === highlight, fav: row.favorite }"
              @click="select(row.id)"
              @mouseenter="highlight = i"
            >
              <span class="opt-title">{{ row.title }}</span>
              <span class="opt-sub">{{ row.sub }}</span>
            </button>
          </li>
          <li v-if="!loading && !rows.length" class="empty">No paid models match.</li>
        </ul>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.picker {
  position: relative;
}
.gear {
  display: inline-flex;
  align-items: center;
  gap: 0.28rem;
  padding: 0.28rem 0.5rem;
  font-size: 0.72rem;
  color: var(--muted);
  max-width: 9.5rem;
}
.gear.open,
.gear:hover {
  color: var(--ink);
  border-color: var(--accent);
}
.icon {
  font-size: 0.85rem;
  line-height: 1;
}
.current {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pop {
  z-index: 130;
  background: var(--bg-pane);
  border: 1px solid var(--line);
  border-radius: 10px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
  padding: 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.search {
  width: 100%;
  padding: 0.4rem 0.55rem;
  border-radius: 8px;
}
.status {
  margin: 0;
  font-size: 0.72rem;
  color: var(--muted);
}
.status.err {
  color: var(--danger);
}
.fav-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}
.fav {
  padding: 0.22rem 0.45rem;
  font-size: 0.7rem;
  border-radius: 999px;
}
.fav.on {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent);
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: min(18rem, 50vh);
  overflow: auto;
}
.opt {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.05rem;
  padding: 0.38rem 0.5rem;
  border: none;
  background: transparent;
  border-radius: 8px;
  text-align: left;
}
.opt.hi,
.opt:hover {
  background: var(--bg-elev);
}
.opt.on {
  outline: 1px solid rgba(196, 163, 90, 0.45);
}
.opt.fav .opt-title {
  color: var(--accent);
}
.opt-title {
  font-size: 0.8rem;
}
.opt-sub {
  font-size: 0.65rem;
  color: var(--muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.empty {
  padding: 0.5rem;
  font-size: 0.75rem;
  color: var(--muted);
}
</style>
