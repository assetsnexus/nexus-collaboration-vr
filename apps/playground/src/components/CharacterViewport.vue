<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  CharacterController,
  DEFAULT_GAZE_LIMITS,
  DEFAULT_NOD_TIME_SCALE,
  DEFAULT_ZOOM_IN_GESTURE,
  DEFAULT_ZOOM_OUT_GESTURE,
  InteractionAck,
  LOCO_WALK_SPEED,
  mergeAckGestureOptions,
  type ClothesOverlayPiece,
  type GestureManifest,
} from '@nexus/character-kit'
import MoveStick from './MoveStick.vue'
import WalkSpeedSlider from './WalkSpeedSlider.vue'

const props = defineProps<{
  vrmUrl: string
  gestureManifestUrl: string
  clothesId: string
  clothesIds?: string[]
  clothesOverlayPieces?: ClothesOverlayPiece[]
  pointerLook?: boolean
  /** Shared across agents: yaw hips toward the camera on orbit. Default false. */
  bodyFollowCamera?: boolean
  gazeHeadYawMaxDeg?: number
  gazeEyeYawMaxDeg?: number
  /** Per-agent: nod (etc.) on page clicks. */
  clickAckEnabled?: boolean
  clickAckGesture?: string
  clickAckSpeed?: number
  /** Per-agent: gesture on canvas zoom in/out. */
  zoomAckEnabled?: boolean
  zoomInGesture?: string
  zoomOutGesture?: string
  expanded?: boolean
  fullscreen?: boolean
}>()

const emit = defineEmits<{
  ready: []
  locomoting: [moving: boolean]
  'update:pointerLook': [value: boolean]
  'update:bodyFollowCamera': [value: boolean]
  'update:gazeHeadYawMaxDeg': [value: number]
  'update:gazeEyeYawMaxDeg': [value: number]
  'update:clickAckEnabled': [value: boolean]
  'update:clickAckGesture': [value: string]
  'update:clickAckSpeed': [value: number]
  'update:zoomAckEnabled': [value: boolean]
  'update:zoomInGesture': [value: string]
  'update:zoomOutGesture': [value: string]
  'toggle-expand': []
  'toggle-fullscreen': []
}>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const status = ref('idle')
const error = ref('')
const keyboardWalk = ref(true)
const avatarCfgOpen = ref(false)
const ackGestureOptions = ref<string[]>(mergeAckGestureOptions([]))
let controller: CharacterController | null = null
let resizeObs: ResizeObserver | null = null
let clothesEpoch = 0
let stopLoco: (() => void) | null = null
let interactionAck: InteractionAck | null = null

const stick = { x: 0, z: 0 }
const keys = new Set<string>()
let jumpPulse = false
const walkSpeed = ref(LOCO_WALK_SPEED)

defineExpose({
  getController: () => controller,
  resize: () => controller?.resize(),
})

function applyGazeLimits(): void {
  if (!controller) return
  const lim = controller.setGazeLimits({
    headYawMaxDeg: props.gazeHeadYawMaxDeg ?? DEFAULT_GAZE_LIMITS.headYawMaxDeg,
    eyeYawMaxDeg: props.gazeEyeYawMaxDeg ?? DEFAULT_GAZE_LIMITS.eyeYawMaxDeg,
  })
  // Kit keeps eyes ≥ head + 8°; sync UI/settings if bumped.
  if (lim.headYawMaxDeg !== Math.round(props.gazeHeadYawMaxDeg ?? DEFAULT_GAZE_LIMITS.headYawMaxDeg)) {
    emit('update:gazeHeadYawMaxDeg', lim.headYawMaxDeg)
  }
  if (lim.eyeYawMaxDeg !== Math.round(props.gazeEyeYawMaxDeg ?? DEFAULT_GAZE_LIMITS.eyeYawMaxDeg)) {
    emit('update:gazeEyeYawMaxDeg', lim.eyeYawMaxDeg)
  }
}

function onHeadYawInput(e: Event): void {
  const v = Number((e.target as HTMLInputElement).value)
  emit('update:gazeHeadYawMaxDeg', v)
}

function onEyeYawInput(e: Event): void {
  const v = Number((e.target as HTMLInputElement).value)
  emit('update:gazeEyeYawMaxDeg', v)
}

