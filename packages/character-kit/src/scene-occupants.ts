/** Occupant roster helpers for SceneRoom — kept free of Three.js for unit tests. */

export type OccupantUrlFields = {
  present?: boolean
  vrmUrl?: string | null
}

export type OccupantRosterFields = OccupantUrlFields & {
  id: string
  slotIndex: number
  mood?: string
  statusColor: number
  label?: string
}

export const OCCUPANT_LOAD_CANCELLED = 'SceneRoom occupant load cancelled'

/** Same URL as `DEFAULT_SAMPLE_VRM`; mirrored here so this module stays Three-free. */
export const OCCUPANT_FALLBACK_VRM =
  'https://cdn.jsdelivr.net/gh/pixiv/three-vrm@dev/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm'

export function occupantPresentUrl(occ: OccupantUrlFields | undefined): string {
  if (!occ?.present) return ''
  return occ.vrmUrl || ''
}

/**
 * The URL a *present* occupant should actually render.
 *
 * A present participant with no configured `vrmUrl` still has a body: the
 * companion / meeting stage must spawn the platform sample so the agent is
 * visible and animated instead of silently vanishing until an avatar is picked
 * in the gallery. Returning `''` here (only for absent participants) is what
 * tells the reconcile loop to drop a stale avatar.
 *
 * Gated on `present` so a genuinely-absent participant still resolves to `''`
 * and its avatar is torn down — this is a presence fallback, not a "keep every
 * occupant forever" rule.
 */
export function occupantRenderUrl(occ: OccupantUrlFields | undefined): string {
  if (!occ?.present) return ''
  const configured = typeof occ.vrmUrl === 'string' ? occ.vrmUrl.trim() : ''
  return configured || OCCUPANT_FALLBACK_VRM
}

/**
 * Whether a present occupant's resolved URL is the platform sample rather than a
 * per-agent `vrmUrl`. The asset gate treats platform URLs as always-downloadable,
 * so the fallback never needs a catalog validation status.
 */
export function isOccupantFallbackUrl(url: string): boolean {
  return url === OCCUPANT_FALLBACK_VRM
}

export function isStaleOccupantLoad(
  wantedUrl: string,
  loadedUrl: string,
  disposed: boolean,
): boolean {
  return disposed || wantedUrl !== loadedUrl
}

export function isOccupantLoadCancelled(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /occupant load cancelled|SceneRoom disposed/i.test(msg)
}

export function occupantRosterKey(occupants: OccupantRosterFields[]): string {
  return occupants
    .map(
      (o) =>
        `${o.id}|${o.slotIndex}|${o.present ? 1 : 0}|${occupantPresentUrl(o)}|${o.mood || ''}|${o.statusColor}|${o.label || ''}`,
    )
    .join(';')
}

/** Saved XZ pose from a previous visit. Missing/non-finite values mean "use spawn". */
export function occupantWorldPose(occ: {
  x?: number
  z?: number
  facing?: number
}): { x: number; z: number; yawRad: number } | null {
  const x = Number(occ.x)
  const z = Number(occ.z)
  const facing = Number(occ.facing)
  if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(facing)) return null
  return { x, z, yawRad: facing }
}

export function resolveOccupantSpawnPose(
  occ: { x?: number; z?: number; facing?: number },
  fallback: { x: number; z: number; yawRad: number },
): { x: number; z: number; yawRad: number } {
  const world = occupantWorldPose(occ)
  if (!world) return fallback
  // Still on the spawn pad: use current slot facing so a stored π (old VRM
  // compensation) does not keep showing the avatar's back to the camera.
  if (Math.hypot(world.x - fallback.x, world.z - fallback.z) < 0.45) {
    return { x: world.x, z: world.z, yawRad: fallback.yawRad }
  }
  return world
}

export function normalizeOccupants<T extends { id: string; slotIndex: number }>(occupants: T[]): T[] {
  return occupants
    .map((row) => ({ ...row, id: String(row.id) }))
    .sort((a, b) => a.slotIndex - b.slotIndex || a.id.localeCompare(b.id))
}
