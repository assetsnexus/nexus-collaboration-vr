/**
 * WebGL renderer resilience for multi-window / multi-avatar surfaces.
 *
 * When several companion windows (or several scene stages) are open at once the
 * GPU process serialises WebGL context creation. The browser can then refuse a
 * context outright (`webglcontextcreationerror`) — a synchronously thrown error
 * that used to blank the whole window — or hand out a context it later revokes
 * (`webglcontextlost`), which used to leave the stage frozen behind a permanent
 * "Loading 3D avatar…" while the render loop spammed errors.
 *
 * This module makes context acquisition *degrade* instead of failing:
 *  - the initial request retries through a chain of cheaper context flavours
 *    (antialias on → antialias off) so one more window can always come up;
 *  - the last attempt is never less safe than the first (same colour space and
 *    alpha semantics), only cheaper;
 *  - context loss is observable so a host can pause the render loop and show an
 *    honest notice instead of a frozen stage.
 *
 * TRUST: nothing here authenticates, dispatches commands, or touches 2FA. It is
 * purely a rendering concern.
 */

/** The subset of `THREE.WebGLRendererParameters` this module reasons about. */
export type RendererContextParams = {
  antialias: boolean
  alpha: boolean
  powerPreference?: 'default' | 'high-performance' | 'low-power'
  failIfMajorPerformanceCaveat?: boolean
}

export type RendererFlavor = RendererContextParams & {
  /** Stable id for logs/tests, e.g. `aa-high-perf`. */
  id: string
}

/**
 * Default retry chain. The first flavour is what the app has always requested
 * (friendly AA, default power preference). Each subsequent one is strictly
 * cheaper to allocate, so a busy GPU process can still grant it. `alpha` never
 * changes — flipping it would change compositing, not cost.
 */
export function defaultRendererFlavors(base?: Partial<RendererContextParams>): RendererFlavor[] {
  const alpha = base?.alpha !== false
  return [
    { id: 'aa', antialias: true, alpha, powerPreference: 'default' },
    { id: 'aa-low-power', antialias: true, alpha, powerPreference: 'low-power' },
    { id: 'no-aa', antialias: false, alpha, powerPreference: 'default' },
  ]
}

/** True when a canvas event means the GPU refused to create the context. */
export function isContextCreationErrorEvent(event: unknown): boolean {
  if (!event || typeof event !== 'object') return false
  return (event as { type?: unknown }).type === 'webglcontextcreationerror'
}

/** True for either the WebGL1 or WebGL2 name of the context-loss event. */
export function isContextLostEvent(event: unknown): boolean {
  if (!event || typeof event !== 'object') return false
  const type = (event as { type?: unknown }).type
  return (
    type === 'webglcontextlost' ||
    type === 'webgl2contextlost' ||
    (type === 'contextlost' && typeof (event as { statusMessage?: unknown }).statusMessage === 'string')
  )
}

/** True for either the WebGL1 or WebGL2 name of the context-restore event. */
export function isContextRestoredEvent(event: unknown): boolean {
  if (!event || typeof event !== 'object') return false
  const type = (event as { type?: unknown }).type
  return type === 'webglcontextrestored' || type === 'webgl2contextrestored'
}

/**
 * Human copy for a context-creation failure. The browser's `statusMessage` is
 * absent on some drivers; never render an empty string, and never expose the raw
 * driver blob — it can be huge and unhelpful.
 */
export function contextCreationFailureReason(event: unknown): string {
  const raw = (event as { statusMessage?: unknown } | null)?.statusMessage
  const message = typeof raw === 'string' ? raw.trim() : ''
  if (!message) return 'the graphics device refused a WebGL context'
  // Keep the first clause only: driver messages are often multi-line blobs.
  const firstLine = message.split('\n')[0]!.trim()
  return firstLine.length > 160 ? `${firstLine.slice(0, 157)}…` : firstLine
}

export type ContextState = 'ready' | 'lost' | 'unavailable'

export type ContextRecoveryHandle = {
  /** Attach listeners; safe to call once per renderer. */
  attach(): void
  /** Remove listeners and drop the cached state. */
  dispose(): void
  /** Current state, reflecting any loss/restore that already happened. */
  state(): ContextState
  /** Subscribe to state changes (attach/detach of the listeners is separate). */
  onStateChange(listener: (state: ContextState, detail: { reason: string | null }) => void): () => void
  /** Test hook / manual drive: apply a raw DOM event. */
  handleEvent(event: unknown): void
  /**
   * Public renderer status (`ok`/`lost`/`restored`/`failed`). Lazily wired to the
   * context-state stream, so a listener attached at any time gets the current
   * value and every subsequent transition. This is what hosts re-export as
   * `onRendererStatus`.
   */
  onStatus(handler: RendererStatusListener): () => void
  /** Current renderer status. */
  status(): RendererStatus
  /**
   * Force the `unavailable` state after acquisition failed without a
   * `webglcontextcreationerror` event (every flavour threw). Keeps the state
   * consistent with a `null` renderer.
   */
  markUnavailable(reason: string | null): void
}

