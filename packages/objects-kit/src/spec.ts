/** Readable agent format for static / editable scene meshes. */

export type ObjectShape = 'box' | 'sphere' | 'cylinder' | 'plane' | 'cone' | 'capsule'

export type ObjectMaterialSpec = {
  color?: string
  emissive?: string
  opacity?: number
  metalness?: number
  roughness?: number
}

export type ObjectSpecV1 = {
  v?: 1
  shape?: ObjectShape
  color?: string
  radius?: number
  size?: { x: number; y: number; z: number }
  material?: ObjectMaterialSpec
  /** Optional remote mesh (glTF/GLB/OBJ). Subject to URL policy. */
  url?: string
  /** Catalog id when spawned from a host catalog entry. */
  catalogId?: string
  /** Optional Three.js ObjectLoader JSON (advanced). */
  threeJson?: unknown
}

export type ObjectCatalogEntry = {
  id: string
  label: string
  tags?: string[]
  url?: string
  spec?: ObjectSpecV1
}

const SHAPES = new Set<ObjectShape>(['box', 'sphere', 'cylinder', 'plane', 'cone', 'capsule'])

export function normalizeObjectSpec(raw: unknown): ObjectSpecV1 {
  if (!raw || typeof raw !== 'object') {
    return { v: 1, shape: 'sphere', color: '#7eb8ff', radius: 0.15 }
  }
  const rec = raw as Record<string, unknown>
  const shapeRaw = String(rec.shape || 'sphere').toLowerCase() as ObjectShape
  const shape = SHAPES.has(shapeRaw) ? shapeRaw : 'sphere'
  const radius = Number(rec.radius)
  const color = typeof rec.color === 'string' ? rec.color : '#7eb8ff'
  const size =
    rec.size && typeof rec.size === 'object'
      ? {
          x: Number((rec.size as Record<string, unknown>).x) || 0.3,
          y: Number((rec.size as Record<string, unknown>).y) || 0.3,
          z: Number((rec.size as Record<string, unknown>).z) || 0.3,
        }
      : undefined
  const mat =
    rec.material && typeof rec.material === 'object'
      ? (rec.material as ObjectMaterialSpec)
      : undefined
  return {
    v: 1,
    shape,
    color,
    radius: Number.isFinite(radius) && radius > 0 ? radius : 0.15,
    size,
    material: mat,
    url: typeof rec.url === 'string' ? rec.url.trim() : undefined,
    catalogId: typeof rec.catalogId === 'string' ? rec.catalogId.trim() : undefined,
    threeJson: rec.threeJson,
  }
}

export function defaultSphereSpec(color = '#ffcc33'): ObjectSpecV1 {
  return { v: 1, shape: 'sphere', color, radius: 0.15 }
}
