import * as THREE from 'three'
import { WalkTrail, type WalkTrailOptions } from './walk-trail.js'
import type { SceneObject } from './scene-registry.js'
import {
  applyStandInTransform,
  createStandInGeometry,
  createStandInMaterial,
  standInStyle,
} from './scene-fx-markers.js'

export type SceneGlowOpts = {
  color?: string | number
  durationMs?: number
  intensity?: number
}

export type SceneMoveOpts = {
  to: { x?: number; y?: number; z?: number }
  durationMs?: number
  smooth?: boolean
  trail?: boolean
  trailColor?: string | number
}

type GlowState = {
  mesh: THREE.Mesh
  mat: THREE.MeshStandardMaterial
  until: number
  baseEmissive: THREE.Color
}

type MoveState = {
  id: string
  mesh: THREE.Object3D
  from: THREE.Vector3
  to: THREE.Vector3
  start: number
  duration: number
  trail?: WalkTrail
}

type MeshMeta = {
  sceneObjectId: string
  label: string
  description: string
  standInStyle: string
}

function parseColor(color: string | number | undefined): THREE.Color {
  if (typeof color === 'number' && Number.isFinite(color)) return new THREE.Color(color >>> 0)
  const raw = String(color ?? '#66ccff').trim()
  try {
    return new THREE.Color(raw)
  } catch {
    return new THREE.Color(0x66ccff)
  }
}

function ensureTooltip(): HTMLDivElement {
  const el = document.createElement('div')
  el.className = 'scene-object-tooltip'
  el.setAttribute('role', 'tooltip')
  el.style.cssText = [
    'position:absolute',
    'display:none',
    'pointer-events:none',
    'z-index:6',
    'max-width:16rem',
    'padding:0.2rem 0.45rem',
    'border-radius:6px',
    'border:1px solid rgba(126,184,255,0.4)',
    'background:rgba(8,12,16,0.9)',
    'color:#e8eef6',
    'font-size:0.72rem',
    'line-height:1.3',
    'box-shadow:0 8px 20px rgba(0,0,0,0.4)',
    'backdrop-filter:blur(8px)',
  ].join(';')
  return el
}

/**
 * Visible stand-ins + glow/move FX for named scene objects (not avatars).
 * Landmarks/seats are floor decals so they stay behind the character.
 */
export class SceneObjectLayer {
  readonly group = new THREE.Group()
  private readonly meshes = new Map<string, THREE.Mesh>()
  private readonly glows = new Map<string, GlowState>()
  private readonly moves: MoveState[] = []
  private readonly raycaster = new THREE.Raycaster()
  private readonly ndc = new THREE.Vector2()
  private tooltip: HTMLDivElement | null = null
  private tooltipHost: HTMLElement | null = null
  private hoverCanvas: HTMLElement | null = null
  private hoverId: string | null = null
  private disposed = false

  constructor() {
    this.group.name = 'scene-object-layer'
  }

  sync(obj: SceneObject): THREE.Mesh {
    const style = standInStyle(obj.kind)
    let mesh = this.meshes.get(obj.id)
    const meta = mesh?.userData as MeshMeta | undefined
    if (mesh && meta?.standInStyle !== style) {
      this.remove(obj.id)
      mesh = undefined
    }
    if (!mesh) {
      const mat = createStandInMaterial(obj.kind, style)
      mesh = new THREE.Mesh(createStandInGeometry(style), mat)
      mesh.name = `scene-obj:${obj.id}`
      mesh.frustumCulled = false
      this.group.add(mesh)
      this.meshes.set(obj.id, mesh)
    }
    const next: MeshMeta = {
      sceneObjectId: obj.id,
      label: obj.label,
      description: obj.description ?? '',
      standInStyle: style,
    }
    mesh.userData = next
    applyStandInTransform(mesh, obj)
    return mesh
  }

  remove(id: string): void {
    const mesh = this.meshes.get(id)
    if (!mesh) return
    this.group.remove(mesh)
    mesh.geometry.dispose()
    const mat = mesh.material
    if (Array.isArray(mat)) for (const m of mat) m.dispose()
    else mat.dispose()
    this.meshes.delete(id)
    this.glows.delete(id)
    if (this.hoverId === id) this.clearHover()
  }

  glow(id: string, opts: SceneGlowOpts = {}): boolean {
    const mesh = this.meshes.get(id)
    if (!mesh || !mesh.visible) return false
    const mat = mesh.material
    if (!(mat instanceof THREE.MeshStandardMaterial)) return false
    const durationMs = Math.min(20_000, Math.max(200, opts.durationMs ?? 1800))
    const color = parseColor(opts.color)
    const intensity = Math.min(4, Math.max(0.2, opts.intensity ?? 1.2))
    if (!this.glows.has(id)) {
      this.glows.set(id, {
        mesh,
        mat,
        until: 0,
        baseEmissive: mat.emissive.clone(),
      })
    }
    const g = this.glows.get(id)!
    g.until = performance.now() + durationMs
    mat.emissive.copy(color)
    mat.emissiveIntensity = intensity
    return true
  }

