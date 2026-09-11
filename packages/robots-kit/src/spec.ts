export type RobotJoint = { name: string; angle: number }

export type RobotSpecV1 = {
  v?: 1
  /** glTF/GLB url or catalog id for the articulated mesh. */
  url?: string
  catalogId?: string
  /** Fallback primitive when no mesh. */
  standIn?: 'box' | 'capsule'
  color?: string
  joints?: RobotJoint[]
  /** Named glTF animation clips. */
  clips?: string[]
}

export function normalizeRobotSpec(raw: unknown): RobotSpecV1 {
  if (!raw || typeof raw !== 'object') {
    return { v: 1, standIn: 'capsule', color: '#88aacc', joints: [] }
  }
  const rec = raw as Record<string, unknown>
  const joints = Array.isArray(rec.joints)
    ? rec.joints
        .map((j) => {
          if (!j || typeof j !== 'object') return null
          const row = j as Record<string, unknown>
          const name = String(row.name || '').trim()
          const angle = Number(row.angle)
          if (!name || !Number.isFinite(angle)) return null
          return { name, angle }
        })
        .filter(Boolean) as RobotJoint[]
    : []
  const clips = Array.isArray(rec.clips)
    ? rec.clips.map((c) => String(c).trim()).filter(Boolean)
    : undefined
  return {
    v: 1,
    url: typeof rec.url === 'string' ? rec.url.trim() : undefined,
    catalogId: typeof rec.catalogId === 'string' ? rec.catalogId.trim() : undefined,
    standIn: rec.standIn === 'box' ? 'box' : 'capsule',
    color: typeof rec.color === 'string' ? rec.color : '#88aacc',
    joints,
    clips,
  }
}
