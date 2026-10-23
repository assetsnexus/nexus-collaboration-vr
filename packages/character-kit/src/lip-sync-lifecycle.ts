/**
 * Lip-sync AudioContext ownership.
 *
 * `VRMLipSync.create(vrm, { audioContext })` uses the provided context when given
 * and otherwise constructs its own (`options.audioContext ?? new AudioContext()`).
 * Its `dispose()` never closes either — the caller owns the lifecycle. That is
 * correct for a **provided/shared** context (e.g. the TTS playback graph the host
 * passed in), but a context the controller implicitly created would be retained
 * forever, since nothing else holds a reference to it.
 *
 * This helper closes the context **only** when the controller itself created it.
 * A caller-provided context is never touched.
 */

/** Minimal shape of a lip-sync instance for lifecycle purposes. */
export type LipSyncContextOwner = {
  readonly audioContext?: AudioContext | null
  dispose(): void
}

/**
 * Dispose a lip-sync instance, closing its AudioContext only when this caller
 * created it (`ownsContext === true`) and it is not already closed.
 *
 * @returns true when the audio context was closed.
 */
export function releaseLipSync(
  lip: LipSyncContextOwner | null | undefined,
  ownsContext: boolean,
): boolean {
  if (!lip) return false
  const ctx = lip.audioContext ?? null
  try {
    lip.dispose()
  } catch {
    /* engine teardown best-effort */
  }
  if (!ownsContext || !ctx || ctx.state === 'closed') return false
  // `close()` can reject if the context is already closing; never surface that.
  try {
    void Promise.resolve(ctx.close()).catch(() => undefined)
  } catch {
    /* ignore */
  }
  return true
}
