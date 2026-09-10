import * as THREE from 'three'
import type { VRM } from '@pixiv/three-vrm'

/** Gestures that keep the avatar in a chair-sit pose. */
export const SIT_GESTURE_IDS = new Set(['sit', 'sit_wave'])

/** Rest-loop id for sitting. sit_wave is a one-shot fidget on top of this. */
export function isSitRestLoopId(id: string | null | undefined): boolean {
  return id === 'sit'
}

/** Playing these should not stand the character up. */
export function gesturePreservesSitRest(id: string): boolean {
  return id === 'sit' || id === 'sit_wave'
}

export const SEAT_CUBE_SIZE = 0.44
/** Gap from hip joint down to the seat top (cm-scale, avoids thigh clipping). */
const HIP_TO_SEAT_TOP = 0.07

const _hips = new THREE.Vector3()

export function isSitGestureId(id: string | null | undefined): boolean {
  return Boolean(id && SIT_GESTURE_IDS.has(id))
}

export function createSeatMesh(): THREE.Mesh {
  const geo = new THREE.BoxGeometry(SEAT_CUBE_SIZE, SEAT_CUBE_SIZE, SEAT_CUBE_SIZE)
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.84,
    metalness: 0.06,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.name = 'character-sit-seat'
  mesh.visible = false
  mesh.frustumCulled = false
  return mesh
}

export function disposeSeatMesh(mesh: THREE.Mesh | null): void {
  if (!mesh) return
  mesh.geometry.dispose()
  const mat = mesh.material
  if (Array.isArray(mat)) {
    for (const m of mat) m.dispose()
  } else {
    mat.dispose()
  }
}

/** Place a cube so its top sits just under the hips. Floats if the sit clip does. */
export function placeSeatUnderHips(seat: THREE.Object3D, vrm: VRM): boolean {
  const hips = vrm.humanoid?.getNormalizedBoneNode('hips')
  if (!hips) return false
  hips.updateWorldMatrix(true, false)
  hips.getWorldPosition(_hips)
  const half = SEAT_CUBE_SIZE / 2
  const top = _hips.y - HIP_TO_SEAT_TOP
  seat.position.set(_hips.x, Math.max(half, top - half), _hips.z)
  return true
}