function refreshAckGestures(): void {
  ackGestureOptions.value = mergeAckGestureOptions(controller?.listGestures() ?? [], [
    (props.clickAckGesture || 'nod').trim() || 'nod',
    (props.zoomInGesture || DEFAULT_ZOOM_IN_GESTURE).trim() || DEFAULT_ZOOM_IN_GESTURE,
    (props.zoomOutGesture || DEFAULT_ZOOM_OUT_GESTURE).trim() || DEFAULT_ZOOM_OUT_GESTURE,
  ])
}

function onAckSpeedInput(e: Event): void {
  const v = Number((e.target as HTMLInputElement).value)
  emit('update:clickAckSpeed', v)
}

function playAckGesture(id: string, timeScale?: number): void {
  if (!controller || status.value !== 'ready') return
  const gid = id.trim()
  if (!gid) return
  try {
    controller.playGesture(gid, false, 0.12, timeScale)
  } catch {
    /* ignore if mixer not ready */
  }
}

function syncInteractionAck(): void {
  interactionAck?.setOptions({
    clickEnabled: props.clickAckEnabled !== false,
    clickGesture: (props.clickAckGesture || 'nod').trim() || 'nod',
    clickSpeed: props.clickAckSpeed ?? DEFAULT_NOD_TIME_SCALE,
    zoomEnabled: props.zoomAckEnabled !== false,
    zoomInGesture: (props.zoomInGesture || DEFAULT_ZOOM_IN_GESTURE).trim() || DEFAULT_ZOOM_IN_GESTURE,
    zoomOutGesture:
      (props.zoomOutGesture || DEFAULT_ZOOM_OUT_GESTURE).trim() || DEFAULT_ZOOM_OUT_GESTURE,
  })
  interactionAck?.setReady(status.value === 'ready')
}

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false
  const tag = t.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return t.isContentEditable
}

function pushMoveInput(): void {
  if (!controller) return
  let x = stick.x
  let z = stick.z
  let yaw = 0
  if (keyboardWalk.value) {
    if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1
    if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1
    if (keys.has('KeyW') || keys.has('ArrowUp')) z += 1
    if (keys.has('KeyS') || keys.has('ArrowDown')) z -= 1
    if (keys.has('KeyQ')) yaw -= 1
    if (keys.has('KeyE')) yaw += 1
  }
  const len = Math.hypot(x, z)
  if (len > 1) {
    x /= len
    z /= len
  }
  controller.setMoveInput({ x, z, yaw, jump: jumpPulse })
  jumpPulse = false
}

function onStickChange(v: { x: number; z: number }): void {
  stick.x = v.x
  stick.z = v.z
  pushMoveInput()
}

function onWalkSpeedChange(speed: number): void {
  walkSpeed.value = speed
  controller?.setAnalogSpeed(speed)
}

function onKeyDown(e: KeyboardEvent): void {
  if (!keyboardWalk.value || isTypingTarget(e.target)) return
  // Shift/Ctrl/Meta are orbit-pan modifiers — don't steal them for walking.
  if (e.shiftKey || e.ctrlKey || e.metaKey) return
  const code = e.code
  const handled = [
    'KeyW',
    'KeyA',
    'KeyS',
    'KeyD',
    'KeyQ',
    'KeyE',
    'ArrowUp',
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
    'Space',
  ].includes(code)
  if (!handled) return
  e.preventDefault()
  if (code === 'Space') {
    if (!e.repeat) jumpPulse = true
  } else {
    keys.add(code)
  }
  pushMoveInput()
}

function onKeyUp(e: KeyboardEvent): void {
  if (!keyboardWalk.value) return
  keys.delete(e.code)
  pushMoveInput()
}

function bindKeyboard(on: boolean): void {
  if (on) {
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
  } else {
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
    keys.clear()
    jumpPulse = false
    pushMoveInput()
  }
}

watch(keyboardWalk, (on) => bindKeyboard(on), { immediate: true })

