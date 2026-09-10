<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  groupClothesByCategory,
  type ClothesGroup,
  type ClothesItem,
  type ClothesPieceTransform,
} from '@openclaw/character-kit'
import ClothesPieceConfig from './ClothesPieceConfig.vue'

const props = defineProps<{
  groups: ClothesGroup[]
  selectedIds: string[]
  allSelected: boolean
  overlayId: string
  overlayOptions: Array<{ id: string; label: string }>
  overlayItems: ClothesItem[]
  overlayCheckedIds: string[]
  overlayLoading: boolean
  overlayTransforms: Record<string, Partial<ClothesPieceTransform> | undefined>
  appliedCount: number
}>()

const emit = defineEmits<{
  toggle: [id: string, checked: boolean]
  all: []
  none: []
  'set-overlay': [id: string]
  'toggle-overlay': [id: string, checked: boolean]
  'update-overlay-transform': [id: string, transform: Partial<ClothesPieceTransform> | undefined]
}>()

const openConfigId = ref('')

const overlayGroups = computed(() => groupClothesByCategory(props.overlayItems))

function isChecked(id: string): boolean {
  if (props.allSelected) return true
  return props.selectedIds.includes(id)
}

function isOverlayChecked(id: string): boolean {
  return props.overlayCheckedIds.includes(id)
}

function overlayTransform(id: string): Partial<ClothesPieceTransform> | undefined {
  return props.overlayTransforms[id]
}

function toggleConfig(id: string): void {
  openConfigId.value = openConfigId.value === id ? '' : id
}

function onOverlayTransform(id: string, transform: Partial<ClothesPieceTransform> | undefined): void {
  emit('update-overlay-transform', id, transform)
}

watch(
  () => props.overlayId,
  () => {
    openConfigId.value = ''
  },
)

watch(
  () => props.overlayCheckedIds,
  (ids) => {
    if (openConfigId.value && !ids.includes(openConfigId.value)) openConfigId.value = ''
  },
)
</script>

<template>
  <div class="picker">
    <div class="head">
      <span class="title">Clothes</span>
      <div class="quick">
        <button type="button" class="link" @click="emit('all')">All</button>
        <button type="button" class="link" @click="emit('none')">None</button>
      </div>
    </div>

    <p v-if="!groups.length" class="hint">No clothing slots on this VRM.</p>

    <div class="groups">
      <section v-for="group in groups" :key="group.category" class="group">
        <h4>{{ group.label }}</h4>
        <div class="chips">
          <label v-for="item in group.items" :key="item.id" class="chip">
            <input
              type="checkbox"
              :checked="isChecked(item.id)"
              @change="emit('toggle', item.id, ($event.target as HTMLInputElement).checked)"
            />
            <span>{{ item.label }}</span>
          </label>
        </div>
      </section>
    </div>

    <label class="overlay">
      <span>Overlay</span>
      <select
        :value="overlayId"
        @change="emit('set-overlay', ($event.target as HTMLSelectElement).value)"
      >
        <option value="">None (hide addable list)</option>
        <option v-for="opt in overlayOptions" :key="opt.id" :value="opt.id">{{ opt.label }}</option>
      </select>
    </label>
    <p v-if="appliedCount" class="hint">
      {{ appliedCount }} overlay piece{{ appliedCount === 1 ? '' : 's' }} mixed in
      <template v-if="overlayId"> · switching overlay only changes this list</template>
    </p>

    <p v-if="overlayId && overlayLoading" class="hint">Loading overlay clothes…</p>
    <p v-else-if="overlayId && !overlayItems.length" class="hint">
      No clothing slots on that overlay character.
    </p>

    <div v-if="overlayId && overlayGroups.length" class="groups overlay-groups">
      <section v-for="group in overlayGroups" :key="'ov-' + group.category" class="group">
        <h4>Add {{ group.label }}</h4>
        <div class="chips">
          <div v-for="item in group.items" :key="item.id" class="chip-wrap">
            <label class="chip">
              <input
                type="checkbox"
                :checked="isOverlayChecked(item.id)"
                @change="
                  emit('toggle-overlay', item.id, ($event.target as HTMLInputElement).checked)
                "
              />
              <span>{{ item.label }}</span>
              <button
                v-if="isOverlayChecked(item.id)"
                type="button"
                class="gear"
                :aria-expanded="openConfigId === item.id"
                :title="'Adjust ' + item.label"
                @click.prevent="toggleConfig(item.id)"
              >
                ⚙
              </button>
            </label>
            <ClothesPieceConfig
              v-if="isOverlayChecked(item.id) && openConfigId === item.id"
              :model-value="overlayTransform(item.id)"
              @update:model-value="onOverlayTransform(item.id, $event)"
            />
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.picker {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  width: 100%;
}
.head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
}
.title {
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--muted);
}
.quick {
  display: flex;
  gap: 0.45rem;
}
.link {
  background: transparent;
  border: none;
  color: var(--accent, #c4a574);
  padding: 0;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.hint {
  margin: 0;
  font-size: 0.7rem;
  color: var(--muted);
  text-transform: none;
  letter-spacing: 0;
}
.groups {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.group h4 {
  margin: 0 0 0.2rem;
  font-size: 0.65rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--muted);
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}
.chip-wrap {
  display: flex;
  flex-direction: column;
  gap: 0;
}
.chip-wrap:has(.cfg) {
  flex: 1 1 100%;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  margin: 0;
  padding: 0.2rem 0.4rem;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #0c1014;
  font-size: 0.75rem;
  text-transform: none;
  letter-spacing: 0;
  color: var(--ink);
  cursor: pointer;
}
.chip input {
  margin: 0;
  accent-color: var(--accent, #c4a574);
}
.gear {
  margin-left: 0.15rem;
  background: transparent;
  border: none;
  color: var(--muted);
  padding: 0 0.1rem;
  font-size: 0.85rem;
  line-height: 1;
  cursor: pointer;
}
.gear[aria-expanded='true'] {
  color: var(--accent, #c4a574);
}
.overlay {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--muted);
}
.overlay select {
  text-transform: none;
  letter-spacing: 0;
  font-size: 0.85rem;
  padding: 0.35rem 0.45rem;
}
</style>
