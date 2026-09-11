import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { SceneEntity, SceneGraph, SceneGraphListener } from '@nexus/scene-kit'
import { normalizeObjectSpec, type ObjectCatalogEntry, type ObjectSpecV1 } from './spec.ts'
import { assertUrlAllowed, type UrlPolicy, DEFAULT_URL_POLICY } from './url-policy.ts'
import { createPrimitiveMesh, disposeObject3D } from './mesh.ts'
import { createDeskMesh, isDeskCatalogId } from './furniture.ts'
import { LoadProgressBillboard, assetLoadRatio } from './load-billboard.ts'
import {
  BUILTIN_EFFECTS,
  normalizeEffectClip,
  resolveEffectClip,
  type EffectClip,
} from './effects.ts'

type MeshEntry = {
  root: THREE.Group
  mesh: THREE.Object3D
  billboard: LoadProgressBillboard
  highlight?: THREE.Mesh
  baseScale: THREE.Vector3
  baseEmissive: THREE.Color
  effects: Map<string, { until: number; clip: EffectClip }>
}

export type ObjectLayerOptions = {
  catalog?: ObjectCatalogEntry[]
  urlPolicy?: UrlPolicy
  logger?: Pick<Console, 'warn' | 'error' | 'info'>
}

/**
 * Three.js subscriber for SceneGraph object entities.
 * Does not own the graph — applies visual updates from ops.
 */
export class ObjectSceneLayer {
  readonly group = new THREE.Group()
  private readonly entries = new Map<string, MeshEntry>()
  private readonly customEffects = new Map<string, EffectClip>()
  private catalog: ObjectCatalogEntry[]
  private urlPolicy: UrlPolicy
  private readonly loader = new GLTFLoader()
  private readonly log: Pick<Console, 'warn' | 'error' | 'info'>
  private selectedId: string | null = null
  private unsub: (() => void) | null = null
  private graph: SceneGraph | null = null

  constructor(opts?: ObjectLayerOptions) {
    this.group.name = 'object-scene-layer'
    this.catalog = opts?.catalog ? [...opts.catalog] : []
    this.urlPolicy = opts?.urlPolicy ?? { ...DEFAULT_URL_POLICY }
    this.log = opts?.logger ?? console
  }

  setCatalog(entries: ObjectCatalogEntry[]): void {
    this.catalog = [...entries]
  }

  getCatalog(): ObjectCatalogEntry[] {
    return [...this.catalog]
  }

  setUrlPolicy(policy: UrlPolicy): void {
    this.urlPolicy = policy
  }

  defineEffect(clip: EffectClip): void {
    this.customEffects.set(clip.id.toLowerCase(), clip)
  }

  attach(graph: SceneGraph): void {
    this.detach()
    this.graph = graph
    for (const e of graph.list()) {
      if (e.kind === 'object' || e.kind === 'fx') void this.syncEntity(e)
    }
    this.unsub = graph.subscribe((ev) => {
      if (ev.op.kind === 'remove' && ev.op.entityId) {
        this.removeVisual(ev.op.entityId)
        return
      }
      if (ev.entity && (ev.entity.kind === 'object' || ev.entity.kind === 'fx')) {
        void this.syncEntity(ev.entity)
        if (ev.op.kind === 'play_effect') {
          const effect = String(ev.op.payload?.effect || '')
          this.playEffect(ev.entity.id, effect, ev.op.payload)
        }
        if (ev.op.kind === 'stop_effect') {
          this.stopEffect(ev.entity.id, String(ev.op.payload?.effect || ''))
        }
      }
    })
  }

  detach(): void {
    this.unsub?.()
    this.unsub = null
    this.graph = null
    for (const id of [...this.entries.keys()]) this.removeVisual(id)
  }

  setSelected(id: string | null): void {
    this.selectedId = id
    for (const [eid, entry] of this.entries) {
      if (entry.highlight) entry.highlight.visible = eid === id
    }
  }

  getSelected(): string | null {
    return this.selectedId
  }

  /** Raycast pick against object meshes. */
  pick(raycaster: THREE.Raycaster): string | null {
    const meshes: THREE.Object3D[] = []
    for (const entry of this.entries.values()) meshes.push(entry.mesh)
    const hits = raycaster.intersectObjects(meshes, true)
    if (!hits.length) return null
    let obj: THREE.Object3D | null = hits[0]!.object
    while (obj) {
      const id = obj.userData?.sceneEntityId
      if (typeof id === 'string') return id
      obj = obj.parent
    }
    return null
  }

