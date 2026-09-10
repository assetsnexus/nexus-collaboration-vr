export const CHAT_COLUMN_MIN_PX = 280
export const CHAT_COLUMN_DEFAULT_PX = 380
export const STAGE_MIN_PX = 280
export const CHAT_COLUMN_KEY_STEP_PX = 24

/** `leftReservedPx` = space left of the chat column plus the gap before the 3D stage. */
export function clampChatColumnPx(
  next: number,
  workspaceWidth: number,
  leftReservedPx: number,
  stageMinPx = STAGE_MIN_PX,
  chatMinPx = CHAT_COLUMN_MIN_PX,
): number {
  const max = Math.floor(workspaceWidth - leftReservedPx - stageMinPx)
  const upper = Number.isFinite(max) ? Math.max(chatMinPx, max) : chatMinPx
  const value = Number.isFinite(next) ? next : CHAT_COLUMN_DEFAULT_PX
  return Math.round(Math.min(Math.max(value, chatMinPx), upper))
}

export function chatSplitGapPx(workspace: HTMLElement): number {
  const styles = getComputedStyle(workspace)
  const raw = styles.columnGap || styles.gap || '0'
  const parsed = Number.parseFloat(raw)
  return Number.isFinite(parsed) ? parsed : 0
}

export function chatWidthFromPointer(
  clientX: number,
  workspace: HTMLElement,
  chatColumn: HTMLElement,
): number {
  const ws = workspace.getBoundingClientRect()
  const chat = chatColumn.getBoundingClientRect()
  const gap = chatSplitGapPx(workspace)
  return clampChatColumnPx(clientX - chat.left, ws.width, chat.left - ws.left + gap)
}
