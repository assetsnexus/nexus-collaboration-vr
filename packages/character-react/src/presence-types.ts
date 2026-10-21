/** Participant 3D presence config (v1). Stored on profile / agent records. */
export type ParticipantPresenceV1 = {
  v?: 1
  vrmUrl?: string
  /** Catalog row id when `vrmUrl` came from anx.inference.avatar-assets. */
  vrmAssetId?: string
  vrmValidationStatus?: 'pending_admin' | 'rejected' | 'verified'
  gestureManifestUrl?: string
  gestureManifestAssetId?: string
  gestureManifestValidationStatus?: 'pending_admin' | 'rejected' | 'verified'
  defaultMood?: string
  clothes?: {
    id?: string
    ids?: string[]
    overlayPieces?: unknown[]
  }
  fishVoiceId?: string
  voiceId?: string
  /**
   * Plan Part C1 embodiment profile (vrmUrl, routines, face caps, zen…).
   * Tolerant: absent means "use current behaviour".
   */
  embodiment?: Record<string, unknown>
  settings?: {
    lip_sync_enabled?: boolean
    status_motions?: Record<string, string>
    routines?: unknown[]
  }
}

export function emptyPresence(): ParticipantPresenceV1 {
  return { v: 1, defaultMood: 'neutral', settings: { lip_sync_enabled: true } }
}
