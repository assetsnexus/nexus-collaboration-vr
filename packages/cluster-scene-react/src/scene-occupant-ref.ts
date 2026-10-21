/** Matches `@nexus/character-kit` SceneRoomOccupant (local copy for shallow typecheck). */
export type SceneRoomOccupant = {
  id: string
  label: string
  slotIndex: number
  vrmUrl?: string | null
  /** Catalog gate for `vrmUrl`; unverified avatars fall back to a stand-in. */
  validationStatus?: 'pending_admin' | 'rejected' | 'verified' | string | null
  mood?: string
  statusColor: number
  present: boolean
  x?: number
  z?: number
  facing?: number
}
