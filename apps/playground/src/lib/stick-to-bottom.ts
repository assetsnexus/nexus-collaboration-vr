/** Pixels from the bottom that still count as “following” new chat. */
export const STICK_BOTTOM_THRESHOLD_PX = 80

export function distanceFromBottom(el: HTMLElement): number {
  return el.scrollHeight - el.scrollTop - el.clientHeight
}

export function isNearBottom(
  el: HTMLElement,
  thresholdPx = STICK_BOTTOM_THRESHOLD_PX,
): boolean {
  return distanceFromBottom(el) <= thresholdPx
}

export function scrollToBottom(el: HTMLElement): void {
  el.scrollTop = el.scrollHeight
}
