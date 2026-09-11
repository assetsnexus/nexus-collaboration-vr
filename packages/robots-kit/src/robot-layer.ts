import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { SceneEntity, SceneGraph } from '@nexus/scene-kit'
import {
  LoadProgressBillboard,
  assetLoadRatio,
  assertUrlAllowed,
  createPrimitiveMesh,
  disposeObject3D,
  type UrlPolicy,
  DEFAULT_URL_POLICY,
} from '@nexus/objects-kit'
import { normalizeRobotSpec } from './spec.ts'

type RobotEntry = {
  root: THREE.Group
  model: THREE.Object3D
  billboard: LoadProgressBillboard
  mixer?: THREE.AnimationMixer
  clips: Map<string, THREE.AnimationClip>
  bones: Map<string, THREE.Object3D>
}

/**
 * Thin robot visuals: glTF or capsule stand-in; joints applied when bones match.
 */
export class RobotSceneLayer {
  readonly group = new THREE.Group()
  private readonly entries = new Map<string, RobotEntry>()
  private readonly loader = new GLTFLoader()
  private urlPolicy: UrlPolicy
  private unsub: (() => void) | null = null
  private clock = new THREE.Clock()

  constructor(opts?: { urlPolicy?: UrlPolicy }) {
    this.group.name = 'robot-scene-layer'
    this.urlPolicy = opts?.urlPolicy ?? { ...DEFAULT_URL_POLICY }
  }

  setUrlPolicy(policy: UrlPolicy): void {
    this.urlPolicy = policy
  }

  attach(graph: SceneGraph): void {
    this.detach()
    for (const e of graph.list()) {
      if (e.kind === 'robot' || e.kind === 'machine') void this.syncEntity(e)
    }
    this.unsub = graph.subscribe((ev) => {
      if (ev.op.kind === 'remove' && ev.op.entityId) {
        this.removeVisual(ev.op.entityId)
        return
      }
      if (ev.entity && (ev.entity.kind === 'robot' || ev.entity.kind === 'machine')) {
        void this.syncEntity(ev.entity)
        if (ev.op.kind === 'play_effect') {
          const clip = String(ev.op.payload?.clip || '').replace(/^clip:/, '')
          if (clip) this.playClip(ev.entity.id, clip, ev.op.payload?.loop === true)
        }
      }
    })
  }

  detach(): void {
    this.unsub?.()
    this.unsub = null
    for (const id of [...this.entries.keys()]) this.removeVisual(id)
  }

  tick(): void {
    const dt = this.clock.getDelta()
    for (const entry of this.entries.values()) entry.mixer?.update(dt)
  }

  playClip(id: string, clipName: string, loop = false): boolean {
    const entry = this.entries.get(id)
    if (!entry?.mixer) return false
    const clip = entry.clips.get(clipName) || entry.clips.get(clipName.toLowerCase())
    if (!clip) return false
    const action = entry.mixer.clipAction(clip)
    action.reset()
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1)
    action.clampWhenFinished = !loop
    action.play()
    return true
  }

  private async syncEntity(entity: SceneEntity): Promise<void> {
    let entry = this.entries.get(entity.id)
    const spec = normalizeRobotSpec(entity.spec)
    if (!entry) {
      entry = this.createStandIn(entity, spec.color)
      this.entries.set(entity.id, entry)
      this.group.add(entry.root)
    }
    entry.root.position.set(entity.pose.x, entity.pose.y, entity.pose.z)
    entry.root.rotation.y = entity.pose.yaw

    if (spec.url) {
      await this.loadGltf(entity.id, entry, spec.url)
    }
    this.applyJoints(entry, spec.joints || [])
  }

  private createStandIn(entity: SceneEntity, color?: string): RobotEntry {
    const root = new THREE.Group()
    root.name = `robot-${entity.id}`
    const mesh = createPrimitiveMesh({
      shape: 'capsule',
      color: color || '#88aacc',
      radius: 0.2,
      size: { x: 0.4, y: 1.0, z: 0.4 },
    })
    mesh.userData.sceneEntityId = entity.id
    const billboard = new LoadProgressBillboard()
    billboard.root.position.y = 1.2
    root.add(mesh, billboard.root)
    return {
      root,
      model: mesh,
      billboard,
      clips: new Map(),
      bones: new Map(),
    }
  }

  private async loadGltf(entityId: string, entry: RobotEntry, url: string): Promise<void> {
    const allowed = assertUrlAllowed(url, this.urlPolicy)
    if (!allowed.ok) {
      entry.billboard.setLoadFailed(true)
      return
    }
    entry.billboard.setLoadProgress(0)
    try {
      const gltf = await this.loader.loadAsync(url, (ev) => {
        entry.billboard.setLoadProgress(assetLoadRatio(ev.loaded, ev.total))
      })
      entry.root.remove(entry.model)
      disposeObject3D(entry.model)
      const model = gltf.scene
      model.traverse((o) => {
        o.userData.sceneEntityId = entityId
        if ((o as THREE.Bone).isBone || o.type === 'Bone') {
          entry.bones.set(o.name, o)
        }
      })
      entry.model = model
      entry.root.add(model)
      entry.mixer = new THREE.AnimationMixer(model)
      entry.clips.clear()
      for (const clip of gltf.animations || []) {
        entry.clips.set(clip.name, clip)
        entry.clips.set(clip.name.toLowerCase(), clip)
      }
      entry.billboard.setLoadProgress(null)
    } catch {
      entry.billboard.setLoadFailed(true)
    }
  }

  private applyJoints(entry: RobotEntry, joints: Array<{ name: string; angle: number }>): void {
    for (const j of joints) {
      const bone = entry.bones.get(j.name)
      if (!bone) continue
      bone.rotation.x = j.angle
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
}
