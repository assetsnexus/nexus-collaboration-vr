/**
 * Phone / cardboard VR session controller for SceneRoom (and similar three canvases).
 * Prefer WebXR immersive-vr when available (Android Chrome Cardboard runtime);
 * otherwise IMU stereo via deviceorientation + StereoCamera + barrel distortion.
 */

import * as THREE from 'three'
import {
  applyYawRecenter,
  isOrientationStalled,
  orientationDeltaSignificant,
  orientationEulerRad,
  recenterYaw,
  type YawRecenterState,
} from './phone-vr-math.js'
import {
  defaultPhoneVrSettings,
  normalizePhoneVrSettings,
  resolveActiveViewer,
  type PhoneVrSettingsV1,
} from './viewer-profiles.js'
import { PhoneVrStereoRenderer } from './phone-vr-stereo.js'
import {
  canStartImmersiveVr,
  phoneVrErrorMessage,
  startImmersiveVrSession,
  stopImmersiveVrSession,
  vrSupportMessage,
  type PhoneVrErrorCode,
  type VrSupportStatus,
  type XrSessionLike,
} from './webxr-session.js'

export type PhoneVrMode = 'flat' | 'webxr' | 'imu_stereo'

export type PhoneVrStatus = {
  mode: PhoneVrMode
  active: boolean
  support: VrSupportStatus
  message: string
  errorCode: PhoneVrErrorCode | null
  errorMessage: string | null
  trackingStalled: boolean
  settings: PhoneVrSettingsV1
}

export type PhoneVrHost = {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  /** Null when the window could not acquire a WebGL context (VR is then unavailable). */
  renderer: THREE.WebGLRenderer | null
  /** Disable orbit / pointer look while VR is active. */
  setOrbitEnabled?: (enabled: boolean) => void
  setPointerLookEnabled?: (enabled: boolean) => void
  /** Hide CSS2D labels in stereo (they do not distort correctly). */
  setLabelsVisible?: (visible: boolean) => void
  onStatus?: (status: PhoneVrStatus) => void
  logger?: Pick<Console, 'info' | 'warn' | 'error'>
}

type DeviceOrientationCtor = {
  requestPermission?: () => Promise<'granted' | 'denied' | string>
}

function isSecure(): boolean {
  return typeof window === 'undefined' || window.isSecureContext !== false
}

function screenAngleDeg(): number {
  if (typeof screen !== 'undefined' && typeof screen.orientation?.angle === 'number') {
    return screen.orientation.angle
  }
  if (typeof window !== 'undefined' && typeof window.orientation === 'number') {
    return window.orientation
  }
  return 0
}

async function requestMotionPermission(): Promise<'granted' | 'denied' | 'unsupported'> {
  const DOE = (
    typeof DeviceOrientationEvent !== 'undefined' ? DeviceOrientationEvent : null
  ) as DeviceOrientationCtor | null
  if (DOE && typeof DOE.requestPermission === 'function') {
    try {
      const res = await DOE.requestPermission()
      return res === 'granted' ? 'granted' : 'denied'
    } catch {
      return 'denied'
    }
  }
  return 'unsupported'
}

function hasOrientationApi(): boolean {
  return typeof window !== 'undefined' && 'DeviceOrientationEvent' in window
}

export class PhoneVrController {
  private readonly host: PhoneVrHost
  private settings: PhoneVrSettingsV1
  private mode: PhoneVrMode = 'flat'
  private stereo: PhoneVrStereoRenderer | null = null
  private xrSession: XrSessionLike | null = null
  private recenter: YawRecenterState = { yawOffsetRad: 0 }
  private lastEuler: { yaw: number; pitch: number; roll: number } | null = null
  private lastChangeAtMs = 0
  private trackingStalled = false
  private errorCode: PhoneVrErrorCode | null = null
  private support: VrSupportStatus = 'checking'
  private savedFov = 50
  private onOrientation: ((ev: DeviceOrientationEvent) => void) | null = null
  private disposed = false
  /** Optional native shell hooks (orientation lock). */
  private shellHooks: {
    lockLandscape?: () => void
    unlockOrientation?: () => void
  } = {}

  constructor(host: PhoneVrHost, settings?: PhoneVrSettingsV1) {
    this.host = host
    this.settings = normalizePhoneVrSettings(settings ?? defaultPhoneVrSettings())
  }

  setShellHooks(hooks: PhoneVrController['shellHooks']): void {
    this.shellHooks = hooks
  }

  getStatus(): PhoneVrStatus {
    return {
      mode: this.mode,
      active: this.mode !== 'flat',
      support: this.support,
      message: this.statusMessage(),
      errorCode: this.errorCode,
      errorMessage: this.errorCode ? phoneVrErrorMessage(this.errorCode) : null,
      trackingStalled: this.trackingStalled,
      settings: { ...this.settings },
    }
  }

