export type StageChrome = {
  /** Fill the browser tab (hide header, overlay chat). */
  expanded: boolean
  /** Native Fullscreen API (like a video player). */
  fullscreen: boolean
}

export function isImmersive(chrome: StageChrome): boolean {
  return Boolean(chrome.expanded || chrome.fullscreen)
}

export function chromeAfterFullscreenChange(
  prev: StageChrome,
  nowFullscreen: boolean,
): StageChrome {
  return { ...prev, fullscreen: nowFullscreen }
}

export async function requestStageFullscreen(el: HTMLElement): Promise<void> {
  if (document.fullscreenElement === el) return
  if (typeof el.requestFullscreen !== 'function') {
    throw new Error('Fullscreen API unavailable')
  }
  await el.requestFullscreen()
}

export async function exitStageFullscreen(): Promise<void> {
  if (!document.fullscreenElement) return
  await document.exitFullscreen()
}

export function isStageFullscreen(el: HTMLElement | null): boolean {
  return Boolean(el && document.fullscreenElement === el)
}
