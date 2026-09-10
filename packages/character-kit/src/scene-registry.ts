/** Named scene objects for LLM list/get + stand-beside placement. */

export type SceneObjectKind = 'landmark' | 'prop' | 'seat' | 'camera' | string

export type StandSide = 'front' | 'back' | 'left' | 'right'

export interface SceneObject {
  id: string
  kind: SceneObjectKind
  label: string
  position: { x: number; y: number; z: number }
  /** Object facing; 0 = world +Z (toward default camera). Degrees. */
  yawDeg: number
  /** Ground XZ half-extent used for stand distance. */
  radius: number
  size?: { x: number; y: number; z: number }
  tags: string[]
  description?: string
}

export interface SceneObjectFilter {
  query?: string
  kind?: string
  tag?: string
  ids?: string[]
  limit?: number
}

export interface StandBesideOpts {
  side?: StandSide
  /** Extra meters past object radius. Default 1. */
  distance?: number
  /** Orbit degrees from object front; overrides side when set. 0=front, +CCW. */
  orbitDeg?: number
}

export interface StandPose {
  x: number
  z: number
  /** Character facing (rad) — always toward object center. */
  facingRad: number
}

export const SCENE_LIST_DEFAULT_LIMIT = 20
export const SCENE_LIST_MAX_LIMIT = 50
export const SCENE_OVERVIEW_DEFAULT_RADIUS_M = 20
export const SCENE_OVERVIEW_MAX_RADIUS_M = 80
export const SCENE_OVERVIEW_MAX_ROWS = 24
export const STAND_DISTANCE_DEFAULT = 1
export const STAND_DISTANCE_MAX = 6

const SIDE_ORBIT: Record<StandSide, number> = {
  front: 0,
  left: 90,
  back: 180,
  right: -90,
}

export function clampStandDistance(distance: number | undefined): number {
  const d = distance === undefined || !Number.isFinite(distance) ? STAND_DISTANCE_DEFAULT : distance
  return Math.min(STAND_DISTANCE_MAX, Math.max(0, d))
}

export function parseStandSide(raw: unknown): StandSide {
  const s = String(raw ?? 'front').toLowerCase()
  if (s === 'back' || s === 'left' || s === 'right' || s === 'front') return s
  return 'front'
}

/**
 * Place character beside an object. Always faces the object center.
 * Front-to-front: side=front stands on the object's forward axis looking at it.
 */
export function standBeside(obj: SceneObject, opts: StandBesideOpts = {}): StandPose {
  const extra = clampStandDistance(opts.distance)
  const dist = obj.radius + extra
  let orbitDeg: number
  if (opts.orbitDeg !== undefined && Number.isFinite(opts.orbitDeg)) {
    orbitDeg = opts.orbitDeg
  } else {
    orbitDeg = SIDE_ORBIT[parseStandSide(opts.side)]
  }
  const yawRad = (obj.yawDeg * Math.PI) / 180
  // Object forward = yaw 0 → +Z. Orbit 0 = stand in front (along forward).
  const worldOrbit = yawRad + (orbitDeg * Math.PI) / 180
  const x = obj.position.x + Math.sin(worldOrbit) * dist
  const z = obj.position.z + Math.cos(worldOrbit) * dist
  const facingRad = Math.atan2(obj.position.x - x, obj.position.z - z)
  return { x, z, facingRad }
}

export function normalizeSceneObject(raw: Partial<SceneObject> & { id: string }): SceneObject {
  const id = String(raw.id).trim()
  if (!id) throw new Error('scene object id required')
  const pos = raw.position ?? { x: 0, y: 0, z: 0 }
  return {
    id,
    kind: (raw.kind ?? 'prop') as SceneObjectKind,
    label: String(raw.label ?? id),
    position: {
      x: Number(pos.x) || 0,
      y: Number(pos.y) || 0,
      z: Number(pos.z) || 0,
    },
    yawDeg: Number.isFinite(raw.yawDeg) ? Number(raw.yawDeg) : 0,
    radius: Math.max(0.05, Number.isFinite(raw.radius) ? Number(raw.radius) : 0.5),
    size: raw.size
      ? {
          x: Number(raw.size.x) || 0,
          y: Number(raw.size.y) || 0,
          z: Number(raw.size.z) || 0,
        }
      : undefined,
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    description: raw.description ? String(raw.description) : undefined,
  }
}