function seedDemoProps(c: CharacterController): void {
  c.registerSceneObject({
    id: 'marker_left',
    kind: 'prop',
    label: 'Left marker',
    position: { x: -2, y: 0.05, z: 0.5 },
    yawDeg: 0,
    radius: 0.2,
    size: { x: 0.25, y: 0.1, z: 0.25 },
    tags: ['demo', 'marker'],
    description: 'Floor marker on the left',
  })
  c.registerSceneObject({
    id: 'marker_right',
    kind: 'prop',
    label: 'Right marker',
    position: { x: 2, y: 0.05, z: 0.5 },
    yawDeg: 0,
    radius: 0.2,
    size: { x: 0.25, y: 0.1, z: 0.25 },
    tags: ['demo', 'marker'],
    description: 'Floor marker on the right',
  })
  c.registerSceneObject({
    id: 'chair',
    kind: 'prop',
    label: 'Chair spot',
    position: { x: 0, y: 0, z: -1.5 },
    yawDeg: 180,
    radius: 0.35,
    tags: ['demo', 'furniture'],
    description: 'Empty chair landmark behind spawn',
  })
}

function demoMotion() {
  if (!controller) return
  controller.setEmotion('happy', 1, 3000)
  controller.playGesture('wave', false, 0.2)
}

function resetCamera(): void {
  controller?.resetOrbit()
}

async function applyClothes(): Promise<void> {
  if (!controller) return
  const epoch = ++clothesEpoch
  try {
    await controller.setClothes({
      id: props.clothesId,
      ids: props.clothesIds,
      overlayPieces: props.clothesOverlayPieces,
    })
  } catch (err) {
    if (epoch !== clothesEpoch) return
    error.value = err instanceof Error ? err.message : String(err)
    console.error('[viewport] clothes', err)
  }
}

async function boot() {
  if (!canvasRef.value) return
  error.value = ''
  status.value = 'loading'
  stopLoco?.()
  stopLoco = null
  controller?.dispose()
  controller = new CharacterController(canvasRef.value, {
    background: 0x12171c,
    orbitControls: true,
    pointerLook: props.pointerLook !== false,
    bodyFollowCamera: props.bodyFollowCamera === true,
  })
  seedDemoProps(controller)
  stopLoco = controller.onLocomoting((moving) => emit('locomoting', moving))
  try {
    await controller.setClothes({
      id: props.clothesId,
      ids: props.clothesIds,
      overlayPieces: props.clothesOverlayPieces,
    })
    await controller.loadVRM(props.vrmUrl)
    try {
      const res = await fetch(props.gestureManifestUrl)
      if (res.ok) {
        const manifest = (await res.json()) as GestureManifest
        await controller.loadGesturePack(manifest)
      } else {
        status.value = 'vrm-ready (no gestures)'
      }
    } catch {
      status.value = 'vrm-ready (no gestures)'
    }
    status.value = 'ready'
    controller.setSaccadesEnabled(true)
    controller.setAnalogSpeed(walkSpeed.value)
    applyGazeLimits()
    refreshAckGestures()
    emit('ready')
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
    status.value = 'error'
  }
}

onMounted(() => {
  void boot()
  resizeObs = new ResizeObserver(() => controller?.resize())
  if (canvasRef.value?.parentElement) {
    resizeObs.observe(canvasRef.value.parentElement)
  }
  if (canvasRef.value) {
    interactionAck = new InteractionAck(canvasRef.value, (id, meta) => {
      playAckGesture(id, meta.timeScale)
    })
    syncInteractionAck()
  }
})

watch(
  () => props.pointerLook,
  (on) => {
    controller?.setPointerLookEnabled(on !== false)
  },
)

watch(
  () => props.bodyFollowCamera,
  (on) => {
    controller?.setBodyFollowCamera(on === true)
  },
)

watch(
  () => [props.gazeHeadYawMaxDeg, props.gazeEyeYawMaxDeg],
  () => applyGazeLimits(),
)

watch(
  () => avatarCfgOpen.value,
  (open) => {
    if (open) refreshAckGestures()
  },
)

watch(
  () => [
    props.clickAckEnabled,
    props.clickAckGesture,
    props.clickAckSpeed,
    props.zoomAckEnabled,
    props.zoomInGesture,
    props.zoomOutGesture,
    status.value,
  ],
  () => syncInteractionAck(),
)

watch(
  () => [props.vrmUrl, props.gestureManifestUrl],
  () => void boot(),
)

watch(
  () => [
    props.clothesId,
    JSON.stringify(props.clothesIds ?? null),
    JSON.stringify(props.clothesOverlayPieces ?? []),
  ],
  () => {
    if (status.value === 'ready' || status.value.startsWith('vrm-ready')) {
      void applyClothes()
    }
  },
)

