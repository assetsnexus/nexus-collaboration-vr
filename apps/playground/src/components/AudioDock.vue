<script setup lang="ts">
import SoundWave from './SoundWave.vue'

defineProps<{
  userEnergy: number
  botEnergy: number
  userActive: boolean
  botActive: boolean
  micMuted: boolean
  botMuted: boolean
  recording: boolean
  status: string
}>()

const emit = defineEmits<{
  'toggle-mic': []
  'toggle-bot-mute': []
  'record-down': [event: PointerEvent]
  'record-up': [event: PointerEvent]
  'record-cancel': []
}>()

function onRecordDown(e: PointerEvent): void {
  if (e.button !== 0) return
  e.preventDefault()
  try {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  } catch {
    /* optional */
  }
  emit('record-down', e)
}

function onRecordUp(e: PointerEvent): void {
  emit('record-up', e)
}

function onRecordCancel(): void {
  emit('record-cancel')
}
</script>

<template>
  <div class="dock" role="group" aria-label="Voice controls">
    <div class="lane you" :class="{ live: userActive, muted: micMuted }">
      <span class="lane-tag">You</span>
      <SoundWave :energy="userEnergy" :active="userActive" />
    </div>
    <div class="lane bot" :class="{ live: botActive, muted: botMuted }">
      <span class="lane-tag">Bot</span>
      <SoundWave :energy="botEnergy" :active="botActive" />
    </div>
    <button
      type="button"
      class="icon-btn"
      :class="{ on: !micMuted, off: micMuted }"
      :title="micMuted ? 'Unmute microphone' : 'Mute microphone'"
      :aria-pressed="!micMuted"
      @click="emit('toggle-mic')"
    >
      <svg v-if="!micMuted" viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z"
        />
      </svg>
      <svg v-else viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M19 11h-2a5 5 0 0 1-.54 2.28l1.46 1.46A6.97 6.97 0 0 0 19 11ZM10.8 5.1 12 4.9V6l2.9 2.9A3 3 0 0 0 12 6V5.1ZM4.27 3 3 4.27 8.73 10H8a4 4 0 0 0 4 4c.3 0 .58-.04.86-.1l1.4 1.4A6.93 6.93 0 0 1 12 17.92V21h2v-3.08c.8-.12 1.55-.4 2.24-.8l3.49 3.49L21 19.73 4.27 3Z"
        />
      </svg>
    </button>
    <button
      type="button"
      class="icon-btn"
      :class="{ on: !botMuted, off: botMuted }"
      :title="botMuted ? 'Unmute bot voice' : 'Mute bot voice'"
      :aria-pressed="!botMuted"
      @click="emit('toggle-bot-mute')"
    >
      <svg v-if="!botMuted" viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M5 9v6h4l5 5V4L9 9H5Zm12.5 3A4.5 4.5 0 0 0 14 8.65v6.7A4.5 4.5 0 0 0 17.5 12ZM14 3.23v2.06a7 7 0 0 1 0 13.42v2.06A9 9 0 0 0 14 3.23Z"
        />
      </svg>
      <svg v-else viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M4.27 3 3 4.27 7.73 9H5v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a9 9 0 0 0 3.55-1.77L19.73 21 21 19.73 4.27 3ZM14 4 12.1 5.9 14 7.8V4Z"
        />
      </svg>
    </button>
    <button
      type="button"
      class="icon-btn rec"
      :class="{ hot: recording }"
      title="Hold to record · release to send · Esc cancels"
      :aria-pressed="recording"
      @pointerdown="onRecordDown"
      @pointerup="onRecordUp"
      @pointercancel="onRecordCancel"
      @contextmenu.prevent
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="7" fill="currentColor" />
      </svg>
    </button>
    <p v-if="status" class="status" :title="status">{{ status }}</p>
  </div>
</template>

<style scoped>
.dock {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.28rem 0.4rem 0.28rem 0.5rem;
  border-radius: 999px;
  background: rgba(12, 16, 20, 0.82);
  border: 1px solid var(--line);
  backdrop-filter: blur(10px);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35);
  max-width: min(100%, 420px);
}
.lane {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  color: var(--muted);
  padding: 0 0.15rem;
}
.lane.you.live {
  color: #8fd4a8;
}
.lane.bot.live {
  color: var(--accent);
}
.lane.muted {
  opacity: 0.45;
}
.lane-tag {
  font-size: 0.58rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  line-height: 1;
}
.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.85rem;
  height: 1.85rem;
  padding: 0;
  border-radius: 999px;
  background: rgba(18, 23, 28, 0.7);
  color: var(--muted);
  border-color: var(--line);
  flex-shrink: 0;
}
.icon-btn svg {
  width: 15px;
  height: 15px;
}
.icon-btn.on {
  color: var(--ink);
  border-color: rgba(196, 163, 90, 0.35);
}
.icon-btn.off {
  color: var(--danger);
}
.icon-btn.rec {
  color: #d4746a;
  touch-action: none;
}
.icon-btn.rec.hot {
  background: rgba(212, 116, 106, 0.28);
  border-color: #d4746a;
  color: #ffd4cf;
  animation: rec-pulse 1s ease-in-out infinite;
}
.status {
  margin: 0;
  max-width: 7.5rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.62rem;
  color: var(--muted);
  padding-right: 0.2rem;
}
@keyframes rec-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgba(212, 116, 106, 0.45);
  }
  50% {
    box-shadow: 0 0 0 5px rgba(212, 116, 106, 0);
  }
}
</style>
