import { DEFAULT_NOD_TIME_SCALE } from './gesture-variants.js'

/** Clicks on these targets must not fire character click-ack (nod). */
export const ACK_IGNORE_SELECTOR = [
  'button',
  'a',
  'input',
  'select',
  'textarea',
  'label',
  'option',
  'summary',
  '[role="dialog"]',
  '[role="menu"]',
  '[role="tablist"]',
  '[role="tab"]',
  '[role="listbox"]',
  '[role="option"]',
  '[contenteditable="true"]',
  '[data-ack-ignore]',
  '.backdrop',
].join(', ')

export const DEFAULT_ZOOM_IN_GESTURE = 'v_sign'
export const DEFAULT_ZOOM_OUT_GESTURE = 'wave'
export const DEFAULT_CLICK_ACK_GESTURE = 'nod'

/** Pixel-equivalent |deltaY| before a zoom ack fires. */
export const ZOOM_ACK_DELTA_THRESHOLD = 40

/** Ignore further wheel ticks after a zoom gesture starts. */
export const ZOOM_ACK_COOLDOWN_MS = 550

/** Ignore further page clicks after a click-ack gesture. */
export const CLICK_ACK_COOLDOWN_MS = 180

/** Pointer travel (px) treated as orbit/drag rather than a click. */
export const CLICK_ACK_DRAG_PX = 8

export const ACK_GESTURE_FALLBACK = [
  DEFAULT_CLICK_ACK_GESTURE,
  'nod_soft',
  'agree',
  'disagree',
  DEFAULT_ZOOM_IN_GESTURE,
  'v_sign_short',
  DEFAULT_ZOOM_OUT_GESTURE,
] as const

export type InteractionAckOptions = {
  clickEnabled: boolean
  clickGesture: string
  clickSpeed: number
  zoomEnabled: boolean
  zoomInGesture: string
  zoomOutGesture: string
}

export const DEFAULT_INTERACTION_ACK: InteractionAckOptions = {
  clickEnabled: true,
  clickGesture: DEFAULT_CLICK_ACK_GESTURE,
  clickSpeed: DEFAULT_NOD_TIME_SCALE,
  zoomEnabled: true,
  zoomInGesture: DEFAULT_ZOOM_IN_GESTURE,
  zoomOutGesture: DEFAULT_ZOOM_OUT_GESTURE,
}

export type InteractionAckReason = 'click' | 'zoom'

export type InteractionAckPlay = (
  gestureId: string,
  meta: { reason: InteractionAckReason; timeScale?: number },
) => void

/**
 * True when a click is on UI (motion debug, buttons, dialogs) rather than the page/canvas.
 * Duck-typed so Node tests can mock `closest` without a DOM.
 */
export function isInteractiveAckTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as { closest?: unknown }).closest !== 'function') return false
  return Boolean((target as Element).closest(ACK_IGNORE_SELECTOR))
}

/** Normalize wheel deltaY to CSS pixels (OrbitControls: +Y = dolly out). */
export function normalizeWheelDeltaY(e: Pick<WheelEvent, 'deltaY' | 'deltaMode'>): number {
  const dy = e.deltaY
  if (!Number.isFinite(dy)) return 0
  if (e.deltaMode === 1) return dy * 16
  if (e.deltaMode === 2) return dy * 80
  return dy
}

/** Map accumulated wheel delta to zoom-in / zoom-out. */
export function zoomAckDirection(
  accumulatedDeltaY: number,
  threshold = ZOOM_ACK_DELTA_THRESHOLD,
): 'in' | 'out' | null {
  if (!Number.isFinite(accumulatedDeltaY) || threshold <= 0) return null
  if (Math.abs(accumulatedDeltaY) < threshold) return null
  return accumulatedDeltaY > 0 ? 'out' : 'in'
}

export function normalizeClickAckSpeed(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n)) return DEFAULT_NOD_TIME_SCALE
  return Math.min(3, Math.max(0.35, n))
}

function gestureId(raw: unknown, fallback: string): string {
  const id = typeof raw === 'string' ? raw.trim() : ''
  return id || fallback
}