export type ContextRecoveryOptions = {
  /** Canvas whose context the renderer owns. */
  canvas: { addEventListener?: Function; removeEventListener?: Function } | null
  /**
   * Initial state. Pass `'unavailable'` when context creation already failed so
   * the host never renders into a context it does not have.
   */
  initial?: ContextState
  onStateChange?: (state: ContextState, detail: { reason: string | null }) => void
  logger?: { warn?: Function }
}

/**
 * Track WebGL context loss/restore for one canvas.
 *
 * A lost context is *recoverable*: the host should pause rendering (not throw)
 * and wait for `webglcontextrestored`. We call `preventDefault()` on the loss
 * event (required for the browser to attempt a restore) and then let Three.js's
 * own listener re-initialise GL state — we never add a competing restore path.
 */
export function createContextRecovery(options: ContextRecoveryOptions): ContextRecoveryHandle {
  let state: ContextState = options.initial ?? 'ready'
  let reason: string | null = null
  let attached = false
  const listeners = new Set<(state: ContextState, detail: { reason: string | null }) => void>()
  const statusSource = new RendererStatusSource()
  // Seed the initial status: a host that attached a listener before this call
  // still learns whether the context came up at all.
  statusSource.setContextState(state, reason)

  const emit = () => {
    statusSource.setContextState(state, reason)
    options.onStateChange?.(state, { reason })
    for (const listener of listeners) {
      try {
        listener(state, { reason })
      } catch (err) {
        options.logger?.warn?.('[character-kit] context state listener', err)
      }
    }
  }

  const setState = (next: ContextState, nextReason: string | null) => {
    if (state === next && reason === nextReason) return
    state = next
    reason = nextReason
    emit()
  }

  const handleEvent = (event: unknown) => {
    if (isContextLostEvent(event)) {
      // `preventDefault()` is REQUIRED for the browser to attempt a restore at
      // all. Three.js installs its own loss listener that also calls it; the call
      // is idempotent, so doing it here as well does not create a second restore
      // path — and it guarantees the restore happens even if a host strips
      // three's listener. We still just record state; three re-inits GL itself.
      const prevent = (event as { preventDefault?: () => void }).preventDefault
      if (typeof prevent === 'function') prevent.call(event)
      setState('lost', 'the graphics context was lost')
      options.logger?.warn?.('[character-kit] WebGL context lost; pausing render')
      return
    }
    if (isContextRestoredEvent(event)) {
      setState('ready', null)
      options.logger?.warn?.('[character-kit] WebGL context restored; resuming render')
      return
    }
    if (isContextCreationErrorEvent(event)) {
      setState('unavailable', contextCreationFailureReason(event))
    }
  }

  const canvas = options.canvas
  return {
    attach() {
      if (attached || !canvas?.addEventListener) return
      attached = true
      canvas.addEventListener('webglcontextlost', handleEvent as never, false)
      canvas.addEventListener('webglcontextrestored', handleEvent as never, false)
      canvas.addEventListener('webglcontextcreationerror', handleEvent as never, false)
    },
    dispose() {
      if (attached && canvas?.removeEventListener) {
        canvas.removeEventListener('webglcontextlost', handleEvent as never, false)
        canvas.removeEventListener('webglcontextrestored', handleEvent as never, false)
        canvas.removeEventListener('webglcontextcreationerror', handleEvent as never, false)
      }
      attached = false
      listeners.clear()
    },
    state: () => state,
    onStateChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    handleEvent,
    onStatus: (handler) => statusSource.on(handler),
    status: () => statusSource.get(),
    markUnavailable(nextReason) {
      setState('unavailable', nextReason)
    },
  }
}

export type ResilientRenderer<T> = {
  /** The renderer, or null when every flavour was refused. */
  renderer: T | null
  /** The flavour that succeeded (null when none did). */
  flavor: RendererFlavor | null
  /** Flavours attempted, in order, with their failure reason. */
  attempts: Array<{ id: string; ok: boolean; reason: string | null }>
  /** Shared context-loss tracker for the canvas. */
  context: ContextRecoveryHandle
}

export type CreateResilientRendererOptions<T> = {
  canvas: { addEventListener?: Function; removeEventListener?: Function } | null
  /** Construct one renderer for a flavour. Throw to signal refusal. */
  create: (params: RendererContextParams) => T
  /** Release a half-constructed renderer before the next attempt. */
  dispose?: (renderer: T) => void
  flavors?: RendererFlavor[]
  logger?: { warn?: Function }
  /**
   * Called on every non-fatal degradation (a flavour was refused) so the host
   * can surface a one-line "running in compatibility mode" notice.
   */
  onDegrade?: (detail: { id: string; reason: string | null }) => void
}

