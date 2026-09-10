<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'

const emit = defineEmits<{
  change: [value: { x: number; z: number }]
}>()

const rootRef = ref<HTMLElement | null>(null)
const knobX = ref(0)
const knobY = ref(0)
const active = ref(false)
let pointerId: number | null = null

const RADIUS = 40

function emitZero(): void {
  emit('change', { x: 0, z: 0 })
}

function setFromClient(clientX: number, clientY: number): void {
  const el = rootRef.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2
  let dx = clientX - cx
  let dy = clientY - cy
  const len = Math.hypot(dx, dy)
  if (len > RADIUS) {
    dx = (dx / len) * RADIUS
    dy = (dy / len) * RADIUS
  }
  knobX.value = dx
  knobY.value = dy
  // Screen: +x right, +y down → stick: +x right, +z forward (up on pad)
  emit('change', { x: dx / RADIUS, z: -dy / RADIUS })
}

function onPointerDown(e: PointerEvent): void {
  if (!rootRef.value) return
  active.value = true
  pointerId = e.pointerId
  rootRef.value.setPointerCapture(e.pointerId)
  setFromClient(e.clientX, e.clientY)
  e.preventDefault()
  e.stopPropagation()
}

function onPointerMove(e: PointerEvent): void {
  if (!active.value || e.pointerId !== pointerId) return
  setFromClient(e.clientX, e.clientY)
  e.preventDefault()
}

function endDrag(e: PointerEvent): void {
  if (e.pointerId !== pointerId) return
  active.value = false
  pointerId = null
  knobX.value = 0
  knobY.value = 0
  emitZero()
  try {
    rootRef.value?.releasePointerCapture(e.pointerId)
  } catch {
    /* already released */
  }
}

onBeforeUnmount(() => {
  emitZero()
})
</script>

<template>
  <div
    ref="rootRef"
    class="stick"
    role="application"
    aria-label="Move character"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="endDrag"
    @pointercancel="endDrag"
  >
    <div class="ring" />
    <div
      class="knob"
      :class="{ active }"
      :style="{ transform: `translate(${knobX}px, ${knobY}px)` }"
    />
  </div>
</template>

<style scoped>
.stick {
  position: relative;
  width: 96px;
  height: 96px;
  touch-action: none;
  user-select: none;
  cursor: grab;
}
.stick:active {
  cursor: grabbing;
}
.ring {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 2px solid var(--line);
  background: rgba(18, 23, 28, 0.72);
  box-shadow: inset 0 0 0 1px rgba(196, 163, 90, 0.12);
}
.knob {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 36px;
  height: 36px;
  margin: -18px 0 0 -18px;
  border-radius: 50%;
  background: var(--accent-soft);
  border: 2px solid var(--accent);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
  transition: background 0.12s ease;
}
.knob.active {
  background: rgba(196, 163, 90, 0.45);
}
</style>
