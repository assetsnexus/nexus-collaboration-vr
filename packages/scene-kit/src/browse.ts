import { xzDistance } from './frame.ts'
import type { SceneEntity, SceneQueryOpts } from './types.ts'

export const SCENE_LIST_DEFAULT_LIMIT = 20
export const SCENE_LIST_MAX_LIMIT = 50
export const SCENE_OVERVIEW_DEFAULT_RADIUS_M = 20
export const SCENE_OVERVIEW_MAX_RADIUS_M = 80
export const SCENE_OVERVIEW_MAX_ROWS = 24

function clampLimit(limit: number | undefined, fallback: number, max: number): number {
  if (limit === undefined || !Number.isFinite(limit)) return fallback
  return Math.min(max, Math.max(1, Math.floor(limit)))
}

function matchesQuery(e: SceneEntity, q: string): boolean {
  const needle = q.toLowerCase()
  return (
    e.id.toLowerCase().includes(needle) ||
    e.label.toLowerCase().includes(needle) ||
    e.kind.toLowerCase().includes(needle) ||
    e.tags.some((t) => t.toLowerCase().includes(needle))
  )
}

export function filterEntities(
  entities: SceneEntity[],
  opts: SceneQueryOpts = {},
): { rows: SceneEntity[]; total: number } {
  const kind = opts.kind?.trim().toLowerCase()
  const tag = opts.tag?.trim().toLowerCase()
  const query = opts.query?.trim()
  const ids = opts.ids?.map((id) => id.trim().toLowerCase()).filter(Boolean)
  const idSet = ids?.length ? new Set(ids) : null

  let from: { x: number; z: number } | null = null
  if (opts.from && typeof opts.from === 'object') {
    from = { x: Number(opts.from.x) || 0, z: Number(opts.from.z) || 0 }
  }
  const radius =
    opts.radius !== undefined && Number.isFinite(opts.radius)
      ? Math.min(SCENE_OVERVIEW_MAX_RADIUS_M, Math.max(0, opts.radius))
      : null

  const matched = entities.filter((e) => {
    if (idSet && !idSet.has(e.id.toLowerCase())) return false
    if (kind && e.kind.toLowerCase() !== kind && !(kind === 'machine' && e.kind === 'robot')) {
      return false
    }
    if (tag && !e.tags.some((t) => t.toLowerCase() === tag)) return false
    if (query && !matchesQuery(e, query)) return false
    if (from && radius != null && xzDistance(e.pose, from) > radius) return false
    return true
  })

  const sorted =
    from != null
      ? [...matched].sort((a, b) => xzDistance(a.pose, from!) - xzDistance(b.pose, from!))
      : matched

  const limit = clampLimit(opts.limit, SCENE_LIST_DEFAULT_LIMIT, SCENE_LIST_MAX_LIMIT)
  return { rows: sorted.slice(0, limit), total: matched.length }
}

export function formatEntityRow(e: SceneEntity, from?: { x: number; z: number }): string {
  const dist =
    from != null ? ` dist=${xzDistance(e.pose, from).toFixed(1)}m` : ''
  const tags = e.tags.length ? ` tags=${e.tags.join(',')}` : ''
  return `- ${e.id} [${e.kind}] "${e.label}" x=${e.pose.x.toFixed(1)} y=${e.pose.y.toFixed(1)} z=${e.pose.z.toFixed(1)} yaw=${e.pose.yaw.toFixed(2)}${dist}${tags}`
}

/** Merge avatar poses (from SceneRoom) into browse results as kind=avatar. */
export function avatarsAsEntities(
  occupants: Array<{
    slug: string
    x: number
    z: number
    facing: number
    present?: boolean
    label?: string
  }>,
): SceneEntity[] {
  return occupants.map((o) => ({
    id: o.slug.startsWith('@') ? o.slug.slice(1) : o.slug,
    kind: 'avatar' as const,
    label: o.label || o.slug,
    pose: { x: o.x, y: 0, z: o.z, yaw: o.facing },
    radius: 0.35,
    tags: o.present === false ? ['absent'] : ['avatar'],
    owner: { type: 'agent' as const, slug: o.slug },
    spec: null,
    rev: 0,
  }))
}
