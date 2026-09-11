import * as THREE from 'three'
import { normalizeObjectSpec, type ObjectSpecV1 } from './spec.ts'

function parseColor(raw: string | undefined, fallback = 0x7eb8ff): number {
  if (!raw?.trim()) return fallback
  try {
    return new THREE.Color(raw.trim()).getHex()
  } catch {
    return fallback
  }
}

/** Build a primitive mesh from ObjectSpec (no network). */
export function createPrimitiveMesh(specInput: unknown): THREE.Mesh {
  const spec = normalizeObjectSpec(specInput)
  const color = parseColor(spec.color, parseColor(spec.material?.color))
  const emissive = parseColor(spec.material?.emissive, 0x000000)
  const opacity =
    spec.material?.opacity !== undefined && Number.isFinite(spec.material.opacity)
      ? Math.max(0, Math.min(1, Number(spec.material.opacity)))
      : 1
  const mat = new THREE.MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity: emissive ? 0.4 : 0,
    metalness: Number(spec.material?.metalness) || 0.1,
    roughness: Number(spec.material?.roughness) || 0.55,
    transparent: opacity < 1,
    opacity,
  })
  const geo = geometryFor(spec)
  const mesh = new THREE.Mesh(geo, mat)
  mesh.name = `object-${spec.shape || 'sphere'}`
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

function geometryFor(spec: ObjectSpecV1): THREE.BufferGeometry {
  const r = Math.max(0.02, spec.radius || 0.15)
  const sx = spec.size?.x ?? r * 2
  const sy = spec.size?.y ?? r * 2
  const sz = spec.size?.z ?? r * 2
  switch (spec.shape) {
    case 'box':
      return new THREE.BoxGeometry(sx, sy, sz)
    case 'cylinder':
      return new THREE.CylinderGeometry(r, r, sy, 24)
    case 'plane':
      return new THREE.PlaneGeometry(sx, sz)
    case 'cone':
      return new THREE.ConeGeometry(r, sy, 24)
    case 'capsule':
      return new THREE.CapsuleGeometry(r * 0.5, Math.max(0.01, sy - r), 6, 12)
    case 'sphere':
    default:
      return new THREE.SphereGeometry(r, 24, 16)
  }
}

export function disposeObject3D(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (mesh.geometry) mesh.geometry.dispose()
    const mat = mesh.material
    if (!mat) return
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
    else mat.dispose()
  })
}