onBeforeUnmount(() => {
  clothesEpoch += 1
  bindKeyboard(false)
  interactionAck?.dispose()
  interactionAck = null
  stopLoco?.()
  stopLoco = null
  resizeObs?.disconnect()
  controller?.setMoveInput({ x: 0, z: 0, yaw: 0, jump: false })
  controller?.dispose()
  controller = null
})
</script>

<template>
  <div class="viewport">
    <canvas ref="canvasRef" />
    <div class="stick-wrap">
      <MoveStick @change="onStickChange" />
      <WalkSpeedSlider v-model="walkSpeed" @change="onWalkSpeedChange" />
    </div>
    <div class="kb-bar">
      <label class="kb-switch" title="WASD/arrows walk · Q/E turn · Space jump">
        <input v-model="keyboardWalk" type="checkbox" />
        <span>Keys</span>
      </label>
      <label
        class="kb-switch"
        title="Head and eyes follow the mouse across the window. After 5s idle, eyes ease back to you."
      >
        <input
          type="checkbox"
          :checked="pointerLook !== false"
          @change="emit('update:pointerLook', ($event.target as HTMLInputElement).checked)"
        />
        <span>Mouse look</span>
      </label>
      <button
        type="button"
        class="kb-icon"
        :class="{ on: avatarCfgOpen }"
        title="Avatar look config"
        :aria-pressed="avatarCfgOpen"
        @click="avatarCfgOpen = !avatarCfgOpen"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="currentColor"
            d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96a7.2 7.2 0 0 0-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84a.48.48 0 0 0-.48.41l-.36 2.54c-.59.24-1.13.55-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.77 8.87a.48.48 0 0 0 .12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94L2.89 14.5a.49.49 0 0 0-.12.61l1.92 3.32c.13.22.39.3.59.22l2.39-.96c.5.39 1.04.71 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.48-.41l.36-2.54c.59-.24 1.13-.55 1.62-.94l2.39.96c.22.08.46 0 .59-.22l1.92-3.32a.48.48 0 0 0-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z"
          />
        </svg>
      </button>
      <button
        type="button"
        class="kb-reset"
        title="Reset camera (clears Shift-pan offset)"
        @click="resetCamera"
      >
        Reset
      </button>
      <button
        type="button"
        class="kb-icon"
        :class="{ on: fullscreen }"
        :title="fullscreen ? 'Exit fullscreen' : 'Fullscreen (like a video)'"
        :aria-pressed="fullscreen"
        @click="emit('toggle-fullscreen')"
      >
        <svg v-if="!fullscreen" viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="currentColor"
            d="M7 14H5v5h5v-2H7v-3zm0-4h2V7h3V5H5v5h2zm10 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"
          />
        </svg>
        <svg v-else viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="currentColor"
            d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"
          />
        </svg>
      </button>
      <button
        type="button"
        class="kb-icon"
        :class="{ on: expanded }"
        :title="expanded ? 'Exit expanded view' : 'Expand 3D view to fill the browser'"
        :aria-pressed="expanded"
        @click="emit('toggle-expand')"
      >
        <svg v-if="!expanded" viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="currentColor"
            d="M4 4h7v2H6v5H4V4zm9 0h7v7h-2V6h-5V4zM4 13h2v5h5v2H4v-7zm14 0h2v7h-7v-2h5v-5z"
          />
        </svg>
        <svg v-else viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="currentColor"
            d="M9 9H4V7h3V4h2v5zm6 0V4h2v3h3v2h-5zm-6 6v5H7v-3H4v-2h5zm6 0h5v2h-3v3h-2v-5z"
          />
        </svg>
      </button>
    </div>
    <div
      v-if="avatarCfgOpen"
      class="avatar-cfg"
      role="dialog"
      aria-label="Avatar look config"
    >
      <div class="avatar-cfg-head">
        <strong>Avatar look</strong>
        <button type="button" class="avatar-cfg-close" @click="avatarCfgOpen = false">✕</button>
      </div>
      <label class="avatar-cfg-row">
        <span>Max head turn</span>
        <input
          type="range"
          min="15"
          max="55"
          step="1"
          :value="gazeHeadYawMaxDeg ?? DEFAULT_GAZE_LIMITS.headYawMaxDeg"
          @input="onHeadYawInput"
        />
        <em>{{ Math.round(gazeHeadYawMaxDeg ?? DEFAULT_GAZE_LIMITS.headYawMaxDeg) }}°</em>
      </label>
      <label class="avatar-cfg-row">
        <span>Max eye turn</span>
        <input
          type="range"
          min="25"
          max="70"
          step="1"
          :value="gazeEyeYawMaxDeg ?? DEFAULT_GAZE_LIMITS.eyeYawMaxDeg"
          @input="onEyeYawInput"
        />
        <em>{{ Math.round(gazeEyeYawMaxDeg ?? DEFAULT_GAZE_LIMITS.eyeYawMaxDeg) }}°</em>
      </label>
      <p class="avatar-cfg-hint">
        Keep eye turn above head turn so the iris can glance past the face.
      </p>
      <label
        class="avatar-cfg-switch"
        title="Shared across agents · orbit/tilt yaws the hips toward you"
      >
        <input
          type="checkbox"
          :checked="bodyFollowCamera === true"
          @change="emit('update:bodyFollowCamera', ($event.target as HTMLInputElement).checked)"
        />
        <span>Body follows camera</span>
      </label>
      <p class="avatar-cfg-hint">Off by default. Saved in this browser for every agent.</p>
      <div class="avatar-cfg-sep" />
      <label class="avatar-cfg-switch" title="Per agent · does not block page clicks">
        <input
          type="checkbox"
          :checked="clickAckEnabled !== false"
          @change="emit('update:clickAckEnabled', ($event.target as HTMLInputElement).checked)"
        />
        <span>Nod on click</span>
      </label>
      <label class="avatar-cfg-row">
        <span>Ack motion</span>
        <select
          class="avatar-cfg-select"
          :value="clickAckGesture || 'nod'"
          :disabled="clickAckEnabled === false"
          @change="emit('update:clickAckGesture', ($event.target as HTMLSelectElement).value)"
        >
          <option v-for="id in ackGestureOptions" :key="id" :value="id">{{ id }}</option>
        </select>
      </label>
      <label class="avatar-cfg-row">
        <span>Ack speed</span>
        <input
          type="range"
          min="0.35"
          max="2.5"
          step="0.05"
          :value="clickAckSpeed ?? DEFAULT_NOD_TIME_SCALE"
          :disabled="clickAckEnabled === false"
          @input="onAckSpeedInput"
        />
        <em>×{{ (clickAckSpeed ?? DEFAULT_NOD_TIME_SCALE).toFixed(2) }}</em>
      </label>
      <p class="avatar-cfg-hint">Saved per agent. Orbit/drags are ignored. Motion debug clicks are ignored.</p>
      <div class="avatar-cfg-sep" />
      <label class="avatar-cfg-switch" title="Per agent · wheel on the 3D view only">
        <input
          type="checkbox"
          :checked="zoomAckEnabled !== false"
          @change="emit('update:zoomAckEnabled', ($event.target as HTMLInputElement).checked)"
        />
        <span>Gestures on zoom</span>
      </label>
      <label class="avatar-cfg-row">
        <span>Zoom in</span>
        <select
          class="avatar-cfg-select"
          :value="zoomInGesture || DEFAULT_ZOOM_IN_GESTURE"
          :disabled="zoomAckEnabled === false"
          @change="emit('update:zoomInGesture', ($event.target as HTMLSelectElement).value)"
        >
          <option v-for="id in ackGestureOptions" :key="'in-' + id" :value="id">{{ id }}</option>
        </select>
      </label>
      <label class="avatar-cfg-row">
        <span>Zoom out</span>
        <select
          class="avatar-cfg-select"
          :value="zoomOutGesture || DEFAULT_ZOOM_OUT_GESTURE"
          :disabled="zoomAckEnabled === false"
          @change="emit('update:zoomOutGesture', ($event.target as HTMLSelectElement).value)"
        >
          <option v-for="id in ackGestureOptions" :key="'out-' + id" :value="id">{{ id }}</option>
        </select>
      </label>
      <p class="avatar-cfg-hint">Defaults: v-sign in, wave out. Canvas wheel only.</p>
    </div>
    <div class="hud">
      <span>{{ status }}</span>
      <button type="button" class="demo" :disabled="status !== 'ready'" @click="demoMotion">
        Demo wave
      </button>
      <span v-if="error" class="err">{{ error }}</span>
    </div>
  </div>