  tick(now = performance.now()): void {
    for (const entry of this.entries.values()) {
      for (const [effectId, state] of [...entry.effects]) {
        if (state.until > 0 && now > state.until) {
          entry.effects.delete(effectId)
          this.resetVisual(entry)
          continue
        }
        this.applyEffectFrame(entry, state.clip, now)
      }
    }
  }

  playEffect(entityId: string, effectId: string, payload?: Record<string, unknown>): boolean {
    const entry = this.entries.get(entityId)
    if (!entry) return false
    const clip =
      resolveEffectClip(effectId, Object.fromEntries(this.customEffects)) ||
      normalizeEffectClip({ id: effectId, ops: payload?.ops })
    if (!clip) return false
    const duration =
      Number(payload?.durationMs) ||
      clip.ops.reduce((m, op) => Math.max(m, Number((op as { durationMs?: number }).durationMs) || 0), 0) ||
      1800
    const loop = clip.ops.some((op) => 'loop' in op && op.loop)
    entry.effects.set(clip.id, {
      clip,
      until: loop ? 0 : performance.now() + duration,
    })
    if (payload?.color && clip.ops[0]?.op === 'glow') {
      const mat = this.primaryMaterial(entry)
      if (mat) {
        try {
          mat.emissive.set(String(payload.color))
          mat.emissiveIntensity = Number(payload.intensity) || 1.2
        } catch {
          /* ignore */
        }
      }
    }
    return true
  }

  stopEffect(entityId: string, effectId?: string): void {
    const entry = this.entries.get(entityId)
    if (!entry) return
    if (!effectId) entry.effects.clear()
    else entry.effects.delete(effectId.toLowerCase())
    this.resetVisual(entry)
  }

  private async syncEntity(entity: SceneEntity): Promise<void> {
    let entry = this.entries.get(entity.id)
    if (!entry) {
      entry = this.createEntry(entity)
      this.entries.set(entity.id, entry)
      this.group.add(entry.root)
    }
    entry.root.position.set(entity.pose.x, entity.pose.y, entity.pose.z)
    entry.root.rotation.y = entity.pose.yaw
    entry.root.userData.sceneEntityId = entity.id
    entry.mesh.userData.sceneEntityId = entity.id

    const spec = this.resolveSpec(entity)
    if (spec.url) {
      await this.loadUrlMesh(entity.id, entry, spec)
    } else if (isDeskCatalogId(spec.catalogId)) {
      this.replaceMesh(
        entry,
        createDeskMesh({
          color: spec.color,
          width: spec.size?.x,
          height: spec.size?.y,
          depth: spec.size?.z,
        }),
        entity.id,
      )
    } else {
      this.replaceMesh(entry, createPrimitiveMesh(spec), entity.id)
    }
    if (this.selectedId === entity.id && entry.highlight) entry.highlight.visible = true
  }

  private resolveSpec(entity: SceneEntity): ObjectSpecV1 {
    const fromEntity = normalizeObjectSpec(entity.spec)
    if (fromEntity.catalogId) {
      const cat = this.catalog.find((c) => c.id === fromEntity.catalogId)
      if (cat?.spec) return { ...normalizeObjectSpec(cat.spec), ...fromEntity, url: fromEntity.url || cat.url }
      if (cat?.url) return { ...fromEntity, url: fromEntity.url || cat.url }
    }
    return fromEntity
  }

