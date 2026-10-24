/**
 * WebXR immersive-vr session helpers — same rails as portal play-webxr / play-vr-config.
 * Framework-agnostic (no three / Vue). Phone stereo falls back when immersive-vr is unavailable.
 */

export type VrReferenceSpaceId = 'local-floor' | 'local'

export type ImmersiveVrSessionInit = {
  referenceSpace: VrReferenceSpaceId
  optionalFeatures: string[]
}

export type XrLikeNavigator = {
  xr?: {
    isSessionSupported?: (mode: string) => Promise<boolean>
    requestSession?: (mode: string, init?: object) => Promise<XrSessionLike>
  }
} | null | undefined

export type XrSessionLike = {
  end?: () => Promise<void>
  addEventListener?: (type: string, listener: (...args: unknown[]) => void) => void
}

export type XrRendererLike = {
  xr?: {
    enabled?: boolean
    setReferenceSpaceType?: (type: string) => void
    setSession?: (session: XrSessionLike | null) => void | Promise<void>
  }
}

export function normalizeVrReferenceSpace(value: unknown): VrReferenceSpaceId {
  return value === 'local' ? 'local' : 'local-floor'
}

/**
 * Options passed to XRSession request + three's reference space.
 * Standing needs the local-floor optional feature. Seated uses the required local space.
 */
export function immersiveVrSessionInit(referenceSpace?: unknown): ImmersiveVrSessionInit {
  const space = normalizeVrReferenceSpace(referenceSpace)
  return {
    referenceSpace: space,
    optionalFeatures: space === 'local-floor' ? ['local-floor'] : [],
  }
}

function asXrNav(nav: unknown): XrLikeNavigator {
  return nav as XrLikeNavigator
}

/** Session-start guard: true only when immersive-vr is supported. */
export async function canStartImmersiveVr(
  nav: XrLikeNavigator = asXrNav(typeof navigator !== 'undefined' ? navigator : null),
): Promise<boolean> {
  if (!nav || !nav.xr || typeof nav.xr.isSessionSupported !== 'function') {
    return false
  }
  try {
    return !!(await nav.xr.isSessionSupported('immersive-vr'))
  } catch {
    return false
  }
}

export type StartImmersiveVrOpts = {
  navigator?: XrLikeNavigator
  referenceSpace?: unknown
}

export async function startImmersiveVrSession(
  renderer: XrRendererLike | null | undefined,
  opts: StartImmersiveVrOpts = {},
): Promise<XrSessionLike> {
  const nav =
    opts.navigator ?? asXrNav(typeof navigator !== 'undefined' ? navigator : null)
  const ok = await canStartImmersiveVr(nav)
  if (!ok) {
    const err = new Error('WebXR immersive-vr is not available') as Error & { code?: string }
    err.code = 'webxr_unavailable'
    throw err
  }
  if (!renderer) {
    const err = new Error('WebXR requires a WebGL renderer') as Error & { code?: string }
    err.code = 'webxr_no_renderer'
    throw err
  }
  if (!nav?.xr?.requestSession) {
    const err = new Error('WebXR immersive-vr is not available') as Error & { code?: string }
    err.code = 'webxr_unavailable'
    throw err
  }
  const init = immersiveVrSessionInit(opts.referenceSpace)
  if (renderer.xr && typeof renderer.xr.enabled !== 'undefined') {
    renderer.xr.enabled = true
  }
  if (renderer.xr && typeof renderer.xr.setReferenceSpaceType === 'function') {
    renderer.xr.setReferenceSpaceType(init.referenceSpace)
  }
  const session = await nav.xr.requestSession('immersive-vr', {
    optionalFeatures: init.optionalFeatures,
  })
  if (renderer.xr && typeof renderer.xr.setSession === 'function') {
    await renderer.xr.setSession(session)
  }
  return session
}

export async function stopImmersiveVrSession(
  session: XrSessionLike | null | undefined,
  renderer: XrRendererLike | null | undefined,
): Promise<void> {
  try {
    if (session && typeof session.end === 'function') {
      await session.end()
    }
  } catch {
    /* already ended */
  }
  if (renderer?.xr && typeof renderer.xr.setSession === 'function') {
    try {
      await renderer.xr.setSession(null)
    } catch {
      /* ignore */
    }
  }
}

export type VrSupportStatus = 'checking' | 'ready' | 'insecure' | 'unavailable' | 'imu_fallback'

export function vrSupportMessage(status: VrSupportStatus): string {
  switch (status) {
    case 'checking':
      return 'Checking whether this browser can start an immersive VR session…'
    case 'ready':
      return 'Immersive VR is available. Put the phone in the viewer, then enter.'
    case 'insecure':
      return 'This page is not a secure context. Motion sensors and WebXR only run on HTTPS or localhost.'
    case 'unavailable':
      return 'No WebXR immersive-vr session. Falling back to IMU stereo for smartphone VR glasses.'
    case 'imu_fallback':
      return 'WebXR is unsupported here — using phone gyroscope stereo (Cardboard-style).'
    default:
      return 'VR support has not been checked yet.'
  }
}

export type PhoneVrErrorCode =
  | 'insecure_context'
  | 'motion_permission_denied'
  | 'no_gyroscope'
  | 'webxr_unavailable'
  | 'stereo_failed'
  | 'tracking_stalled'
  /** The window never acquired a WebGL context, so stereo/immersive VR has no renderer. */
  | 'no_render_context'

export function phoneVrErrorMessage(code: PhoneVrErrorCode): string {
  switch (code) {
    case 'insecure_context':
      return 'Motion sensors need a secure page (HTTPS or localhost).'
    case 'motion_permission_denied':
      return 'Motion permission was denied. On iOS, allow orientation access when prompted, then try again.'
    case 'no_gyroscope':
      return 'No gyroscope / device orientation is available on this device.'
    case 'webxr_unavailable':
      return 'WebXR immersive-vr is not available; IMU stereo will be used instead.'
    case 'stereo_failed':
      return 'Could not start stereo VR. Staying in flat view.'
    case 'tracking_stalled':
      return 'Head tracking looks frozen — check that the phone is awake and motion access is allowed.'
    case 'no_render_context':
      return 'This window has no 3D render context, so VR cannot start here. Close other companion windows and try again.'
    default:
      return 'VR could not start.'
  }
}
