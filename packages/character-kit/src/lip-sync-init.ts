/**
 * AudioWorkletNode construction is not re-entrant on one AudioContext.
 * Parallel VRMLipSync.create() calls hit:
 *   InvalidStateError: No execution context available
 * while addModule is still installing the processor.
 *
 * Chromium also refuses the first AudioWorkletNode until the context has a
 * worklet backing thread. wlipsync tries `new AudioWorkletNode` before
 * addModule; that throws this error instead of "processor not defined".
 */

let chain: Promise<void> = Promise.resolve()
const warmedContexts = new WeakSet<AudioContext>()

const WARM_PROCESSOR_SOURCE =
  'class OcLipSyncWarmProcessor extends AudioWorkletProcessor { process() { return true } }\n' +
  'registerProcessor("oc-lip-sync-warm", OcLipSyncWarmProcessor)\n'

export function enqueueAudioWorkletInit<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn)
  chain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

export async function ensureAudioContextRunning(ctx: AudioContext): Promise<void> {
  if (ctx.state === 'closed') {
    throw new Error('AudioContext is closed')
  }
  if (ctx.state === 'suspended') {
    await ctx.resume()
  }
  // `resume()` can reject if the context closed mid-call; re-read defensively.
  if ((ctx.state as AudioContextState) === 'closed') {
    throw new Error('AudioContext is closed')
  }
}

/** Start the AudioWorklet backing thread so AudioWorkletNode can be constructed. */
export async function ensureAudioWorkletReady(ctx: AudioContext): Promise<void> {
  await ensureAudioContextRunning(ctx)
  if (warmedContexts.has(ctx)) return
  if (!ctx.audioWorklet) {
    throw new Error('AudioWorklet is not available')
  }
  const blob = new Blob([WARM_PROCESSOR_SOURCE], { type: 'application/javascript' })
  const url = URL.createObjectURL(blob)
  try {
    await ctx.audioWorklet.addModule(url)
    warmedContexts.add(ctx)
  } finally {
    URL.revokeObjectURL(url)
  }
}
