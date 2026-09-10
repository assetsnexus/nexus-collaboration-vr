import * as THREE from 'three'

const BODY_H = 1.15
const HEAD_Y = 1.42
const BAR_Y = HEAD_Y + 0.32
const BAR_W = 0.52
const BAR_H = 0.045
const BAR_D = 0.02

/**
 * Lightweight floor-ring + ghost silhouette shown while a VRM is missing or loading.
 */
export class StandInMarker {
  readonly root: THREE.Group
  private readonly floorMat: THREE.MeshBasicMaterial
  private readonly bodyMat: THREE.MeshBasicMaterial
  private readonly headMat: THREE.MeshBasicMaterial
  private readonly trackMat: THREE.MeshBasicMaterial
  private readonly fillMat: THREE.MeshBasicMaterial
  private readonly floorRing: THREE.Mesh
  private readonly body: THREE.Mesh
  private readonly head: THREE.Mesh
  private readonly bar: THREE.Group
  private readonly fill: THREE.Mesh
  private occupied = false
  private loadFailed = false
  /** Target 0–1, or -1 for indeterminate. null hides the bar. */
  private loadRatio: number | null = null
  private displayRatio = 0
  private raf = 0
  private lastTick = 0
  private readonly color = new THREE.Color()

  constructor(color = 0x7eb8ff) {
    this.color.setHex(color)
    this.floorMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
    this.bodyMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
    })
    this.headMat = this.bodyMat.clone()
    this.floorRing = new THREE.Mesh(new THREE.RingGeometry(0.26, 0.36, 48), this.floorMat)
    this.floorRing.rotation.x = -Math.PI / 2
    this.floorRing.position.y = 0.02
    this.body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, BODY_H, 18), this.bodyMat)
    this.body.position.y = BODY_H / 2 + 0.08
    this.head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), this.headMat)
    this.head.position.y = HEAD_Y

    this.trackMat = new THREE.MeshBasicMaterial({
      color: 0x10151c,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    })
    this.fillMat = new THREE.MeshBasicMaterial({
      color: 0x7eb8ff,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    })
    const track = new THREE.Mesh(new THREE.BoxGeometry(BAR_W, BAR_H, BAR_D), this.trackMat)
    this.fill = new THREE.Mesh(new THREE.BoxGeometry(BAR_W, BAR_H * 0.55, BAR_D + 0.001), this.fillMat)
    this.bar = new THREE.Group()
    this.bar.name = 'stand-in-progress'
    this.bar.position.y = BAR_Y
    this.bar.visible = false
    this.bar.add(track, this.fill)

    this.root = new THREE.Group()
    this.root.name = 'stand-in'
    this.root.add(this.floorRing, this.body, this.head, this.bar)
    this.applyFill(0)
  }

  setColor(color: number): void {
    this.color.setHex(color)
    this.applyStatusTint()
  }

  /** VRM is present: keep a faint floor mark, hide the ghost body. */
  setOccupied(occupied: boolean): void {
    this.occupied = occupied
    this.body.visible = !occupied
    this.head.visible = !occupied
    this.floorMat.opacity = occupied ? 0.28 : 0.9
    if (occupied) this.setLoadProgress(null)
  }

  setVisible(visible: boolean): void {
    this.root.visible = visible
  }

  /**
   * `0–1` determinate, `-1` indeterminate (no Content-Length), `null` hide.
   */
  setLoadProgress(ratio: number | null): void {
    this.loadRatio = ratio
    if (ratio == null) {
      this.bar.visible = false
      this.stopTick()
      return
    }
    this.loadFailed = false
    this.applyStatusTint()
    this.bar.visible = !this.occupied
    if (ratio >= 0) this.displayRatio = Math.max(this.displayRatio, 0)
    this.startTick()
  }

  setLoadFailed(failed: boolean): void {
    this.loadFailed = failed
    if (failed) this.setLoadProgress(null)
    this.applyStatusTint()
  }

  placeAt(x: number, z: number): void {
    this.root.position.set(x, 0, z)
  }

  dispose(): void {
    this.stopTick()
    this.root.parent?.remove(this.root)
    this.floorRing.geometry.dispose()
    this.body.geometry.dispose()
    this.head.geometry.dispose()
    this.fill.geometry.dispose()
    ;(this.bar.children[0] as THREE.Mesh | undefined)?.geometry.dispose()
    this.floorMat.dispose()
    this.bodyMat.dispose()
    this.headMat.dispose()
    this.trackMat.dispose()
    this.fillMat.dispose()
  }

  private applyStatusTint(): void {
    const tint = this.color.clone()
    if (this.loadFailed) tint.lerp(new THREE.Color(0xe85d5d), 0.55)
    this.floorMat.color.copy(tint)
    this.bodyMat.color.copy(tint)
    this.headMat.color.copy(tint)
    this.fillMat.color.copy(this.loadFailed ? tint : new THREE.Color(0x9fd0ff))
  }

  private applyFill(p: number): void {
    const w = THREE.MathUtils.clamp(p, 0.02, 1)
    this.fill.scale.set(w, 1, 1)
    this.fill.position.x = -BAR_W / 2 + (BAR_W * w) / 2
  }

  private startTick(): void {
    if (this.raf) return
    this.lastTick = performance.now()
    const loop = (now: number) => {
      this.raf = 0
      if (this.loadRatio == null || !this.bar.visible) return
      const dt = Math.min(0.08, Math.max(0, (now - this.lastTick) / 1000))
      this.lastTick = now
      if (this.loadRatio < 0) {
        const t = now / 650
        const pip = 0.22
        const travel = (Math.sin(t) * 0.5 + 0.5) * (1 - pip)
        this.fill.scale.set(pip, 1, 1)
        this.fill.position.x = -BAR_W / 2 + BAR_W * travel + (BAR_W * pip) / 2
      } else {
        const k = 1 - Math.exp(-14 * dt)
        this.displayRatio += (this.loadRatio - this.displayRatio) * k
        this.applyFill(this.displayRatio)
      }
      this.raf = requestAnimationFrame(loop)
    }
    this.raf = requestAnimationFrame(loop)
  }

  private stopTick(): void {
    if (!this.raf) return
    cancelAnimationFrame(this.raf)
    this.raf = 0
  }
}
