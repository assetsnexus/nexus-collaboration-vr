import * as THREE from 'three'
import type { SceneObject } from './scene-registry.js'

/** Floor decals sit just above the grid so they do not z-fight. */
export const FLOOR_MARKER_Y = 0.02
export const FLOOR_PLATE_HEIGHT = 0.03

export type StandInStyle = 'hidden' | 'floor-disc' | 'floor-plate' | 'box'

export function standInStyle(kind: string): StandInStyle {
  if (kind === 'avatar' || kind === 'camera') return 'hidden'
  if (kind === 'landmark') return 'floor-disc'
  if (kind === 'seat') return 'floor-plate'
  return 'box'
}

export function objectMeshSize(obj: SceneObject): { x: number; y: number; z: number } {
  if (obj.size) return { ...obj.size }
  const r = Math.max(0.12, obj.radius)
  return { x: r * 2, y: Math.max(0.16, r * 1.2), z: r * 2 }
}

function markerColor(kind: string): number {
  if (kind === 'seat') return 0x6b5a45
  if (kind === 'camera') return 0x445566
  return 0x4a6d82
}

export function createStandInMaterial(kind: string, style: StandInStyle): THREE.MeshStandardMaterial {
  const floor = style === 'floor-disc' || style === 'floor-plate'
  return new THREE.MeshStandardMaterial({
    color: markerColor(kind),
    roughness: 0.78,
    metalness: 0.06,
    transparent: true,
    opacity: floor ? 0.22 : 0.4,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  })
}

export function createStandInGeometry(style: StandInStyle): THREE.BufferGeometry {
  if (style === 'floor-disc') return new THREE.CircleGeometry(1, 48)
  return new THREE.BoxGeometry(1, 1, 1)
}

export function applyStandInTransform(
  mesh: THREE.Object3D,
  obj: SceneObject,
  pos: { x: number; y: number; z: number } = obj.position,
): void {
  const style = standInStyle(obj.kind)
  const size = objectMeshSize(obj)
  mesh.rotation.x = style === 'floor-disc' ? -Math.PI / 2 : 0
  mesh.rotation.y = (obj.yawDeg * Math.PI) / 180
  mesh.rotation.z = 0
  if (style === 'hidden') {
    mesh.scale.set(0.01, 0.01, 0.01)
    mesh.position.set(pos.x, pos.y, pos.z)
    mesh.visible = false
    return
  }
  if (style === 'floor-disc') {
    const r = Math.max(0.12, obj.radius)
    mesh.scale.set(r, r, 1)
    mesh.position.set(pos.x, FLOOR_MARKER_Y, pos.z)
  } else if (style === 'floor-plate') {
    mesh.scale.set(size.x, FLOOR_PLATE_HEIGHT, size.z)
    mesh.position.set(pos.x, FLOOR_MARKER_Y + FLOOR_PLATE_HEIGHT / 2, pos.z)
  } else {
    mesh.scale.set(size.x, size.y, size.z)
    mesh.position.set(pos.x, pos.y + size.y / 2, pos.z)
  }
  mesh.visible = true
  mesh.renderOrder = -20
}
