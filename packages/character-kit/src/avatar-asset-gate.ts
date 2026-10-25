/**
 * Catalog validation states from inference avatar / motion assets.
 * Field names align with the parallel inference catalog gate:
 * `validationStatus`, `visibility`, `details.clamav`, `details.aiReview`.
 */
export type AvatarAssetValidationStatus = 'pending_admin' | 'rejected' | 'verified'

/**
 * Minimal descriptor for client auto-download decisions.
 * Catalog may also carry `visibility` and `details.clamav` / `details.aiReview`;
 * those do not grant download by themselves.
 */
export type AvatarAssetDescriptor = {
  url?: string | null
  validationStatus?: AvatarAssetValidationStatus | string | null
  visibility?: 'public' | 'private' | string | null
  details?: {
    clamav?: unknown
    aiReview?: unknown
    [key: string]: unknown
  } | null
  /**
   * Owner-local studio preview may load unverified assets (CompanionHost only).
   * SceneRoom occupant loads for other participants must not set this.
   */
  previewUnverified?: boolean
}

export type AutoDownloadDecision = {
  allow: boolean
  /** Stable machine-readable reason for host logging. */
  reason: string
}

/** Same URL as `DEFAULT_SAMPLE_VRM` — kept local so this module stays strip-types-testable. */
const PLATFORM_SAMPLE_VRM =
  'https://cdn.jsdelivr.net/gh/pixiv/three-vrm@dev/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm'

/**
 * Custom schemes a host registers to serve a model from its **own** local
 * library (e.g. the desktop companion's `nexus-avatar://avatar/<id>.vrm`).
 *
 * A picked local model is by definition user-supplied and cannot carry a
 * catalog `validationStatus`, so the HTTP download gate would refuse it. These
 * schemes are only reachable through the host's own privileged protocol handler
 * (which serves a single file out of the app's library directory), so they are
 * trusted the same way a `blob:` owner preview is — never a remote fetch.
 */
const LOCAL_LIBRARY_SCHEMES = ['nexus-avatar:'] as const

/** True for a model URL served by a host's own local avatar library scheme. */
export function isLocalLibraryAvatarUrl(url: string): boolean {
  const trimmed = typeof url === 'string' ? url.trim().toLowerCase() : ''
  if (!trimmed) return false
  return LOCAL_LIBRARY_SCHEMES.some((scheme) => trimmed.startsWith(scheme))
}

/**
 * Platform default gesture pack paths — same shape as playground
 * `/assets/vrma/manifest.json` entries (and the `/dev-vrm-assets` mount).
 */
export function isPlatformDefaultGestureAsset(url: string): boolean {
  const path = (url.split('?')[0] || '').trim()
  if (!path) return false
  return /(?:^|\/)(?:assets|dev-vrm-assets)\/vrma\/(?:manifest\.json|[^/]+\.vrma)$/i.test(path)
}

/** Built-in sample VRM or platform gesture / manifest URLs. */
export function isPlatformDefaultAvatarAsset(url: string): boolean {
  const trimmed = url.trim()
  if (!trimmed) return false
  if (trimmed === PLATFORM_SAMPLE_VRM) return true
  return isPlatformDefaultGestureAsset(trimmed)
}

/**
 * Whether a room participant may HTTP-fetch this VRM / VRMA / manifest URL.
 * Verified catalog assets and platform defaults are allowed; pending / rejected /
 * missing status are denied unless this is an owner preview (`blob:` or
 * `previewUnverified`).
 */
export function mayAutoDownloadAvatarAsset(asset: AvatarAssetDescriptor): AutoDownloadDecision {
  const url = (asset.url || '').trim()
  if (!url) {
    return { allow: false, reason: 'missing_url' }
  }
  if (asset.previewUnverified === true) {
    return { allow: true, reason: 'preview_unverified' }
  }
  if (/^blob:/i.test(url)) {
    return { allow: true, reason: 'blob_preview' }
  }
  // A host-served local library model (e.g. the desktop companion's picked VRM).
  // It is only reachable through the host's own protocol handler, so it needs no
  // catalog status — the same trust the owner preview gets.
  if (isLocalLibraryAvatarUrl(url)) {
    return { allow: true, reason: 'local_library' }
  }
  if (asset.validationStatus === 'verified') {
    return { allow: true, reason: 'verified' }
  }
  if (isPlatformDefaultAvatarAsset(url)) {
    return { allow: true, reason: 'platform_default' }
  }
  if (asset.validationStatus == null || asset.validationStatus === '') {
    return { allow: false, reason: 'missing_validation_status' }
  }
  return { allow: false, reason: `unverified:${asset.validationStatus}` }
}