export interface SceneListResult {
  objects: SceneObject[]
  total: number
}

export class SceneRegistry {
  private readonly objects = new Map<string, SceneObject>()

  register(raw: Partial<SceneObject> & { id: string }): SceneObject {
    const obj = normalizeSceneObject(raw)
    this.objects.set(obj.id, obj)
    console.info('[character-kit] scene register', { id: obj.id, kind: obj.kind })
    return obj
  }

  unregister(id: string): boolean {
    const ok = this.objects.delete(id)
    if (ok) console.info('[character-kit] scene unregister', id)
    return ok
  }

  update(id: string, patch: Partial<Omit<SceneObject, 'id'>>): SceneObject | null {
    const cur = this.objects.get(id)
    if (!cur) return null
    const next = normalizeSceneObject({ ...cur, ...patch, id })
    this.objects.set(id, next)
    return next
  }

  get(id: string): SceneObject | undefined {
    return this.objects.get(id)
  }

  ids(): string[] {
    return [...this.objects.keys()]
  }

  all(): SceneObject[] {
    return [...this.objects.values()]
  }

  list(filter: SceneObjectFilter = {}): SceneListResult {
    const query = filter.query?.trim().toLowerCase()
    const kind = filter.kind?.trim().toLowerCase()
    const tag = filter.tag?.trim().toLowerCase()
    const idSet = filter.ids?.length ? new Set(filter.ids.map(String)) : null
    let limit = filter.limit ?? SCENE_LIST_DEFAULT_LIMIT
    if (!Number.isFinite(limit)) limit = SCENE_LIST_DEFAULT_LIMIT
    limit = Math.min(SCENE_LIST_MAX_LIMIT, Math.max(1, Math.floor(limit)))

    const matched: SceneObject[] = []
    for (const obj of this.objects.values()) {
      if (idSet && !idSet.has(obj.id)) continue
      if (kind && obj.kind.toLowerCase() !== kind) continue
      if (tag && !obj.tags.some((t) => t.toLowerCase() === tag)) continue
      if (query) {
        const hay = `${obj.id} ${obj.label} ${obj.description ?? ''}`.toLowerCase()
        if (!hay.includes(query)) continue
      }
      matched.push(obj)
    }

    matched.sort((a, b) => a.id.localeCompare(b.id))
    const total = matched.length
    const objects = matched.slice(0, limit)
    console.info('[character-kit] scene list', {
      query: query ?? null,
      kind: kind ?? null,
      tag: tag ?? null,
      total,
      returned: objects.length,
      limit,
    })
    return { objects, total }
  }

  /** Compact public record (no Three internals). */
  toPublic(obj: SceneObject): Record<string, unknown> {
    return {
      id: obj.id,
      kind: obj.kind,
      label: obj.label,
      position: { ...obj.position },
      yawDeg: obj.yawDeg,
      radius: obj.radius,
      ...(obj.size ? { size: { ...obj.size } } : {}),
      tags: [...obj.tags],
      ...(obj.description ? { description: obj.description } : {}),
    }
  }

  /** One-line metadata for LLM context (no description, rounded xz). */
  toCompact(
    obj: SceneObject,
    origin?: { x: number; z: number },
  ): Record<string, unknown> {
    const xz = {
      x: Number(obj.position.x.toFixed(2)),
      z: Number(obj.position.z.toFixed(2)),
    }
    const row: Record<string, unknown> = {
      id: obj.id,
      kind: obj.kind,
      label: obj.label,
      xz,
      yawDeg: Math.round(obj.yawDeg),
    }
    if (obj.tags.length) row.tags = obj.tags.slice(0, 4)
    if (origin) {
      row.distM = Number(Math.hypot(obj.position.x - origin.x, obj.position.z - origin.z).toFixed(2))
    }
    return row
  }

