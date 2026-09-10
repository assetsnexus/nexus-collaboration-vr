<script setup lang="ts">
import { formatActionDelta, type CharacterActionEvent } from '@openclaw/character-kit'

defineProps<{
  events: CharacterActionEvent[]
}>()

const emit = defineEmits<{
  clear: []
}>()
</script>

<template>
  <div class="feed">
    <div class="feed-head">
      <span class="hint">AI tools + inline tags · Δ from previous</span>
      <button type="button" class="ghost" :disabled="!events.length" @click="emit('clear')">
        Clear
      </button>
    </div>
    <ol v-if="events.length" class="list">
      <li v-for="ev in events" :key="ev.id" class="row">
        <span class="dt">{{ formatActionDelta(ev.dtMs) }}</span>
        <span class="op">{{ ev.op }}</span>
        <span class="label">{{ ev.label }}</span>
        <span class="src" :data-src="ev.source">{{ ev.source }}</span>
      </li>
    </ol>
    <p v-else class="empty">
      No AI actions yet. Tags like <code>[nod]</code> and <code>character_*</code> tools show up here.
    </p>
  </div>
</template>

<style scoped>
.feed {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
}
.feed-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.45rem;
  flex-shrink: 0;
}
.hint {
  font-size: 0.7rem;
  color: var(--muted, #8b969e);
}
.ghost {
  background: transparent;
  border: 1px solid var(--line, #2a323c);
  font-size: 0.72rem;
  padding: 0.2rem 0.45rem;
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow: auto;
  min-height: 0;
  flex: 1;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.72rem;
  line-height: 1.35;
}
.row {
  display: grid;
  grid-template-columns: 3.4rem 4.2rem 1fr auto;
  gap: 0.35rem;
  align-items: baseline;
  padding: 0.12rem 0.15rem;
  border-radius: 4px;
}
.row:nth-child(odd) {
  background: rgba(255, 255, 255, 0.03);
}
.dt {
  color: var(--muted, #8b969e);
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.op {
  color: var(--accent, #c4a574);
  text-transform: lowercase;
}
.label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.src {
  font-size: 0.62rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--muted, #8b969e);
}
.src[data-src='tag'] {
  color: var(--accent, #c4a574);
}
.src[data-src='tool'] {
  color: var(--ok, #6aae8a);
}
.src[data-src='cancel'] {
  color: var(--danger, #d4746a);
}
.empty {
  margin: 0.75rem 0 0;
  font-size: 0.75rem;
  color: var(--muted, #8b969e);
  line-height: 1.4;
}
.empty code {
  font-size: 0.72rem;
  color: var(--accent, #c4a574);
}
</style>