export function normalizeInteractionAck(
  partial?: Partial<InteractionAckOptions> | null,
): InteractionAckOptions {
  return {
    clickEnabled: partial?.clickEnabled !== false,
    clickGesture: gestureId(partial?.clickGesture, DEFAULT_CLICK_ACK_GESTURE),
    clickSpeed: normalizeClickAckSpeed(partial?.clickSpeed),
    zoomEnabled: partial?.zoomEnabled !== false,
    zoomInGesture: gestureId(partial?.zoomInGesture, DEFAULT_ZOOM_IN_GESTURE),
    zoomOutGesture: gestureId(partial?.zoomOutGesture, DEFAULT_ZOOM_OUT_GESTURE),
  }
}

/** Prefer loaded fallbacks, then the rest of the pack, always keeping current ids. */
export function mergeAckGestureOptions(loadedIds: string[], current: string[] = []): string[] {
  const ids = loadedIds.map((id) => id.trim()).filter(Boolean)
  const prefer = [...ACK_GESTURE_FALLBACK]
  const preferSet = new Set<string>(prefer)
  const rest = ids.filter((id) => !preferSet.has(id)).sort()
  const merged = [...prefer.filter((id) => ids.length === 0 || ids.includes(id)), ...rest]
  for (const id of current.map((c) => c.trim()).filter(Boolean).reverse()) {
    if (!merged.includes(id)) merged.unshift(id)
  }
  return merged.length ? merged : [...ACK_GESTURE_FALLBACK]
}

/**
 * Page-click nod + canvas-wheel zoom gestures. Same rules as the playground:
 * document clicks (UI ignored), canvas wheel only, drag does not ack.
 */
export class InteractionAck {
  private opts = { ...DEFAULT_INTERACTION_ACK }
  private ready = false
  private active = true
  private ptrDown: { x: number; y: number } | null = null
  private lastClickAt = 0
  private lastZoomAt = 0
  private zoomAcc = 0
  private readonly play: InteractionAckPlay
  private readonly unbind: () => void

  constructor(canvas: HTMLCanvasElement, play: InteractionAckPlay) {
    this.play = play
    this.onPointerDown = this.onPointerDown.bind(this)
    this.onClick = this.onClick.bind(this)
    this.onWheel = this.onWheel.bind(this)
    window.addEventListener('pointerdown', this.onPointerDown, { passive: true })
    document.addEventListener('click', this.onClick)
    canvas.addEventListener('wheel', this.onWheel, { passive: true })
    this.unbind = () => {
      window.removeEventListener('pointerdown', this.onPointerDown)
      document.removeEventListener('click', this.onClick)
      canvas.removeEventListener('wheel', this.onWheel)
    }
  }

  setOptions(partial: Partial<InteractionAckOptions>): void {
    this.opts = normalizeInteractionAck({ ...this.opts, ...partial })
  }

  getOptions(): InteractionAckOptions {
    return { ...this.opts }
  }

  /** False until VRM/gestures are loaded. */
  setReady(ready: boolean): void {
    this.ready = ready
  }

  /** False for unfocused split-view companions so they do not all nod. */
  setActive(active: boolean): void {
    this.active = active
  }

  dispose(): void {
    this.unbind()
    this.ready = false
  }

  private onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return
    this.ptrDown = { x: e.clientX, y: e.clientY }
  }

  private onClick(e: MouseEvent): void {
    if (!this.ready || !this.active || !this.opts.clickEnabled) return
    if (e.button !== 0) return
    if (isInteractiveAckTarget(e.target)) return
    if (this.ptrDown && Math.hypot(e.clientX - this.ptrDown.x, e.clientY - this.ptrDown.y) > CLICK_ACK_DRAG_PX) {
      return
    }
    const now = performance.now()
    if (now - this.lastClickAt < CLICK_ACK_COOLDOWN_MS) return
    this.lastClickAt = now
    this.play(this.opts.clickGesture, {
      reason: 'click',
      timeScale: this.opts.clickSpeed,
    })
  }

  private onWheel(e: WheelEvent): void {
    if (!this.ready || !this.opts.zoomEnabled) return
    if (e.ctrlKey || e.metaKey) return
    const now = performance.now()
    if (now - this.lastZoomAt < ZOOM_ACK_COOLDOWN_MS) return
    this.zoomAcc += normalizeWheelDeltaY(e)
    const dir = zoomAckDirection(this.zoomAcc)
    if (!dir) return
    this.zoomAcc = 0
    this.lastZoomAt = now
    const id = dir === 'in' ? this.opts.zoomInGesture : this.opts.zoomOutGesture
    this.play(id, { reason: 'zoom' })
  }
}
