/**
 * Smartphone VR viewer presets + local settings persistence.
 * Distortion uses Brown–Conrady radial coeffs (k1, k2) as in Cardboard device params.
 * Sources: immersive-web/cardboard-vr-display CardboardV1/V2; Google Cardboard viewer params.
 * Self-contained for unit tests (no sibling .js imports).
 */

export type ViewerDistortion = {
  /** Brown–Conrady k1 (r² term). */
  k1: number
  /** Brown–Conrady k2 (r⁴ term). */
  k2: number
}

export type ViewerProfile = {
  id: string
  label: string
  /** Interpupillary / inter-lens distance in metres. */
  ipdM: number
  /** Approximate monocular FOV (degrees). */
  fovDeg: number
  distortion: ViewerDistortion
  note?: string
}

/** Clamp IPD to a human-usable range (metres). */
export const IPD_MIN_M = 0.05
export const IPD_MAX_M = 0.075
export const IPD_DEFAULT_M = 0.064

export const PHONE_VR_STORAGE_KEY = 'nexus.scene.phoneVr.v1'

export type PhoneVrSettingsV1 = {
  v: 1
  profileId: string
  /** Metres; overrides profile default when set. */
  ipdM: number
  /** Multiplier on profile k1/k2 (1 = preset). */
  distortionScale: number
  /** Last chosen reference space when WebXR path is used. */
  referenceSpace?: 'local-floor' | 'local'
}

export const VIEWER_PROFILES: readonly ViewerProfile[] = Object.freeze([
  {
    id: 'generic-cardboard',
    label: 'Generic cardboard',
    ipdM: 0.06,
    fovDeg: 60,
    distortion: { k1: 0.34, k2: 0.55 },
    note: 'Default Cardboard-style shell (~$50–100 Amazon viewers).',
  },
  {
    id: 'cardboard-v2',
    label: 'Cardboard V2 (I/O 2015)',
    ipdM: 0.064,
    fovDeg: 60,
    distortion: { k1: 0.34, k2: 0.55 },
    note: 'Google Cardboard V2 published interLensDistance + distortionCoefficients.',
  },
  {
    id: 'cardboard-v1',
    label: 'Cardboard V1',
    ipdM: 0.06,
    fovDeg: 40,
    distortion: { k1: 0.441, k2: 0.156 },
    note: 'Original Cardboard kit; stronger k1, milder k2.',
  },
  {
    id: 'merge-compatible',
    label: 'Merge / DESTEK-style',
    ipdM: 0.063,
    fovDeg: 70,
    distortion: { k1: 0.22, k2: 0.24 },
    note: 'Milder barrel for wider plastic-lens shells (Merge VR / DESTEK class).',
  },
  {
    id: 'bobovr-z-style',
    label: 'BOBOVR Z-style',
    ipdM: 0.064,
    fovDeg: 90,
    distortion: { k1: 0.18, k2: 0.16 },
    note: 'Wide FOV headset shells; less aggressive mesh warp.',
  },
])

export function findViewerProfile(id: string | null | undefined): ViewerProfile {
  const hit = VIEWER_PROFILES.find((p) => p.id === id)
  return hit ?? VIEWER_PROFILES[0]!
}

export function clampIpdM(metres: number): number {
  if (!Number.isFinite(metres)) return IPD_DEFAULT_M
  return Math.min(IPD_MAX_M, Math.max(IPD_MIN_M, metres))
}

export function clampDistortionScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1
  return Math.min(1.5, Math.max(0, scale))
}

export function defaultPhoneVrSettings(): PhoneVrSettingsV1 {
  const profile = VIEWER_PROFILES[0]!
  return {
    v: 1,
    profileId: profile.id,
    ipdM: profile.ipdM || IPD_DEFAULT_M,
    distortionScale: 1,
    referenceSpace: 'local-floor',
  }
}

export function normalizePhoneVrSettings(raw: unknown): PhoneVrSettingsV1 {
  const base = defaultPhoneVrSettings()
  if (!raw || typeof raw !== 'object') return base
  const o = raw as Record<string, unknown>
  const profileId = typeof o.profileId === 'string' ? o.profileId : base.profileId
  const profile = findViewerProfile(profileId)
  const ipdRaw = typeof o.ipdM === 'number' ? o.ipdM : profile.ipdM
  const distRaw = typeof o.distortionScale === 'number' ? o.distortionScale : 1
  return {
    v: 1,
    profileId: profile.id,
    ipdM: clampIpdM(ipdRaw),
    distortionScale: clampDistortionScale(distRaw),
    referenceSpace: o.referenceSpace === 'local' ? 'local' : 'local-floor',
  }
}

type StorageLike = { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void }

function storage(): StorageLike | null {
  if (typeof localStorage === 'undefined') return null
  return localStorage
}

/** Read settings for a scene scope (room id / "default"). */
export function readPhoneVrSettings(scopeKey = 'default'): PhoneVrSettingsV1 {
  const store = storage()
  if (!store) return defaultPhoneVrSettings()
  try {
    const raw = JSON.parse(store.getItem(PHONE_VR_STORAGE_KEY) || '{}') as Record<string, unknown>
    return normalizePhoneVrSettings(raw[scopeKey])
  } catch {
    return defaultPhoneVrSettings()
  }
}

export function writePhoneVrSettings(scopeKey: string, settings: PhoneVrSettingsV1): void {
  const store = storage()
  if (!store) return
  try {
    const raw = JSON.parse(store.getItem(PHONE_VR_STORAGE_KEY) || '{}') as Record<string, unknown>
    raw[scopeKey] = normalizePhoneVrSettings(settings)
    store.setItem(PHONE_VR_STORAGE_KEY, JSON.stringify(raw))
  } catch {
    /* quota */
  }
}

export function resolveActiveViewer(settings: PhoneVrSettingsV1) {
  const profile = findViewerProfile(settings.profileId)
  const scale = clampDistortionScale(settings.distortionScale)
  return {
    profile,
    ipdM: clampIpdM(settings.ipdM || profile.ipdM),
    distortionScale: scale,
    distortion: {
      k1: profile.distortion.k1 * scale,
      k2: profile.distortion.k2 * scale,
    },
    fovDeg: profile.fovDeg,
  }
}
