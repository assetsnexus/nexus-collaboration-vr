export type ActionTimedProgress = {
  /** 0–1 of expected duration, frozen at cancel. */
  ratio: number
  canceled: boolean
}

export type TimedActionSnapshot = {
  at: number
  durationMs?: number
  endedAt?: number
  status: string
}

/**
 * OP-column fill for one-shot gestures / waits. Null when the op has no fixed length.
 */
export function actionTimedProgress(
  ev: TimedActionSnapshot,
  now: number,
): ActionTimedProgress | null {
  const dur = ev.durationMs
  if (!Number.isFinite(dur) || dur <= 0) return null
  const canceled = ev.status === 'canceled' || ev.status === 'discarded'
  if (ev.status === 'pending') return { ratio: 0, canceled: false }
  if (canceled) {
    const end = ev.endedAt ?? now
    const ratio = Math.min(1, Math.max(0, (end - ev.at) / dur))
    return { ratio, canceled: true }
  }
  if (ev.status === 'done') {
    const end = ev.endedAt ?? ev.at + dur
    const ratio = Math.min(1, Math.max(0, (end - ev.at) / dur))
    return { ratio, canceled: false }
  }
  const ratio = Math.min(1, Math.max(0, (now - ev.at) / dur))
  return { ratio, canceled: false }
}
