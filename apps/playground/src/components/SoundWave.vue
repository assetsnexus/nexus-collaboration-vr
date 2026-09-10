<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { waveBarHeights } from '../lib/audio-meter'

const props = defineProps<{
  energy: number
  active?: boolean
  bars?: number
}>()

const heights = ref<number[]>(waveBarHeights(0, props.bars ?? 7, 0))
let raf = 0

function tick(now: number): void {
  heights.value = waveBarHeights(props.energy, props.bars ?? 7, now / 140)
  raf = requestAnimationFrame(tick)
}

watch(
  () => props.active || props.energy > 0.03,
  (on) => {
    cancelAnimationFrame(raf)
    if (on) {
      raf = requestAnimationFrame(tick)
      return
    }
    heights.value = waveBarHeights(0, props.bars ?? 7, 0)
  },
  { immediate: true },
)

onBeforeUnmount(() => cancelAnimationFrame(raf))
</script>

<template>
  <div class="wave" :class="{ active }" aria-hidden="true">
    <span
      v-for="(h, i) in heights"
      :key="i"
      :style="{ transform: `scaleY(${h.toFixed(3)})` }"
    />
  </div>
</template>

<style scoped>
.wave {
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 2px;
  height: 22px;
  width: 28px;
  flex-shrink: 0;
}
.wave span {
  display: block;
  width: 2.5px;
  height: 100%;
  border-radius: 2px;
  background: currentColor;
  opacity: 0.45;
  transform-origin: center bottom;
  transform: scaleY(0.12);
}
.wave.active span {
  opacity: 1;
}
</style>
