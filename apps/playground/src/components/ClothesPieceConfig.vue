<script setup lang="ts">
import { computed } from 'vue'
import {
  compactClothesTransform,
  normalizeClothesTransform,
  type ClothesPieceTransform,
} from '@openclaw/character-kit'

const props = defineProps<{
  modelValue?: Partial<ClothesPieceTransform> | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: Partial<ClothesPieceTransform> | undefined]
}>()

const t = computed(() => normalizeClothesTransform(props.modelValue))

function commit(patch: Partial<ClothesPieceTransform>): void {
  emit(
    'update:modelValue',
    compactClothesTransform(normalizeClothesTransform({ ...t.value, ...patch })),
  )
}

function num(ev: Event): number {
  return Number((ev.target as HTMLInputElement).value)
}
</script>

<template>
  <div class="cfg">
    <div class="row">
      <span class="lbl">Mirror</span>
      <label>
        <input
          type="checkbox"
          :checked="t.mirrorX"
          @change="commit({ mirrorX: ($event.target as HTMLInputElement).checked })"
        />
        X
      </label>
      <label>
        <input
          type="checkbox"
          :checked="t.mirrorY"
          @change="commit({ mirrorY: ($event.target as HTMLInputElement).checked })"
        />
        Y
      </label>
      <label>
        <input
          type="checkbox"
          :checked="t.mirrorZ"
          @change="commit({ mirrorZ: ($event.target as HTMLInputElement).checked })"
        />
        Z
      </label>
    </div>
    <div class="row nums">
      <span class="lbl">Offset</span>
      <label>
        X
        <input
          type="number"
          step="0.01"
          min="-2"
          max="2"
          :value="t.offsetX"
          @input="commit({ offsetX: num($event) })"
        />
      </label>
      <label>
        Y
        <input
          type="number"
          step="0.01"
          min="-2"
          max="2"
          :value="t.offsetY"
          @input="commit({ offsetY: num($event) })"
        />
      </label>
      <label>
        Z
        <input
          type="number"
          step="0.01"
          min="-2"
          max="2"
          :value="t.offsetZ"
          @input="commit({ offsetZ: num($event) })"
        />
      </label>
    </div>
    <div class="row nums">
      <span class="lbl">Scale</span>
      <label>
        <input
          type="number"
          step="0.05"
          min="0.05"
          max="4"
          :value="t.scale"
          @input="commit({ scale: num($event) })"
        />
      </label>
      <button type="button" class="reset" @click="emit('update:modelValue', undefined)">
        Reset
      </button>
    </div>
    <div class="row nums">
      <span class="lbl">Rotate</span>
      <label>
        X
        <input
          type="number"
          step="1"
          min="-180"
          max="180"
          :value="t.rotateX"
          @input="commit({ rotateX: num($event) })"
        />
      </label>
      <label>
        Y
        <input
          type="number"
          step="1"
          min="-180"
          max="180"
          :value="t.rotateY"
          @input="commit({ rotateY: num($event) })"
        />
      </label>
      <label>
        Z
        <input
          type="number"
          step="1"
          min="-180"
          max="180"
          :value="t.rotateZ"
          @input="commit({ rotateZ: num($event) })"
        />
      </label>
    </div>
  </div>
</template>

<style scoped>
.cfg {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  margin-top: 0.3rem;
  padding: 0.4rem 0.45rem;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #0a0e12;
}
.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.45rem;
  font-size: 0.7rem;
  text-transform: none;
  letter-spacing: 0;
  color: var(--ink);
}
.lbl {
  width: 3.4rem;
  flex-shrink: 0;
  font-size: 0.6rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
}
.row label {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  margin: 0;
}
.nums input[type='number'] {
  width: 4.2rem;
  padding: 0.15rem 0.25rem;
  font-size: 0.75rem;
}
.reset {
  margin-left: auto;
  background: transparent;
  border: 1px solid var(--line);
  color: var(--muted);
  font-size: 0.65rem;
  padding: 0.15rem 0.4rem;
  border-radius: 6px;
}
</style>
