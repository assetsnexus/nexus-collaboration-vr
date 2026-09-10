import * as THREE from 'three'
import {
  isClothesItemSelected,
  parseClothesMaterialName,
  resolveClothesSelection,
  uniqueClothesItems,
  type ClothesItem,
} from './clothes-parse.js'
import {
  isOddAxisMirror,
  normalizeClothesTransform,
  type ClothesPieceTransform,
} from './clothes-transform.js'

export {
  CLOTHES_CATEGORY_LABEL,
  CLOTHES_CATEGORY_ORDER,
  CLOTHES_DEFAULT_ID,
  CLOTHES_NONE_ID,
  describeClothesState,
  groupClothesByCategory,
  isClothesItemSelected,
  isReservedClothesId,
  normalizeClothesId,
  parseClothesIdList,
  parseClothesMaterialName,
  resolveClothesSelection,
  summarizeClothesSelection,
  uniqueClothesItems,
} from './clothes-parse.js'
export type {
  ClothesCategory,
  ClothesGroup,
  ClothesItem,
  ClothesSelectMode,
  ClothesSelection,
  ClothesSpec,
} from './clothes-parse.js'

export interface ClothesSlot {
  item: ClothesItem
  mesh: THREE.Mesh
  /** Set when the mesh uses a material array (hide one slot). */
  materialIndex: number | null
  originalMaterial: THREE.Material
}

let hiddenMaterial: THREE.MeshBasicMaterial | null = null

function getHiddenMaterial(): THREE.MeshBasicMaterial {
  if (!hiddenMaterial) {
    hiddenMaterial = new THREE.MeshBasicMaterial({
      name: 'ClothesHidden',
      colorWrite: false,
      depthWrite: false,
      transparent: true,
      opacity: 0,
    })
  }
  return hiddenMaterial
}

function materialsOf(mesh: THREE.Mesh): THREE.Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material]
}

function clothesItemFor(mesh: THREE.Mesh, mat: THREE.Material): ClothesItem | null {
  return parseClothesMaterialName(mat.name) ?? parseClothesMaterialName(mesh.name)
}

export function collectClothesSlots(root: THREE.Object3D): ClothesSlot[] {
  const slots: ClothesSlot[] = []
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh) return
    const mats = materialsOf(mesh)
    if (mats.length === 1) {
      const item = clothesItemFor(mesh, mats[0]!)
      if (!item) return
      slots.push({
        item,
        mesh,
        materialIndex: null,
        originalMaterial: mats[0]!,
      })
      return
    }
    mats.forEach((mat, index) => {
      const item = clothesItemFor(mesh, mat)
      if (!item) return
      slots.push({
        item,
        mesh,
        materialIndex: index,
        originalMaterial: mat,
      })
    })
  })
  return slots
}

export function listClothesItems(slots: ClothesSlot[]): ClothesItem[] {
  return uniqueClothesItems(slots.map((s) => s.item))
}

function setSlotVisible(slot: ClothesSlot, visible: boolean): void {
  if (slot.materialIndex === null) {
    slot.mesh.visible = visible
    return
  }
  const mats = materialsOf(slot.mesh)
  mats[slot.materialIndex] = visible ? slot.originalMaterial : getHiddenMaterial()
  slot.mesh.material = mats
}

export function applyNativeClothesVisibility(
  slots: ClothesSlot[],
  spec: { id?: string; ids?: string[] },
): void {
  const selection = resolveClothesSelection(spec)
  if (selection.mode === 'items' && slots.length) {
    const known = slots.some((s) => isClothesItemSelected(s.item, selection))
    if (!known) {
      for (const slot of slots) setSlotVisible(slot, true)
      return
    }
  }
  for (const slot of slots) {
    setSlotVisible(slot, isClothesItemSelected(slot.item, selection))
  }
}

function collectBonesByName(root: THREE.Object3D): Map<string, THREE.Bone> {
  const map = new Map<string, THREE.Bone>()
  root.traverse((obj) => {
    const bone = obj as THREE.Bone
    if (bone.isBone && bone.name) map.set(bone.name, bone)
  })
  return map
}

export function extractClothesMeshes(root: THREE.Object3D): THREE.SkinnedMesh[] {
  const meshes: THREE.SkinnedMesh[] = []
  const seen = new Set<THREE.SkinnedMesh>()
  for (const slot of collectClothesSlots(root)) {
    const skinned = slot.mesh as THREE.SkinnedMesh
    if (!skinned.isSkinnedMesh || seen.has(skinned)) continue
    seen.add(skinned)
    meshes.push(skinned)
  }
  return meshes
}

export function rebindClothesMesh(
  mesh: THREE.SkinnedMesh,
  hostRoot: THREE.Object3D,
): { bound: number; missing: string[] } {
  const hostBones = collectBonesByName(hostRoot)
  const missing: string[] = []
  const bones = mesh.skeleton.bones.map((bone) => {
    const replacement = hostBones.get(bone.name)
    if (!replacement) {
      missing.push(bone.name)
      return bone
    }
    return replacement
  })
  mesh.bind(new THREE.Skeleton(bones, mesh.skeleton.boneInverses), mesh.bindMatrix)
  return { bound: bones.length - missing.length, missing }
}

function itemMatches(item: ClothesItem, itemId: string): boolean {
  return item.id === itemId || item.category === itemId
}

