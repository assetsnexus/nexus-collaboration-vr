<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps<{
  open: boolean
  x: number
  y: number
  label: string
  canRemove: boolean
}>()

const emit = defineEmits<{
  close: []
  export: []
  edit: []
  remove: []
}>()

const menuEl = ref<HTMLElement | null>(null)
const style = ref<Record<string, string>>({})

function place() {
  const pad = 8
  const el = menuEl.value
  const width = el?.offsetWidth || 200
  const height = el?.offsetHeight || 160
  let left = props.x
  let top = props.y
  if (left + width > window.innerWidth - pad) left = Math.max(pad, window.innerWidth - width - pad)
  if (top + height > window.innerHeight - pad) top = Math.max(pad, props.y - height)
  style.value = {
    position: 'fixed',
    top: `${Math.round(top)}px`,
    left: `${Math.round(left)}px`,
  }
}

function onDocPointer(ev: PointerEvent) {
  if (!props.open) return
  const t = ev.target
  if (!(t instanceof Node)) return
  if (menuEl.value?.contains(t)) return
  emit('close')
}

function onKey(ev: KeyboardEvent) {
  if (!props.open) return
  if (ev.key === 'Escape') {
    ev.preventDefault()
    emit('close')
  }
}

watch(
  () => [props.open, props.x, props.y] as const,
  async ([open]) => {
    if (!open) return
    await nextTick()
    place()
  },
  { immediate: true },
)

watch(
  () => props.open,
  (open) => {
    if (open) {
      document.addEventListener('pointerdown', onDocPointer, true)
      document.addEventListener('keydown', onKey)
      window.addEventListener('resize', place)
    } else {
      document.removeEventListener('pointerdown', onDocPointer, true)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', place)
    }
  },
)

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocPointer, true)
  document.removeEventListener('keydown', onKey)
  window.removeEventListener('resize', place)
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      ref="menuEl"
      class="menu"
      role="menu"
      :aria-label="`Agent ${label}`"
      :style="style"
    >
      <button type="button" role="menuitem" @click="emit('export')">
        Export to clipboard
      </button>
      <button type="button" role="menuitem" @click="emit('edit')">
        Edit agent
      </button>
      <button
        v-if="canRemove"
        type="button"
        role="menuitem"
        class="danger"
        @click="emit('remove')"
      >
        Remove
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.menu {
  z-index: 120;
  min-width: 11.5rem;
  padding: 0.28rem;
  background: var(--bg-elev, #161b20);
  border: 1px solid var(--line, #2a333d);
  border-radius: 10px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
  display: flex;
  flex-direction: column;
  gap: 0.12rem;
}
.menu button {
  width: 100%;
  text-align: left;
  border: none;
  background: transparent;
  border-radius: 7px;
  padding: 0.42rem 0.6rem;
  font-size: 0.82rem;
}
.menu button:hover,
.menu button:focus-visible {
  background: rgba(196, 163, 90, 0.14);
  color: var(--ink, #e8edf2);
}
.menu button.danger:hover,
.menu button.danger:focus-visible {
  background: rgba(212, 116, 106, 0.2);
  color: var(--danger, #d4746a);
}
</style>