</template>

<style scoped>
.viewport {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 280px;
  background: #0a0c0e;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid var(--line);
}
canvas {
  width: 100%;
  height: 100%;
  display: block;
}
.stick-wrap {
  position: absolute;
  left: 12px;
  bottom: 36px;
  z-index: 2;
  display: flex;
  align-items: flex-end;
  gap: 10px;
}
.kb-bar {
  position: absolute;
  right: 12px;
  bottom: 12px;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 0.35rem;
}
.kb-switch {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.68rem;
  color: var(--muted);
  background: rgba(18, 23, 28, 0.78);
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 0.2rem 0.55rem 0.2rem 0.35rem;
  cursor: pointer;
  user-select: none;
}
.kb-switch input {
  accent-color: var(--accent);
  margin: 0;
}
.kb-reset {
  font-size: 0.68rem;
  padding: 0.2rem 0.5rem;
  border-radius: 999px;
  background: rgba(18, 23, 28, 0.78);
  border: 1px solid var(--line);
  color: var(--muted);
  cursor: pointer;
}
.kb-reset:hover,
.kb-icon:hover {
  color: var(--ink);
  border-color: var(--accent);
}
.kb-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.7rem;
  height: 1.7rem;
  padding: 0;
  border-radius: 999px;
  background: rgba(18, 23, 28, 0.78);
  border: 1px solid var(--line);
  color: var(--muted);
  cursor: pointer;
}
.kb-icon svg {
  width: 14px;
  height: 14px;
}
.kb-icon.on {
  color: var(--accent);
  border-color: var(--accent);
}
.avatar-cfg {
  position: absolute;
  right: 12px;
  bottom: 48px;
  z-index: 4;
  width: min(280px, calc(100% - 24px));
  padding: 0.7rem 0.75rem 0.8rem;
  border-radius: 12px;
  background: rgba(14, 18, 22, 0.94);
  border: 1px solid var(--line);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.35);
  color: var(--ink);
  pointer-events: auto;
}
.avatar-cfg-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.55rem;
  font-size: 0.78rem;
}
.avatar-cfg-close {
  border: 0;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  font-size: 0.85rem;
  padding: 0.1rem 0.25rem;
}
.avatar-cfg-row {
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-rows: auto auto;
  gap: 0.15rem 0.5rem;
  align-items: center;
  margin: 0.45rem 0;
  font-size: 0.68rem;
  color: var(--muted);
}
.avatar-cfg-row span {
  grid-column: 1;
}
.avatar-cfg-row em {
  grid-column: 2;
  font-style: normal;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
  min-width: 2.2rem;
  text-align: right;
}
.avatar-cfg-row input[type='range'] {
  grid-column: 1 / -1;
  width: 100%;
  accent-color: var(--accent);
}
.avatar-cfg-hint {
  margin: 0.35rem 0 0;
  font-size: 0.62rem;
  line-height: 1.35;
  color: var(--muted);
}
.avatar-cfg-sep {
  height: 1px;
  margin: 0.65rem 0 0.45rem;
  background: var(--line);
}
.avatar-cfg-switch {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0.35rem 0 0.5rem;
  font-size: 0.72rem;
  color: var(--ink);
  cursor: pointer;
}
.avatar-cfg-switch input {
  accent-color: var(--accent);
}
.avatar-cfg-select {
  grid-column: 1 / -1;
  width: 100%;
  margin-top: 0.15rem;
  padding: 0.25rem 0.35rem;
  border-radius: 6px;
  border: 1px solid var(--line);
  background: rgba(8, 10, 12, 0.85);
  color: var(--ink);
  font-size: 0.72rem;
}
.hud {
  position: absolute;
  left: 10px;
  bottom: 8px;
  font-size: 0.7rem;
  color: var(--muted);
  display: flex;
  gap: 0.75rem;
  align-items: center;
}
.demo {
  font-size: 0.7rem;
  padding: 0.2rem 0.45rem;
}
.err {
  color: var(--danger);
}
</style>
