import * as THREE from 'three'

const BAR_W = 0.52
const BAR_H = 0.045
const BAR_D = 0.02

/**
 * XR-safe 3D load progress bar (mesh, not CSS2D).
 * `0–1` determinate, `-1` indeterminate, `null` hide.
 */
export class LoadProgressBillboard {
  readonly root: THREE.Group
  private readonly trackMat: THREE.MeshBasicMaterial
  private readonly fillMat: THREE.MeshBasicMaterial
  private readonly fill: THREE.Mesh
  private loadRatio: number | null = null
  private displayRatio = 0
  private raf = 0
  private lastTick = 0

  constructor(color = 0x7eb8ff) {
    this.trackMat = new THREE.MeshBasicMaterial({
      color: 0x10151c,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    })
    this.fillMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    })
    const track = new THREE.Mesh(new THREE.BoxGeometry(BAR_W, BAR_H, BAR_D), this.trackMat)
    this.fill = new THREE.Mesh(
      new THREE.BoxGeometry(BAR_W, BAR_H * 0.55, BAR_D + 0.001),
      this.fillMat,
    )
    this.root = new THREE.Group()
    this.root.name = 'load-progress-billboard'
    this.root.visible = false
    this.root.add(track, this.fill)
    this.applyFill(0)
  }

  setColor(color: number): void {
    this.fillMat.color.setHex(color)
  }

  /**
   * `0–1` determinate, `-1` indeterminate (no Content-Length), `null` hide.
   */
  setLoadProgress(ratio: number | null): void {
    this.loadRatio = ratio
    if (ratio == null) {
      this.root.visible = false
      this.stopTick()
      return
    }
    this.fillMat.color.setHex(0x7eb8ff)
    this.root.visible = true
    if (ratio >= 0) this.displayRatio = Math.max(this.displayRatio, 0)
    this.startTick()
  }

  setLoadFailed(failed: boolean): void {
    if (failed) {
      this.fillMat.color.setHex(0xff6b6b)
      this.root.visible = true
      this.applyFill(1)
      this.stopTick()
    }
  }

  dispose(): void {
    this.stopTick()
    this.trackMat.dispose()
    this.fillMat.dispose()
    ;(this.fill.geometry as THREE.BufferGeometry).dispose()
    this.root.clear()
  }

  private startTick(): void {
    if (this.raf) return
    this.lastTick = performance.now()
    const tick = (now: number) => {
      this.raf = requestAnimationFrame(tick)
      const dt = Math.min(0.05, (now - this.lastTick) / 1000)
      this.lastTick = now
      if (this.loadRatio == null) return
      if (this.loadRatio < 0) {
        const t = (now / 600) % 1
        this.applyFill(0.15 + 0.35 * (0.5 + 0.5 * Math.sin(t * Math.PI * 2)))
        return
      }
      this.displayRatio += (this.loadRatio - this.displayRatio) * Math.min(1, dt * 8)
      this.applyFill(this.displayRatio)
      if (this.loadRatio >= 1 && this.displayRatio > 0.98) {
        this.setLoadProgress(null)
      }
    }
    this.raf = requestAnimationFrame(tick)
  }

  private stopTick(): void {
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
  }

  private applyFill(ratio: number): void {
    const r = Math.max(0.02, Math.min(1, ratio))
    this.fill.scale.x = r
    this.fill.position.x = -BAR_W / 2 + (BAR_W * r) / 2
  }
}

/** Map XHR progress to 0–1 or -1 indeterminate. */
export function assetLoadRatio(loaded: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) return -1
  if (!Number.isFinite(loaded) || loaded < 0) return 0
  return Math.max(0, Math.min(1, loaded / total))
}
