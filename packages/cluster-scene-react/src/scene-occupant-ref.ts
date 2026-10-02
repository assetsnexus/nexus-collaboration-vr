/** Matches `@nexus/character-kit` SceneRoomOccupant (local copy for shallow typecheck). */
export type SceneRoomOccupant = {
  id: string
  label: string
  slotIndex: number
  vrmUrl?: string | null
  mood?: string
  statusColor: number
  present: boolean
  x?: number
  z?: number
  facing?: number
}