/** Clone donor clothing meshes for one catalog item without mutating the donor. */
export function cloneClothesItemMeshes(
  slots: ClothesSlot[],
  itemId: string,
): THREE.SkinnedMesh[] {
  const matching = slots.filter((s) => itemMatches(s.item, itemId))
  const unique = [...new Set(matching.map((s) => s.mesh))]
  const clones: THREE.SkinnedMesh[] = []
  for (const mesh of unique) {
    const skinned = mesh as THREE.SkinnedMesh
    if (!skinned.isSkinnedMesh) continue
    const origMats = materialsOf(mesh)
    const clonedMats = origMats.map((m) => m.clone())
    const clone = skinned.clone()
    clone.material = clonedMats.length === 1 ? clonedMats[0]! : clonedMats
    const meshSlots = slots.filter((s) => s.mesh === mesh)
    for (const slot of meshSlots) {
      const idx = slot.materialIndex
      const orig = idx === null ? clonedMats[0] : clonedMats[idx]
      if (!orig) continue
      setSlotVisible(
        {
          item: slot.item,
          mesh: clone,
          materialIndex: idx,
          originalMaterial: orig,
        },
        itemMatches(slot.item, itemId),
      )
    }
    clones.push(clone)
  }
  return clones
}

interface ClothesBindPose {
  px: number
  py: number
  pz: number
  qx: number
  qy: number
  qz: number
  qw: number
  sx: number
  sy: number
  sz: number
}

export function captureClothesBindPose(obj: THREE.Object3D): void {
  obj.userData.clothesBind = {
    px: obj.position.x,
    py: obj.position.y,
    pz: obj.position.z,
    qx: obj.quaternion.x,
    qy: obj.quaternion.y,
    qz: obj.quaternion.z,
    qw: obj.quaternion.w,
    sx: obj.scale.x,
    sy: obj.scale.y,
    sz: obj.scale.z,
  } satisfies ClothesBindPose
}

/**
 * Skinned overlay meshes share the host skeleton. Keep `attached` bindMode so
 * bindMatrixInverse tracks matrixWorld — the mesh stays pinned through
 * locomotion/yaw. (Detached + frozen bind was leaving accessories walking the
 * opposite way / ignoring body rotation.)
 * Local clothes TRS still applies on the Object3D; for non-identity offsets we
 * re-seal after transform so the bind matches the offset pose, then stay attached.
 */
export function finalizeClothesSkinBind(obj: THREE.Object3D, _root?: THREE.Object3D): void {
  const mesh = obj as THREE.SkinnedMesh
  if (!mesh.isSkinnedMesh) return
  mesh.updateMatrixWorld(true)
  mesh.bindMode = 'attached'
  mesh.bindMatrix.copy(mesh.matrixWorld)
  mesh.bindMatrixInverse.copy(mesh.matrixWorld).invert()
  delete mesh.userData.overlayBindLocal
  delete mesh.userData.overlayBindRoot
}

/** No-op: attached bindMode follows the parented mesh automatically. */
export function refreshClothesSkinBind(_obj: THREE.Object3D): void {
  /* attached bindMode */
}

interface OverlayMaterial extends THREE.Material {
  isOutline?: boolean
  normalScale?: THREE.Vector2
}

/**
 * Negative scale mirrors geometry, but MToon lighting/outlines break if we
 * switch `side` to DoubleSide: the BackSide outline pass paints the surface a
 * flat shade/outline color (often red). Keep the original cull mode and flip
 * tangent-space handedness instead. Three.js already reverses `frontFace` when
 * matrixWorld.det < 0.
 */
function applyMirrorShading(obj: THREE.Object3D, mirrored: boolean): void {
  const mesh = obj as THREE.Mesh
  if (!mesh.isMesh) return
  for (const mat of materialsOf(mesh)) {
    const overlay = mat as OverlayMaterial
    if (mat.userData.clothesSide === undefined) {
      mat.userData.clothesSide = mat.side
    }
    mat.side = mat.userData.clothesSide as THREE.Side

    const ns = overlay.normalScale
    if (ns && 'x' in ns) {
      if (mat.userData.clothesNormalScaleX === undefined) {
        mat.userData.clothesNormalScaleX = ns.x
      }
      const baseX = mat.userData.clothesNormalScaleX as number
      ns.x = mirrored ? -baseX : baseX
    }
  }
}

const _extraEuler = new THREE.Euler()
const _extraQuat = new THREE.Quaternion()
const _baseQuat = new THREE.Quaternion()

export function applyClothesPieceTransform(
  obj: THREE.Object3D,
  raw?: Partial<ClothesPieceTransform> | null,
): void {
  const t = normalizeClothesTransform(raw)
  const bind = (obj.userData.clothesBind ?? {
    px: 0,
    py: 0,
    pz: 0,
    qx: 0,
    qy: 0,
    qz: 0,
    qw: 1,
    sx: 1,
    sy: 1,
    sz: 1,
  }) as ClothesBindPose
  obj.position.set(bind.px + t.offsetX, bind.py + t.offsetY, bind.pz + t.offsetZ)
  _extraEuler.set(
    THREE.MathUtils.degToRad(t.rotateX),
    THREE.MathUtils.degToRad(t.rotateY),
    THREE.MathUtils.degToRad(t.rotateZ),
  )
  _extraQuat.setFromEuler(_extraEuler)
  _baseQuat.set(bind.qx, bind.qy, bind.qz, bind.qw)
  obj.quaternion.copy(_baseQuat).multiply(_extraQuat)
  const sx = bind.sx * t.scale * (t.mirrorX ? -1 : 1)
  const sy = bind.sy * t.scale * (t.mirrorY ? -1 : 1)
  const sz = bind.sz * t.scale * (t.mirrorZ ? -1 : 1)
  obj.scale.set(sx, sy, sz)
  applyMirrorShading(obj, isOddAxisMirror(t.mirrorX, t.mirrorY, t.mirrorZ))
}
