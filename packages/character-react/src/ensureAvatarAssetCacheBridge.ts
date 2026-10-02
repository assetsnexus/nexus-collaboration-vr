/**
 * Install Cache API fallback via ANX WebView host bridge when `caches` is missing.
 * Host must keep files under the OS cache directory (may be purged anytime).
 */
import {
  installNativeAvatarCacheFallback,
  type NativeAvatarCacheRequest,
  type NativeAvatarCacheResult,
} from '@nexus/character-kit'

type BridgeWindow = Window & {
  __anxChatPostToHost?: (payload: unknown) => void
  __ANX_AVATAR_CACHE_BRIDGE_INSTALLED__?: boolean
}

function isCacheResult(value: unknown): value is NativeAvatarCacheResult {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return v.type === 'cacheResult' && typeof v.requestId === 'string'
}

let installed = false

export function ensureAvatarAssetCacheBridge(): void {
  if (installed || typeof window === 'undefined') return
  const w = window as BridgeWindow
  if (w.__ANX_AVATAR_CACHE_BRIDGE_INSTALLED__) {
    installed = true
    return
  }
  if (typeof caches !== 'undefined' && typeof caches.open === 'function') {
    w.__ANX_AVATAR_CACHE_BRIDGE_INSTALLED__ = true
    installed = true
    return
  }
  if (typeof w.__anxChatPostToHost !== 'function') return

  const listeners = new Set<(result: NativeAvatarCacheResult) => void>()
  const onMessage = (event: MessageEvent) => {
    const data = event.data
    const parsed =
      typeof data === 'string'
        ? (() => {
            try {
              return JSON.parse(data) as unknown
            } catch {
              return null
            }
          })()
        : data
    if (!isCacheResult(parsed)) return
    for (const listener of listeners) listener(parsed)
  }
  window.addEventListener('message', onMessage)

  installNativeAvatarCacheFallback({
    send(request: NativeAvatarCacheRequest) {
      w.__anxChatPostToHost?.(request)
    },
    onResult(handler) {
      listeners.add(handler)
      return () => listeners.delete(handler)
    },
  })
  w.__ANX_AVATAR_CACHE_BRIDGE_INSTALLED__ = true
  installed = true
}