  getSettings(): PhoneVrSettingsV1 {
    return { ...this.settings }
  }

  updateSettings(partial: Partial<PhoneVrSettingsV1>): void {
    this.settings = normalizePhoneVrSettings({ ...this.settings, ...partial })
    this.applyViewerToStereo()
    this.emit()
  }

  async probeSupport(): Promise<PhoneVrStatus> {
    if (!isSecure()) {
      this.support = 'insecure'
      this.errorCode = 'insecure_context'
      this.emit()
      return this.getStatus()
    }
    this.support = 'checking'
    this.errorCode = null
    this.emit()
    const webxr = await canStartImmersiveVr()
    this.support = webxr ? 'ready' : 'imu_fallback'
    this.emit()
    return this.getStatus()
  }

  /**
   * Enter phone VR. Tries WebXR first; on failure uses IMU stereo and surfaces a real message.
   */
  async enter(): Promise<PhoneVrStatus> {
    if (this.disposed || this.mode !== 'flat') return this.getStatus()
    this.errorCode = null
    this.trackingStalled = false

    // No WebGL context survived acquisition in this window (GPU saturated by
    // other companion windows): there is nothing to render into, so fail with a
    // precise, actionable message instead of a null-deref deeper down.
    if (!this.host.renderer) {
      this.errorCode = 'no_render_context'
      this.emit()
      return this.getStatus()
    }

    if (!isSecure()) {
      this.errorCode = 'insecure_context'
      this.support = 'insecure'
      this.emit()
      return this.getStatus()
    }

    this.shellHooks.lockLandscape?.()

    // Try WebXR (Android Chrome Cardboard runtime) — same rails as portal play-webxr.
    try {
      const ok = await canStartImmersiveVr()
      if (ok) {
        const session = await startImmersiveVrSession(this.host.renderer as never, {
          referenceSpace: this.settings.referenceSpace,
        })
        this.xrSession = session
        if (session && typeof session.addEventListener === 'function') {
          session.addEventListener('end', () => {
            if (this.xrSession === session) {
              this.xrSession = null
              if (this.mode === 'webxr') void this.exitInternal(false)
            }
          })
        }
        this.mode = 'webxr'
        this.support = 'ready'
        this.host.setOrbitEnabled?.(false)
        this.host.setPointerLookEnabled?.(false)
        this.host.setLabelsVisible?.(false)
        this.host.logger?.info?.('[phone-vr] entered WebXR immersive-vr')
        this.emit()
        return this.getStatus()
      }
      this.support = 'imu_fallback'
      this.errorCode = 'webxr_unavailable'
    } catch (err) {
      this.support = 'imu_fallback'
      this.errorCode = 'webxr_unavailable'
      this.host.logger?.warn?.('[phone-vr] WebXR start failed; IMU stereo', err)
    }

    // IMU stereo fallback
    try {
      await this.startImuStereo()
    } catch (err) {
      const code = (err as { code?: PhoneVrErrorCode })?.code
      this.errorCode = code && code !== 'webxr_unavailable' ? code : 'stereo_failed'
      this.mode = 'flat'
      this.shellHooks.unlockOrientation?.()
      this.host.logger?.error?.('[phone-vr] stereo failed', err)
      this.emit()
      return this.getStatus()
    }
    this.emit()
    return this.getStatus()
  }

  async exit(): Promise<PhoneVrStatus> {
    return this.exitInternal(true)
  }

  recenterView(): void {
    if (this.lastEuler) {
      this.recenter = recenterYaw(this.lastEuler.yaw)
    } else {
      this.recenter = { yawOffsetRad: 0 }
    }
    this.host.logger?.info?.('[phone-vr] view recentered')
    this.emit()
  }

  /** Call from the host render loop when mode === 'imu_stereo'. Returns true if stereo rendered. */
  renderFrame(): boolean {
    if (this.mode !== 'imu_stereo' || !this.stereo) return false
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
    if (this.lastChangeAtMs > 0 && isOrientationStalled({ lastChangeAtMs: this.lastChangeAtMs, nowMs: now })) {
      if (!this.trackingStalled) {
        this.trackingStalled = true
        this.errorCode = 'tracking_stalled'
        this.emit()
      }
    }
    this.stereo.render(this.host.scene, this.host.camera)
    return true
  }

  /** Call on canvas resize while VR is active. */
  resize(width: number, height: number): void {
    this.stereo?.setSize(width, height)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    void this.exitInternal(true)
  }

