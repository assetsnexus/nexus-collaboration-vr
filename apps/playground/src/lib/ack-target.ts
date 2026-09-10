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

/** Pixel-equivalent |deltaY| before a zoom ack fires. */
export const ZOOM_ACK_DELTA_THRESHOLD = 40

/** Ignore further wheel ticks after a zoom gesture starts. */
export const ZOOM_ACK_COOLDOWN_MS = 550

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