/**
 * Acquire a WebGL renderer, retrying through cheaper flavours. Never throws:
 * a total failure yields `renderer: null` plus the attempt log, so the host can
 * show a fallback (profile image / notice) instead of crashing the window.
 */
export function createResilientRenderer<T>(options: CreateResilientRendererOptions<T>): ResilientRenderer<T> {
  const flavors = options.flavors ?? defaultRendererFlavors()
  const context = createContextRecovery({
    canvas: options.canvas,
    logger: options.logger,
  })
  context.attach()

  const attempts: ResilientRenderer<T>['attempts'] = []
  let renderer: T | null = null
  let flavor: RendererFlavor | null = null

  for (const candidate of flavors) {
    try {
      renderer = options.create(candidate)
      flavor = candidate
      attempts.push({ id: candidate.id, ok: true, reason: null })
      break
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err ?? 'unknown error')
      attempts.push({ id: candidate.id, ok: false, reason })
      options.logger?.warn?.(`[character-kit] renderer flavour "${candidate.id}" refused:`, reason)
      options.onDegrade?.({ id: candidate.id, reason })
    }
  }

  // A `null` renderer must be observable even when the browser never fired a
  // creation-error event (every flavour simply threw).
  if (!renderer) {
    const lastReason = attempts.at(-1)?.reason ?? null
    context.markUnavailable(lastReason)
  }

  return { renderer, flavor, attempts, context }
}

/**
 * A context that is `lost`/`unavailable` must not be rendered into: the draw
 * calls would throw every frame. Hosts call this in their animation loop.
 */
export function contextAllowsRender(state: ContextState): boolean {
  return state === 'ready'
}

/** True when the surface should show a compatibility/fallback notice. */
export function contextNeedsFallbackNotice(state: ContextState): boolean {
  return state === 'unavailable'
}

export type RendererStatusState = 'ok' | 'lost' | 'restored' | 'failed'

/**
 * Host-facing renderer status. `lost`/`failed` carry a human `message`; `ok` and
 * `restored` do not. This is the public shape both hosts expose via
 * `onRendererStatus`, so a window that is starving for GPU can explain itself
 * instead of showing a permanently blank canvas.
 */
export type RendererStatus = {
  state: RendererStatusState
  message?: string
}

export type RendererStatusListener = (status: RendererStatus) => void

/**
 * Shared status emitter for both hosts. It owns the one piece of state a stateless
 * mapping cannot derive: whether a `ready` context is a *recovery* (`restored`)
 * or the initial good state (`ok`).
 */
export class RendererStatusSource {
  private status: RendererStatus = { state: 'ok' }
  private wasLost = false
  private readonly handlers = new Set<RendererStatusListener>()

  get(): RendererStatus {
    return { ...this.status }
  }

  /** Publish an explicit status (used for the initial creation result). */
  emit(next: RendererStatus): void {
    this.status = next.message ? { state: next.state, message: next.message } : { state: next.state }
    const snapshot = this.get()
    for (const handler of [...this.handlers]) {
      try {
        handler(snapshot)
      } catch {
        /* a listener must never break the render loop */
      }
    }
  }

  /**
   * Fold a raw context state into the public status. Returns the new status so
   * the caller can act on `lost` / `restored` without re-reading `get()`.
   */
  setContextState(state: ContextState, reason: string | null): RendererStatus {
    if (state === 'unavailable') {
      this.wasLost = false
      this.emit({ state: 'failed', message: reason ?? undefined })
      return this.get()
    }
    if (state === 'lost') {
      this.wasLost = true
      this.emit({ state: 'lost', message: reason ?? undefined })
      return this.get()
    }
    const recovered = this.wasLost
    this.wasLost = false
    this.emit({ state: recovered ? 'restored' : 'ok' })
    return this.get()
  }

  /** Subscribe and replay the current status so a late listener is never blind. */
  on(handler: RendererStatusListener): () => void {
    this.handlers.add(handler)
    try {
      handler(this.get())
    } catch {
      /* ignore listener errors */
    }
    return () => {
      this.handlers.delete(handler)
    }
  }

  clear(): void {
    this.handlers.clear()
  }
}

/** One-line, user-safe notice for a non-ready context. */
export function contextFallbackNotice(state: ContextState, reason: string | null): string {
  if (state === 'ready') return ''
  if (state === 'lost') {
    return 'The 3D view lost its graphics context and is restoring. If it stays blank, close and reopen this window.'
  }
  const detail = reason?.trim()
  return detail
    ? `3D avatar unavailable — ${detail}. Other windows keep working.`
    : '3D avatar unavailable on this display. Other windows keep working.'
}
