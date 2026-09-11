import {
  createEntityId,
  normalizePose,
  spawnPoseAt,
  type SceneGraph,
  type ScenePose,
} from '@nexus/scene-kit'
import { defaultSphereSpec, normalizeObjectSpec, type ObjectCatalogEntry, type ObjectSpecV1 } from './spec.ts'
import { normalizeEffectClip } from './effects.ts'
import { isDeskCatalogId } from './furniture.ts'

export type SpawnObjectArgs = {
  id?: string
  label?: string
  shape?: string
  color?: string
  radius?: number
  catalogId?: string
  url?: string
  spec?: unknown
  at?: 'front' | 'here' | string | { x: number; y?: number; z: number }
  tags?: string[]
  ownerSlug?: string
  callerPose?: ScenePose
}

/** Origin Y so primitives rest on the floor (Y-up, ground XZ). Desks are floor-anchored at 0. */
export function floorOriginY(spec: ObjectSpecV1): number {
  if (isDeskCatalogId(spec.catalogId)) return 0
  const r = Math.max(0.02, spec.radius || 0.15)
  switch (spec.shape) {
    case 'sphere':
      return r
    case 'box':
      return Math.max(0.02, (spec.size?.y ?? r * 2) / 2)
    case 'cylinder':
    case 'cone':
    case 'capsule':
      return Math.max(0.02, (spec.size?.y ?? r * 2) / 2)
    case 'plane':
      return 0.01
    default:
      return r
  }
}

export function spawnObject(graph: SceneGraph, args: SpawnObjectArgs) {
  const id = (args.id || createEntityId('obj')).trim()
  let spec = normalizeObjectSpec(args.spec)
  if (args.shape) spec = { ...spec, shape: normalizeObjectSpec({ shape: args.shape }).shape }
  if (args.color) spec = { ...spec, color: args.color }
  if (args.radius) spec = { ...spec, radius: args.radius }
  if (args.catalogId) spec = { ...spec, catalogId: args.catalogId }
  if (args.url) spec = { ...spec, url: args.url }
  if (!args.spec && !args.shape && !args.catalogId && !args.url) {
    spec = defaultSphereSpec(args.color || '#ffcc33')
  }

  const floorY = floorOriginY(spec)
  let pose: ScenePose
  const at = args.at ?? 'front'
  if (typeof at === 'string' && at.startsWith('@')) {
    pose = spawnPoseAt('front', args.callerPose, floorY)
  } else if (at === 'front' || at === 'here') {
    pose = spawnPoseAt(at, args.callerPose, floorY)
  } else if (typeof at === 'object') {
    const raw = normalizePose(at)
    pose = {
      ...raw,
      y: Number.isFinite(at.y) ? raw.y : floorY,
    }
  } else {
    pose = spawnPoseAt('front', args.callerPose, floorY)
  }

  const radius = isDeskCatalogId(spec.catalogId)
    ? Math.max(spec.radius || 0.6, 0.55)
    : spec.radius || 0.15

  return graph.apply({
    kind: 'spawn',
    entityId: id,
    payload: {
      id,
      kind: 'object',
      label: args.label || id,
      pose,
      radius,
      tags: args.tags || [],
      owner: args.ownerSlug
        ? { type: 'agent', slug: args.ownerSlug }
        : { type: 'user' },
      spec,
    },
  })
}

export function writeObject(
  graph: SceneGraph,
  id: string,
  patch: { spec?: unknown; color?: string; shape?: string },
) {
  const cur = graph.get(id)
  if (!cur) return { ok: false as const, message: 'unknown entity' }
  let spec = normalizeObjectSpec({ ...(cur.spec as object), ...(patch.spec as object) })
  if (patch.color) spec = { ...spec, color: patch.color }
  if (patch.shape) spec = { ...spec, shape: normalizeObjectSpec({ shape: patch.shape }).shape }
  return graph.apply({
    kind: 'write',
    entityId: id,
    payload: { spec, label: cur.label, kind: cur.kind, pose: cur.pose, radius: cur.radius, tags: cur.tags, owner: cur.owner },
  })
}

export function playObjectEffect(graph: SceneGraph, id: string, effect: string, extra?: Record<string, unknown>) {
  return graph.apply({
    kind: 'play_effect',
    entityId: id,
    payload: { effect, ...extra },
  })
}

export function stopObjectEffect(graph: SceneGraph, id: string, effect?: string) {
  return graph.apply({
    kind: 'stop_effect',
    entityId: id,
    payload: effect ? { effect } : {},
  })
}

export function removeObject(graph: SceneGraph, id: string) {
  return graph.apply({ kind: 'remove', entityId: id })
}

export function listCatalog(
  catalog: ObjectCatalogEntry[],
  opts?: { query?: string; tag?: string },
): ObjectCatalogEntry[] {
  const q = opts?.query?.trim().toLowerCase()
  const tag = opts?.tag?.trim().toLowerCase()
  return catalog.filter((e) => {
    if (tag && !(e.tags || []).some((t) => t.toLowerCase() === tag)) return false
    if (!q) return true
    return (
      e.id.toLowerCase().includes(q) ||
      e.label.toLowerCase().includes(q) ||
      (e.tags || []).some((t) => t.toLowerCase().includes(q))
    )
  })
}

export function registerCustomEffect(raw: unknown) {
  return normalizeEffectClip(raw)
}

export type { ObjectSpecV1, ObjectCatalogEntry }