  move(
    obj: SceneObject,
    opts: SceneMoveOpts,
    onUpdate: (id: string, pos: { x: number; y: number; z: number }) => void,
  ): boolean {
    const mesh = this.sync(obj)
    const duration = opts.smooth === false ? 1 : Math.min(12_000, Math.max(120, opts.durationMs ?? 900))
    const to = new THREE.Vector3(
      opts.to.x ?? obj.position.x,
      opts.to.y ?? obj.position.y,
      opts.to.z ?? obj.position.z,
    )
    const from = new THREE.Vector3(obj.position.x, obj.position.y, obj.position.z)
    let trail: WalkTrail | undefined
    if (opts.trail !== false) {
      const trailOpts: Partial<WalkTrailOptions> = {
        enabled: true,
        color: opts.trailColor ?? 0x88ddff,
        durationSec: Math.max(2, duration / 1000 + 1.5),
        heightY: 0.04,
      }
      trail = new WalkTrail(trailOpts)
      this.group.add(trail.object)
    }
    this.moves.push({
      id: obj.id,
      mesh,
      from,
      to,
      start: performance.now(),
      duration,
      trail,
    })
    if (duration <= 1) {
      onUpdate(obj.id, { x: to.x, y: to.y, z: to.z })
      applyStandInTransform(mesh, obj, to)
    }
    return true
  }

  hoverAt(camera: THREE.Camera, canvas: HTMLElement, clientX: number, clientY: number): void {
    if (this.disposed) return
    const rect = canvas.getBoundingClientRect()
    if (
      clientX < rect.left ||
      clientX > rect.right ||
      clientY < rect.top ||
      clientY > rect.bottom
    ) {
      this.clearHover()
      return
    }
    const w = rect.width || 1
    const h = rect.height || 1
    this.ndc.set(((clientX - rect.left) / w) * 2 - 1, -((clientY - rect.top) / h) * 2 + 1)
    this.raycaster.setFromCamera(this.ndc, camera)
    const hits = this.raycaster.intersectObjects([...this.meshes.values()].filter((m) => m.visible), false)
    const meta = hits[0]?.object.userData as MeshMeta | undefined
    if (!meta?.sceneObjectId) {
      this.clearHover()
      return
    }
    this.hoverId = meta.sceneObjectId
    const host = canvas.parentElement ?? canvas
    this.ensureTooltip(host)
    const tip = this.tooltip
    if (!tip || !this.tooltipHost) return
    const hostRect = this.tooltipHost.getBoundingClientRect()
    tip.innerHTML = ''
    const name = document.createElement('strong')
    name.textContent = meta.label
    name.style.display = 'block'
    tip.appendChild(name)
    if (meta.description) {
      const desc = document.createElement('span')
      desc.textContent = meta.description
      desc.style.opacity = '0.78'
      tip.appendChild(desc)
    }
    tip.style.display = 'block'
    const left = clientX - hostRect.left + 12
    const top = clientY - hostRect.top + 12
    tip.style.left = `${Math.min(left, Math.max(8, hostRect.width - 180))}px`
    tip.style.top = `${Math.min(top, Math.max(8, hostRect.height - 48))}px`
    this.hoverCanvas = canvas
    canvas.title = meta.description ? `${meta.label} — ${meta.description}` : meta.label
    canvas.style.cursor = 'help'
  }

  clearHover(): void {
    this.hoverId = null
    if (this.tooltip) this.tooltip.style.display = 'none'
    if (this.hoverCanvas) {
      this.hoverCanvas.title = ''
      this.hoverCanvas.style.cursor = ''
      this.hoverCanvas = null
    }
  }

  tick(nowMs: number, objects: Map<string, SceneObject>): void {
    if (this.disposed) return
    for (const [id, g] of [...this.glows]) {
      if (nowMs >= g.until) {
        g.mat.emissive.copy(g.baseEmissive)
        g.mat.emissiveIntensity = 1
        this.glows.delete(id)
      } else {
        const pulse = 0.65 + 0.35 * Math.sin(nowMs / 120)
        g.mat.emissiveIntensity = pulse
      }
    }

    const remaining: MoveState[] = []
    for (const mv of this.moves) {
      const obj = objects.get(mv.id)
      const t = Math.min(1, (nowMs - mv.start) / Math.max(1, mv.duration))
      const eased = t * t * (3 - 2 * t)
      const pos = mv.from.clone().lerp(mv.to, eased)
      if (obj) applyStandInTransform(mv.mesh, obj, pos)
      else mv.mesh.position.set(pos.x, pos.y, pos.z)
      mv.trail?.update(nowMs / 1000, pos.x, pos.z, t < 1)
      if (t < 1) remaining.push(mv)
      else {
        mv.trail?.dispose()
        if (mv.trail) this.group.remove(mv.trail.object)
      }
    }
    this.moves.splice(0, this.moves.length, ...remaining)
  }

  movingIds(): string[] {
    return this.moves.map((m) => m.id)
  }

  dispose(): void {
    this.disposed = true
    this.clearHover()
    this.tooltip?.remove()
    this.tooltip = null
    this.tooltipHost = null
    for (const id of [...this.meshes.keys()]) this.remove(id)
    for (const mv of this.moves) {
      mv.trail?.dispose()
      if (mv.trail) this.group.remove(mv.trail.object)
    }
    this.moves.length = 0
  }

  private ensureTooltip(host: HTMLElement): void {
    if (this.tooltip && this.tooltipHost === host) return
    this.tooltip?.remove()
    this.tooltipHost = host
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative'
    this.tooltip = ensureTooltip()
    host.appendChild(this.tooltip)
  }
}
