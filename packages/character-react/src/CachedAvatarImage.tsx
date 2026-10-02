import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import {
  fetchCachedPictureObjectUrl,
  shouldPersistAssetUrl,
} from '@nexus/character-kit'

export type CachedAvatarImageProps = {
  src?: string | null
  /** Catalog asset id — shared cache key across users when present. */
  assetId?: string | null
  alt?: string
  className?: string
  style?: CSSProperties
  /** Shown while a remote fetch is in flight, or when `src` is empty. */
  fallback?: ReactNode
}

/**
 * 2D portrait / contact avatar: remote http(s) bytes go through the shared
 * `nexus-avatar-assets-v1` Cache API (same TTL / key rules as VRM). blob:/data:
 * and other non-persistable URLs render as-is with no store.
 */
export function CachedAvatarImage({
  src,
  assetId,
  alt = '',
  className,
  style,
  fallback = null,
}: CachedAvatarImageProps) {
  const [displaySrc, setDisplaySrc] = useState<string | null>(() => {
    if (!src) return null
    return shouldPersistAssetUrl(src) ? null : src
  })

  useEffect(() => {
    if (!src) {
      setDisplaySrc(null)
      return
    }
    if (!shouldPersistAssetUrl(src)) {
      setDisplaySrc(src)
      return
    }

    let cancelled = false
    let objectUrl: string | null = null
    setDisplaySrc(null)

    void fetchCachedPictureObjectUrl(src, { assetId })
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url)
          return
        }
        objectUrl = url
        setDisplaySrc(url)
      })
      .catch(() => {
        if (!cancelled) setDisplaySrc(src)
      })

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [src, assetId])

  if (!displaySrc) return <>{fallback}</>
  return <img src={displaySrc} alt={alt} className={className} style={style} />
}
