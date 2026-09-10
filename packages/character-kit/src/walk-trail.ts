import * as THREE from 'three'

export type WalkTrailOptions = {
  enabled: boolean
  /** CSS hex (`#fff`) or integer `0xffffff`. */
  color: string | number
  /** How long a trail segment stays visible before fully fading out. */
  durationSec: number
  /** Minimum distance (m) between recorded samples. */
  spacingM?: number
  /** Hard cap on stored samples. */
  maxPoints?: number
  /** Trail draw height above the floor plane. */
  heightY?: number
}

export const DEFAULT_WALK_TRAIL: Readonly<WalkTrailOptions> = {
  enabled: true,
  color: 0xffffff,
  durationSec: 5,
  spacingM: 0.08,
  maxPoints: 512,
  heightY: 0.03,
}

export function normalizeWalkTrailOptions(
  partial?: Partial<WalkTrailOptions> | null,
): WalkTrailOptions {
  const base = { ...DEFAULT_WALK_TRAIL, ...(partial ?? {}) }
  const durationSec = Number(base.durationSec)
  const spacingM = Number(base.spacingM ?? DEFAULT_WALK_TRAIL.spacingM)
  const maxPoints = Number(base.maxPoints ?? DEFAULT_WALK_TRAIL.maxPoints)
  const heightY = Number(base.heightY ?? DEFAULT_WALK_TRAIL.heightY)
  return {
    enabled: base.enabled !== false,
    color: base.color ?? DEFAULT_WALK_TRAIL.color,
    durationSec:
      Number.isFinite(durationSec) && durationSec > 0
        ? Math.min(60, durationSec)
        : DEFAULT_WALK_TRAIL.durationSec,
    spacingM:
      Number.isFinite(spacingM) && spacingM > 0
        ? Math.min(2, spacingM)
        : DEFAULT_WALK_TRAIL.spacingM,
    maxPoints:
      Number.isFinite(maxPoints) && maxPoints >= 2
        ? Math.min(4096, Math.floor(maxPoints))
        : DEFAULT_WALK_TRAIL.maxPoints,
    heightY: Number.isFinite(heightY) ? heightY : DEFAULT_WALK_TRAIL.heightY,
  }
}

export function parseWalkTrailColor(color: string | number): THREE.Color {
  if (typeof color === 'number' && Number.isFinite(color)) {
    return new THREE.Color(color >>> 0)
  }
  const raw = String(color ?? '').trim()
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(raw)) return new THREE.Color(raw)
  if (/^0x[0-9a-f]+$/i.test(raw)) return new THREE.Color(Number.parseInt(raw, 16))
  const named = raw.toLowerCase()
  if (named === 'white') return new THREE.Color(0xffffff)
  if (named === 'black') return new THREE.Color(0x000000)
  if (named === 'red') return new THREE.Color(0xff0000)
  if (named === 'cyan') return new THREE.Color(0x00ffff)
  return new THREE.Color(0xffffff)
}

type Sample = { x: number; z: number; t: number }

/**
 * Fading ground-plane polyline following locomotion. Samples while moving;
 * vertex brightness falls off over `durationSec`.
 */
export class WalkTrail {
  readonly object: THREE.Line
  private readonly geometry: THREE.BufferGeometry
  private readonly material: THREE.LineBasicMaterial
  private opts: WalkTrailOptions
  private samples: Sample[] = []
  private lastX = Number.NaN
  private lastZ = Number.NaN
  private readonly scratchColor = new THREE.Color()

  constructor(opts?: Partial<WalkTrailOptions>) {
    this.opts = normalizeWalkTrailOptions(opts)
    this.geometry = new THREE.BufferGeometry()
    this.material = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 1,
      depthWrite: false,
    })
    this.object = new THREE.Line(this.geometry, this.material)
    this.object.frustumCulled = false
    this.object.renderOrder = 2
    this.object.visible = this.opts.enabled
    this.rebuild(0)
  }

  getOptions(): WalkTrailOptions {
    return { ...this.opts }
  }

  setOptions(partial: Partial<WalkTrailOptions>): void {
    const next = normalizeWalkTrailOptions({ ...this.opts, ...partial })
    this.opts = next
    this.object.visible = next.enabled
    if (!next.enabled) {
      this.clear()
      return
    }
    this.rebuild(performance.now() / 1000)
  }

  clear(): void {
    this.samples = []
    this.lastX = Number.NaN
    this.lastZ = Number.NaN
    this.rebuild(0)
  }

  /**
   * Record a foot position when locomoting. Pass `moving=false` to only age/fade.
   */
  update(nowSec: number, x: number, z: number, moving: boolean): void {
    if (!this.opts.enabled) {
      if (this.samples.length) this.clear()
      return
    }

    const duration = this.opts.durationSec
    const cutoff = nowSec - duration
    if (this.samples.length && this.samples[0]!.t < cutoff) {
      this.samples = this.samples.filter((s) => s.t >= cutoff)
    }

    if (moving) {
      const spacing = this.opts.spacingM ?? DEFAULT_WALK_TRAIL.spacingM!
      const maxPoints = this.opts.maxPoints ?? DEFAULT_WALK_TRAIL.maxPoints!
      if (!Number.isFinite(this.lastX)) {
        this.samples.push({ x, z, t: nowSec })
        this.lastX = x
        this.lastZ = z
      } else {
        const dx = x - this.lastX
        const dz = z - this.lastZ
        if (dx * dx + dz * dz >= spacing * spacing) {
          this.samples.push({ x, z, t: nowSec })
          this.lastX = x
          this.lastZ = z
          if (this.samples.length > maxPoints) {
            this.samples.splice(0, this.samples.length - maxPoints)
          }
        }
      }
    }

    this.rebuild(nowSec)
  }

  dispose(): void {
    this.geometry.dispose()
    this.material.dispose()
  }

  private rebuild(nowSec: number): void {
    const n = this.samples.length
    const y = this.opts.heightY ?? DEFAULT_WALK_TRAIL.heightY!
    if (n < 2) {
      this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3))
      this.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(0), 3))
      this.geometry.setDrawRange(0, 0)
      return
    }

    const positions = new Float32Array(n * 3)
    const colors = new Float32Array(n * 3)
    this.scratchColor.copy(parseWalkTrailColor(this.opts.color))
    const duration = Math.max(1e-3, this.opts.durationSec)

    for (let i = 0; i < n; i++) {
      const s = this.samples[i]!
      const o = i * 3
      positions[o] = s.x
      positions[o + 1] = y
      positions[o + 2] = s.z
      const age = Math.max(0, nowSec - s.t)
      const alpha = Math.max(0, 1 - age / duration)
      colors[o] = this.scratchColor.r * alpha
      colors[o + 1] = this.scratchColor.g * alpha
      colors[o + 2] = this.scratchColor.b * alpha
    }

    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    this.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    this.geometry.setDrawRange(0, n)
    this.geometry.computeBoundingSphere()
  }
}
