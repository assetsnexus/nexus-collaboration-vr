<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { LOCO_SPEED_MAX, LOCO_SPEED_MIN, LOCO_WALK_SPEED, gaitFromSpeed } from '@nexus/character-kit'

const props = withDefaults(
  defineProps<{
    modelValue?: number
    min?: number
    max?: number
  }>(),
  {
    modelValue: LOCO_WALK_SPEED,
    min: LOCO_SPEED_MIN,
    max: LOCO_SPEED_MAX,
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: number]
  change: [value: number]
}>()

const rootRef = ref<HTMLElement | null>(null)
const active = ref(false)
let pointerId: number | null = null

const speed = ref(props.modelValue)

watch(
  () => props.modelValue,
  (v) => {
    if (Number.isFinite(v) && Math.abs(v - speed.value) > 1e-4) speed.value = v
  },
)

const gaitLabel = computed(() => gaitFromSpeed(speed.value))

/** Knob position: 0 = bottom (min), 1 = top (max). */
const t = computed(() => {
  const span = props.max - props.min
  if (span < 1e-9) return 0.5
  return Math.min(1, Math.max(0, (speed.value - props.min) / span))
})

function clampSpeed(v: number): number {
  return Math.min(props.max, Math.max(props.min, v))
}

function setFromClientY(clientY: number): void {
  const el = rootRef.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  // Top = max speed, bottom = min (natural “up = faster”)
  const u = 1 - (clientY - rect.top) / rect.height
  const next = clampSpeed(props.min + u * (props.max - props.min))
  speed.value = Math.round(next * 100) / 100
  emit('update:modelValue', speed.value)
  emit('change', speed.value)
}

function onPointerDown(e: PointerEvent): void {
  if (!rootRef.value) return
  active.value = true
  pointerId = e.pointerId
  rootRef.value.setPointerCapture(e.pointerId)
  setFromClientY(e.clientY)
  e.preventDefault()
  e.stopPropagation()
}

function onPointerMove(e: PointerEvent): void {
  if (!active.value || e.pointerId !== pointerId) return
  setFromClientY(e.clientY)
  e.preventDefault()
}

function endDrag(e: PointerEvent): void {
  if (e.pointerId !== pointerId) return
  active.value = false
  pointerId = null
  try {
    rootRef.value?.releasePointerCapture(e.pointerId)
  } catch {
    /* already released */
  }
}

onBeforeUnmount(() => {
  active.value = false
})
</script>

<template>
  <div
    ref="rootRef"
    class="speed"
    role="slider"
    :aria-valuemin="min"
    :aria-valuemax="max"
    :aria-valuenow="speed"
    :aria-valuetext="`${speed.toFixed(1)} m/s ${gaitLabel}`"
    aria-label="Walk speed"
    :title="`${speed.toFixed(1)} m/s · ${gaitLabel}`"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="endDrag"
    @pointercancel="endDrag"
  >
    <div class="track" />
    <div
      class="knob"
      :class="{ active }"
      :style="{ bottom: `calc(${t * 100}% - 14px)` }"
    />
    <span class="label">{{ speed.toFixed(1) }}</span>
  </div>
</template>

<style scoped>
.speed {
  position: relative;
  width: 36px;
  height: 96px;
  touch-action: none;
  user-select: none;
  cursor: ns-resize;
}
.track {
  position: absolute;
  left: 50%;
  top: 4px;
  bottom: 18px;
  width: 10px;
  margin-left: -5px;
  border-radius: 999px;
  border: 2px solid var(--line);
  background: rgba(18, 23, 28, 0.72);
  box-shadow: inset 0 0 0 1px rgba(196, 163, 90, 0.12);
}
.knob {
  position: absolute;
  left: 50%;
  width: 28px;
  height: 28px;
  margin-left: -14px;
  border-radius: 50%;
  background: var(--accent-soft);
  border: 2px solid var(--accent);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
  transition: background 0.12s ease;
  z-index: 1;
}
.knob.active {
  background: rgba(196, 163, 90, 0.45);
}
.label {
  position: absolute;
  left: 50%;
  bottom: 0;
  transform: translateX(-50%);
  font-size: 0.58rem;
  color: var(--muted);
  line-height: 1;
  pointer-events: none;
  font-variant-numeric: tabular-nums;
}
</style>