  private createEntry(entity: SceneEntity): MeshEntry {
    const root = new THREE.Group()
    root.name = `entity-${entity.id}`
    const spec = this.resolveSpec(entity)
    const mesh = isDeskCatalogId(spec.catalogId)
      ? createDeskMesh({
          color: spec.color,
          width: spec.size?.x,
          height: spec.size?.y,
          depth: spec.size?.z,
        })
      : createPrimitiveMesh(spec)
    mesh.userData.sceneEntityId = entity.id
    const billboard = new LoadProgressBillboard()
    const deskH = isDeskCatalogId(spec.catalogId) ? (spec.size?.y ?? 0.74) : 0
    billboard.root.position.y = Math.max(0.4, deskH + 0.25, (entity.radius || 0.15) * 2 + 0.2)
    const ringR = Math.max(0.22, (entity.radius || 0.15) * 0.55)
    const highlight = new THREE.Mesh(
      new THREE.RingGeometry(ringR * 0.85, ringR, 32),
      new THREE.MeshBasicMaterial({
        color: 0xffdd66,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    )
    highlight.rotation.x = -Math.PI / 2
    highlight.position.y = 0.02
    highlight.visible = false
    root.add(mesh, billboard.root, highlight)
    const tempEntry: MeshEntry = {
      root,
      mesh,
      billboard,
      highlight,
      baseScale: mesh.scale.clone(),
      baseEmissive: new THREE.Color(0),
      effects: new Map(),
    }
    const mat = this.primaryMaterial(tempEntry)
    if (mat?.emissive) tempEntry.baseEmissive = mat.emissive.clone()
    return tempEntry
  }

  private replaceMesh(entry: MeshEntry, next: THREE.Object3D, entityId: string): void {
    entry.root.remove(entry.mesh)
    disposeObject3D(entry.mesh)
    next.userData.sceneEntityId = entityId
    entry.mesh = next
    entry.baseScale = next.scale.clone()
    entry.root.add(next)
    // keep billboard + highlight on top
    entry.root.add(entry.billboard.root)
    if (entry.highlight) entry.root.add(entry.highlight)
  }

  private async loadUrlMesh(entityId: string, entry: MeshEntry, spec: ObjectSpecV1): Promise<void> {
    const url = spec.url!
    const allowed = assertUrlAllowed(url, this.urlPolicy)
    if (!allowed.ok) {
      this.log.warn('[objects-kit] url blocked', url, allowed.reason)
      entry.billboard.setLoadFailed(true)
      return
    }
    entry.billboard.setLoadProgress(0)
    try {
      const gltf = await this.loader.loadAsync(url, (ev) => {
        entry.billboard.setLoadProgress(assetLoadRatio(ev.loaded, ev.total))
      })
      const model = gltf.scene
      model.traverse((o) => {
        o.userData.sceneEntityId = entityId
      })
      this.replaceMesh(entry, model, entityId)
      entry.billboard.setLoadProgress(null)
    } catch (err) {
      this.log.error('[objects-kit] load failed', url, err)
      entry.billboard.setLoadFailed(true)
    }
  }

  private removeVisual(id: string): void {
    const entry = this.entries.get(id)
    if (!entry) return
    this.group.remove(entry.root)
    entry.billboard.dispose()
    disposeObject3D(entry.root)
    this.entries.delete(id)
  }

  private primaryMaterial(entry: MeshEntry): THREE.MeshStandardMaterial | null {
    let found: THREE.MeshStandardMaterial | null = null
    entry.mesh.traverse((o) => {
      if (found) return
      const m = o as THREE.Mesh
      if (!m.isMesh) return
      const mat = Array.isArray(m.material) ? m.material[0] : m.material
      if (mat && (mat as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
        found = mat as THREE.MeshStandardMaterial
      }
    })
    return found
  }

  private resetVisual(entry: MeshEntry): void {
    entry.mesh.scale.copy(entry.baseScale)
    const mat = this.primaryMaterial(entry)
    if (mat) {
      mat.emissive.copy(entry.baseEmissive)
      mat.emissiveIntensity = entry.baseEmissive.getHex() ? 0.4 : 0
      mat.opacity = 1
      mat.transparent = false
    }
  }

  private applyEffectFrame(entry: MeshEntry, clip: EffectClip, now: number): void {
    for (const op of clip.ops) {
      if (op.op === 'spin') {
        entry.mesh.rotation.y += (op.speed || 2) * 0.016
      } else if (op.op === 'pulse') {
        const t = (now / (op.durationMs || 900)) * Math.PI * 2
        const s = 1 + ((op.scale || 1.2) - 1) * (0.5 + 0.5 * Math.sin(t))
        entry.mesh.scale.setScalar(s)
      } else if (op.op === 'bob') {
        const t = (now / (op.durationMs || 1200)) * Math.PI * 2
        entry.mesh.position.y = (op.amplitude || 0.08) * Math.sin(t)
      } else if (op.op === 'glow') {
        const mat = this.primaryMaterial(entry)
        if (mat) {
          try {
            if (op.color) mat.emissive.set(op.color)
            mat.emissiveIntensity = op.intensity || 1.2
          } catch {
            /* ignore */
          }
        }
      } else if (op.op === 'fade') {
        const mat = this.primaryMaterial(entry)
        if (mat) {
          mat.transparent = true
          mat.opacity = op.opacity ?? 0.3
        }
      } else if (op.op === 'blink') {
        entry.mesh.visible = Math.floor(now / 100) % 2 === 0
      }
    }
  }
}

export { BUILTIN_EFFECTS }