  private async exitInternal(endXr: boolean): Promise<PhoneVrStatus> {
    this.detachOrientation()
    if (this.stereo) {
      this.stereo.dispose()
      this.stereo = null
    }
    if (endXr && this.xrSession) {
      const session = this.xrSession
      this.xrSession = null
      await stopImmersiveVrSession(session, this.host.renderer as never)
    } else {
      this.xrSession = null
    }
    this.host.camera.fov = this.savedFov
    this.host.camera.updateProjectionMatrix()
    this.host.setOrbitEnabled?.(true)
    this.host.setPointerLookEnabled?.(true)
    this.host.setLabelsVisible?.(true)
    this.shellHooks.unlockOrientation?.()
    this.mode = 'flat'
    this.trackingStalled = false
    if (this.errorCode === 'tracking_stalled') this.errorCode = null
    this.host.logger?.info?.('[phone-vr] exited')
    this.emit()
    return this.getStatus()
  }

  private async startImuStereo(): Promise<void> {
    const renderer = this.host.renderer
    if (!renderer) {
      const err = new Error(phoneVrErrorMessage('no_render_context')) as Error & {
        code: PhoneVrErrorCode
      }
      err.code = 'no_render_context'
      throw err
    }
    if (!hasOrientationApi()) {
      const err = new Error(phoneVrErrorMessage('no_gyroscope')) as Error & { code: PhoneVrErrorCode }
      err.code = 'no_gyroscope'
      throw err
    }
    const perm = await requestMotionPermission()
    if (perm === 'denied') {
      const err = new Error(phoneVrErrorMessage('motion_permission_denied')) as Error & {
        code: PhoneVrErrorCode
      }
      err.code = 'motion_permission_denied'
      throw err
    }

    const viewer = resolveActiveViewer(this.settings)
    this.savedFov = this.host.camera.fov
    this.host.camera.fov = viewer.fovDeg
    this.host.camera.updateProjectionMatrix()

    this.stereo = new PhoneVrStereoRenderer(renderer, {
      ipdM: viewer.ipdM,
      distortion: viewer.distortion,
      distortionScale: 1,
    })
    const canvas = renderer.domElement
    this.stereo.setSize(canvas.clientWidth || canvas.width, canvas.clientHeight || canvas.height)

    this.host.setOrbitEnabled?.(false)
    this.host.setPointerLookEnabled?.(false)
    this.host.setLabelsVisible?.(false)

    this.lastChangeAtMs = typeof performance !== 'undefined' ? performance.now() : Date.now()
    this.attachOrientation()
    this.mode = 'imu_stereo'
    this.host.logger?.info?.('[phone-vr] entered IMU stereo', viewer.profile.id)
  }

  private applyViewerToStereo(): void {
    if (!this.stereo) return
    const viewer = resolveActiveViewer(this.settings)
    this.stereo.setEyeSeparation(viewer.ipdM)
    this.stereo.setDistortion(viewer.distortion, 1)
    if (this.mode === 'imu_stereo') {
      this.host.camera.fov = viewer.fovDeg
      this.host.camera.updateProjectionMatrix()
    }
  }

  private attachOrientation(): void {
    this.detachOrientation()
    this.onOrientation = (ev: DeviceOrientationEvent) => {
      const euler = orientationEulerRad({
        alpha: ev.alpha,
        beta: ev.beta,
        gamma: ev.gamma,
        screenAngleDeg: screenAngleDeg(),
      })
      if (!euler) return
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
      if (this.lastEuler && orientationDeltaSignificant(this.lastEuler, euler)) {
        this.lastChangeAtMs = now
        if (this.trackingStalled) {
          this.trackingStalled = false
          if (this.errorCode === 'tracking_stalled') this.errorCode = null
          this.emit()
        }
      } else if (!this.lastEuler) {
        this.lastChangeAtMs = now
        this.recenter = recenterYaw(euler.yaw)
      }
      this.lastEuler = euler
      const yaw = applyYawRecenter(euler.yaw, this.recenter)
      const pitch = euler.pitch
      // Keep camera world position; replace orientation from head pose.
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'))
      this.host.camera.quaternion.copy(q)
    }
    window.addEventListener('deviceorientation', this.onOrientation, true)
  }

  private detachOrientation(): void {
    if (this.onOrientation) {
      window.removeEventListener('deviceorientation', this.onOrientation, true)
      this.onOrientation = null
    }
  }

  private statusMessage(): string {
    if (this.errorCode === 'tracking_stalled') return phoneVrErrorMessage('tracking_stalled')
    if (this.mode === 'webxr') return 'WebXR session active.'
    if (this.mode === 'imu_stereo') {
      return this.errorCode === 'webxr_unavailable'
        ? vrSupportMessage('imu_fallback')
        : 'Phone VR stereo active (gyroscope).'
    }
    return vrSupportMessage(this.support)
  }

  private emit(): void {
    this.host.onStatus?.(this.getStatus())
  }
}
