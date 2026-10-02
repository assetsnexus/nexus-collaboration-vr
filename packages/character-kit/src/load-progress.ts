/** Top-of-view load bars: null hides, -1 indeterminate, 0–1 determinate. */
export type AvatarAssetLoadProgress = {
  model: number | null
  gestures: number | null
}

export type AvatarAssetLoadProgressListener = (progress: AvatarAssetLoadProgress) => void

export function emptyAvatarAssetLoadProgress(): AvatarAssetLoadProgress {
  return { model: null, gestures: null }
}
