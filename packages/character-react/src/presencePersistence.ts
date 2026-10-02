import type { ParticipantPresenceV1 } from './presence-types.js'

const STORAGE_KEY = 'nexus.participant.presence.v1'

type StorageLike = { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void }

function storage(): StorageLike | null {
  if (typeof localStorage === 'undefined') return null
  return localStorage
}

/** Local-only presence draft (e.g. avatar studio before save). */
export function readLocalPresenceDraft(scopeKey: string): ParticipantPresenceV1 | null {
  const store = storage()
  if (!store) return null
  try {
    const raw = JSON.parse(store.getItem(STORAGE_KEY) || '{}') as Record<string, ParticipantPresenceV1>
    return raw[scopeKey] ?? null
  } catch {
    return null
  }
}

export function writeLocalPresenceDraft(scopeKey: string, presence: ParticipantPresenceV1): void {
  const store = storage()
  if (!store) return
  try {
    const raw = JSON.parse(store.getItem(STORAGE_KEY) || '{}') as Record<string, ParticipantPresenceV1>
    raw[scopeKey] = { v: 1, ...presence }
    store.setItem(STORAGE_KEY, JSON.stringify(raw))
  } catch {
    /* quota */
  }
}

type ProfileLike = {
  avatar3dUrl?: string | null
  presence?: ParticipantPresenceV1 | null
  publicProfile?: { avatar3dUrl?: string | null; presence?: ParticipantPresenceV1 | null }
}

/**
 * Read soft presence from user profile / membership publicProfile / agent record.
 * Portal can import these helpers instead of duplicating field paths.
 */
export function readPresenceFromProfile(source: ProfileLike | null | undefined): ParticipantPresenceV1 {
  if (!source) return { v: 1 }
  const nested = source.publicProfile?.presence ?? source.presence
  const vrmUrl =
    nested?.vrmUrl ??
    source.publicProfile?.avatar3dUrl ??
    source.avatar3dUrl ??
    undefined
  return {
    v: 1,
    ...nested,
    vrmUrl: vrmUrl ?? nested?.vrmUrl,
  }
}

/** Build a patch object for anx.profile / agent update commands (non-destructive merge). */
export function writePresenceIntoProfilePatch(
  presence: ParticipantPresenceV1,
  opts?: { agent?: boolean },
): Record<string, unknown> {
  const p = { v: 1 as const, ...presence }
  if (opts?.agent) {
    return {
      avatar3dUrl: p.vrmUrl ?? null,
      presence: p,
    }
  }
  return {
    avatar3dUrl: p.vrmUrl ?? null,
    publicProfile: {
      avatar3dUrl: p.vrmUrl ?? null,
      presence: p,
    },
    presence: p,
  }
}
