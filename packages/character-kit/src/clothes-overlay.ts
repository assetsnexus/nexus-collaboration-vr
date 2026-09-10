import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import {
  VRMLoaderPlugin,
  VRMSpringBoneManager,
  VRMUtils,
  type VRM,
  type VRMSpringBoneJoint,
} from '@pixiv/three-vrm'
import {
  applyClothesPieceTransform,
  captureClothesBindPose,
  cloneClothesItemMeshes,
  collectClothesSlots,
  finalizeClothesSkinBind,
  listClothesItems,
  type ClothesSlot,
} from './clothes.js'
import type { ClothesItem } from './clothes-parse.js'
import type { ClothesOverlayPiece } from './clothes-transform.js'
import { loadCachedGltf } from './asset-cache.js'
import {
  collectBonesByName,
  graftMissingClothesBones,
  releaseOverlayGrafts,
} from './clothes-graft.js'

interface DonorPack {
  url: string
  vrm: VRM
  slots: ClothesSlot[]
  items: ClothesItem[]
}

/**
 * Loads overlay VRMs once and clones selected clothing meshes onto a host avatar.
 */
export class ClothesOverlayCache {
  private packs = new Map<string, DonorPack>()
  private inflight = new Map<string, Promise<DonorPack>>()
  private graftedBones: THREE.Bone[] = []
  private overlayJoints: VRMSpringBoneJoint[] = []
  private host: VRM | null = null
  private extraSprings: VRMSpringBoneManager | null = null

  async ensure(url: string): Promise<DonorPack> {
    const hit = this.packs.get(url)
    if (hit) return hit
    const pending = this.inflight.get(url)
    if (pending) return pending
    const job = this.load(url)
    this.inflight.set(url, job)
    try {
      const pack = await job
      this.packs.set(url, pack)
      return pack
    } finally {
      this.inflight.delete(url)
    }
  }

  async listItems(url: string): Promise<ClothesItem[]> {
    const pack = await this.ensure(url)
    return pack.items
  }

  /** Drop grafted accessory bones and copied spring joints from the host. */
  releaseHost(host?: VRM | null): void {
    const target = host ?? this.host
    const manager = target?.springBoneManager ?? this.extraSprings
    if (manager) {
      for (const joint of this.overlayJoints) manager.deleteJoint(joint)
    }
    releaseOverlayGrafts(null, [], this.graftedBones)
    this.overlayJoints = []
    this.graftedBones = []
    this.host = null
    this.extraSprings = null
  }

  async buildOverlayGroup(
    host: VRM,
    pieces: ClothesOverlayPiece[],
  ): Promise<{
    group: THREE.Group
    bound: number
    missing: string[]
    skipped: string[]
    grafted: string[]
  }> {
    this.releaseHost(this.host ?? host)
    this.host = host
    const group = new THREE.Group()
    group.name = 'clothes-overlay'
    let bound = 0
    const missing: string[] = []
    const skipped: string[] = []
    const boneIndex = collectBonesByName(host.scene)
    const donors = new Map<string, DonorPack>()
    const graftedNames = new Set<string>()

    for (const piece of pieces) {
      if (!piece.sourceUrl || !piece.itemId) {
        skipped.push(piece.itemId || '(empty)')
        continue
      }
      let pack: DonorPack
      try {
        pack = await this.ensure(piece.sourceUrl)
      } catch (err) {
        skipped.push(piece.itemId)
        console.error('[character-kit] overlay donor failed', piece.sourceUrl, err)
        continue
      }
      donors.set(pack.url, pack)
      const known = pack.items.some((i) => i.id === piece.itemId || i.category === piece.itemId)
      if (!known) {
        skipped.push(piece.itemId)
        console.warn('[character-kit] overlay item missing', piece.sourceUrl, piece.itemId)
        continue
      }
      const clones = cloneClothesItemMeshes(pack.slots, piece.itemId)
      if (!clones.length) {
        skipped.push(piece.itemId)
        continue
      }
      for (const mesh of clones) {
        const result = graftMissingClothesBones(mesh, host, boneIndex)
        bound += result.bound
        missing.push(...result.missing)
        for (const bone of result.grafted) {
          this.graftedBones.push(bone)
          graftedNames.add(bone.name)
        }
        captureClothesBindPose(mesh)
        mesh.userData.clothesOverlay = {
          sourceId: piece.sourceId,
          itemId: piece.itemId,
        }
        group.add(mesh)
      }
    }

    host.scene.updateMatrixWorld(true)
    // Rigid pin: do not copy donor spring joints onto grafted accessory bones.
    // World-space springs fight locomotion yaw and make ears/etc. drift opposite
    // the body. Bounce can return later with a locomotion-aware center.
    console.info('[character-kit] overlay bones grafted', {
      grafted: [...graftedNames],
      springs: 0,
    })
    return { group, bound, missing, skipped, grafted: [...graftedNames] }
  }

  /** Advance fallback spring simulation when the host VRM has no spring manager. */
  update(delta: number): void {
    this.extraSprings?.update(delta)
  }

  /** Call after the overlay group is parented to the host VRM (rest pose). */
  sealBinds(root: THREE.Object3D, _moveRoot?: THREE.Object3D): void {
    root.updateMatrixWorld(true)
    let sealed = 0
    root.traverse((obj) => {
      if (!obj.userData.clothesOverlay) return
      finalizeClothesSkinBind(obj)
      sealed += 1
    })
    console.info('[character-kit] overlay skin binds attached', { sealed })
  }

  /** Attached bindMode — nothing to refresh per frame. */
  refreshBinds(_root: THREE.Object3D | null): void {}

  applyTransforms(root: THREE.Object3D, pieces: ClothesOverlayPiece[], _moveRoot?: THREE.Object3D): void {
    const byKey = new Map(
      pieces.map((p) => [`${p.sourceId}::${p.itemId}`, p] as const),
    )
    root.traverse((obj) => {
      const tag = obj.userData.clothesOverlay as
        | { sourceId?: string; itemId?: string }
        | undefined
      if (!tag?.sourceId || !tag.itemId) return
      const piece = byKey.get(`${tag.sourceId}::${tag.itemId}`)
      if (!piece) return
      applyClothesPieceTransform(obj, piece.transform)
      finalizeClothesSkinBind(obj)
    })
  }

  dispose(): void {
    this.releaseHost(this.host)
    for (const pack of this.packs.values()) {
      VRMUtils.deepDispose(pack.vrm.scene)
    }
    this.packs.clear()
    this.inflight.clear()
  }

  private async load(url: string): Promise<DonorPack> {
    const loader = new GLTFLoader()
    loader.register((parser) => new VRMLoaderPlugin(parser))
    const gltf = await loadCachedGltf(loader, url)
    const vrm = gltf.userData.vrm as VRM | undefined
    if (!vrm) {
      VRMUtils.deepDispose(gltf.scene)
      throw new Error(`No VRM in overlay ${url}`)
    }
    const slots = collectClothesSlots(vrm.scene)
    const items = listClothesItems(slots)
    console.info('[character-kit] overlay donor cached', { url, items: items.map((i) => i.id) })
    return { url, vrm, slots, items }
  }
}
