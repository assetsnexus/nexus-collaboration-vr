import type { BufferGeometry, Mesh, Object3D } from 'three'

function isMesh(obj: Object3D): obj is Mesh {
  return (obj as Mesh).isMesh === true
}

function geometryHasPositions(geometry: BufferGeometry | undefined): boolean {
  const pos = geometry?.getAttribute('position')
  return Boolean(pos && pos.count > 0)
}

function matrixIsFinite(obj: Object3D): boolean {
  const e = obj.matrixWorld.elements
  for (let i = 0; i < 16; i++) {
    if (!Number.isFinite(e[i]!)) return false
  }
  return true
}

/**
 * True when a loaded VRM can actually draw (has mesh data and finite transforms).
 * Ignore NaN on empty helper nodes — some VRM1 extras do that on mobile GLES,
 * and rejecting the whole file left the stand-in up forever.
 */
export function vrmSceneIsRenderable(root: Object3D): boolean {
  root.updateMatrixWorld(true)
  let meshCount = 0
  root.traverse((obj) => {
    if (!isMesh(obj) || !geometryHasPositions(obj.geometry)) return
    if (!matrixIsFinite(obj)) return
    meshCount += 1
  })
  return meshCount > 0
}