  overview(opts: {
    origin: { x: number; z: number }
    radiusM?: number
    selfId?: string
    limit?: number
  }): { radiusM: number; count: number; objects: Record<string, unknown>[] } {
    const radiusRaw = opts.radiusM ?? SCENE_OVERVIEW_DEFAULT_RADIUS_M
    const radiusM = Math.min(
      SCENE_OVERVIEW_MAX_RADIUS_M,
      Math.max(1, Number.isFinite(radiusRaw) ? radiusRaw : SCENE_OVERVIEW_DEFAULT_RADIUS_M),
    )
    const self = opts.selfId?.trim().toLowerCase()
    const limit = Math.min(
      SCENE_OVERVIEW_MAX_ROWS,
      Math.max(1, Math.floor(opts.limit ?? SCENE_OVERVIEW_MAX_ROWS)),
    )
    const scored = this.all()
      .filter((o) => !self || o.id.toLowerCase() !== self)
      .map((o) => {
        const distM = Math.hypot(o.position.x - opts.origin.x, o.position.z - opts.origin.z)
        return { o, distM }
      })
      .filter((row) => row.distM <= radiusM)
      .sort((a, b) => a.distM - b.distM || a.o.id.localeCompare(b.o.id))
    const objects = scored.slice(0, limit).map((row) => this.toCompact(row.o, opts.origin))
    return { radiusM, count: scored.length, objects }
  }
}

/** Built-in catalog entries (positions may be live-updated by the controller). */
export function createBuiltinSceneObjects(): SceneObject[] {
  return [
    normalizeSceneObject({
      id: 'spawn',
      kind: 'landmark',
      label: 'Spawn',
      position: { x: 0, y: 0, z: 0 },
      yawDeg: 0,
      radius: 0.3,
      tags: ['origin'],
      description: 'Avatar spawn at world origin',
    }),
    normalizeSceneObject({
      id: 'camera',
      kind: 'camera',
      label: 'Camera',
      position: { x: 0, y: 1.95, z: 2.2 },
      yawDeg: 180,
      radius: 0.2,
      tags: ['view'],
      description: 'Current orbit camera (updated live; framed on head after VRM load)',
    }),
    normalizeSceneObject({
      id: 'seat',
      kind: 'seat',
      label: 'Seat',
      position: { x: 0, y: 0.22, z: 0 },
      yawDeg: 0,
      radius: 0.22,
      size: { x: 0.44, y: 0.44, z: 0.44 },
      tags: ['furniture'],
      description: 'Sit-pose seat cube (may be hidden while standing)',
    }),
  ]
}

export interface ParsedTeleportArgs {
  kind: 'object' | 'world'
  objectId?: string
  side?: StandSide
  distance?: number
  orbitDeg?: number
  x?: number
  z?: number
}

export function parseStandOpts(args: Record<string, unknown>): StandBesideOpts {
  const opts: StandBesideOpts = {
    side: parseStandSide(args.side),
    distance: clampStandDistance(
      args.distance !== undefined ? Number(args.distance) : undefined,
    ),
  }
  if (args.orbitDeg !== undefined && Number.isFinite(Number(args.orbitDeg))) {
    opts.orbitDeg = Number(args.orbitDeg)
  }
  return opts
}

export function parseTeleportArgs(
  args: Record<string, unknown>,
): { ok: true; value: ParsedTeleportArgs } | { ok: false; message: string } {
  const objectId =
    args.objectId !== undefined && args.objectId !== null
      ? String(args.objectId).trim()
      : args.landmarkId !== undefined && args.landmarkId !== null
        ? String(args.landmarkId).trim()
        : ''

  if (objectId) {
    return {
      ok: true,
      value: {
        kind: 'object',
        objectId,
        ...parseStandOpts(args),
      },
    }
  }

  const x = args.x !== undefined ? Number(args.x) : NaN
  const z = args.z !== undefined ? Number(args.z) : NaN
  if (Number.isFinite(x) && Number.isFinite(z)) {
    return { ok: true, value: { kind: 'world', x, z } }
  }

  return {
    ok: false,
    message: 'character_teleport requires objectId or x/z',
  }
}
