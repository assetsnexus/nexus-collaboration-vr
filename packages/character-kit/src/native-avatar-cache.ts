/**
 * Native OS-cache fallback when WebView Cache API is unavailable.
 * Files live under the platform cache directory (Android getCacheDir / iOS Caches);
 * the OS may delete them at any time — never treat as durable storage.
 */
import type { AvatarAssetCacheBackend, AvatarAssetCacheStored } from './asset-cache.js'
import { setAvatarAssetCacheBackend, getAvatarAssetCacheBackend } from './asset-cache.js'

export type NativeAvatarCacheRequest =
  | {
      type: 'cachePut'
      requestId: string
      key: string
      base64: string
      contentType: string
      fetchedAt: number
      ttlMs: number
    }
  | { type: 'cacheGet'; requestId: string; key: string }
  | { type: 'cacheDelete'; requestId: string; key: string }

export type NativeAvatarCacheResult = {
  type: 'cacheResult'
  requestId: string
  ok: boolean
  base64?: string
  contentType?: string
  fetchedAt?: number
  ttlMs?: number
  error?: string
}

export type NativeAvatarCacheTransport = {
  /** Post a request to the native host; host replies with matching requestId. */
  send(request: NativeAvatarCacheRequest): void
  onResult(handler: (result: NativeAvatarCacheResult) => void): () => void
}

function arrayBufferToBase64(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data)
  const chunk = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out.buffer
}

function nextRequestId(): string {
  return `nac-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function createNativeAvatarCacheBackend(
  transport: NativeAvatarCacheTransport,
): AvatarAssetCacheBackend {
  const pending = new Map<
    string,
    { resolve: (r: NativeAvatarCacheResult) => void; reject: (e: Error) => void }
  >()
  const unsubscribe = transport.onResult((result) => {
    const wait = pending.get(result.requestId)
    if (!wait) return
    pending.delete(result.requestId)
    wait.resolve(result)
  })

  const call = (request: NativeAvatarCacheRequest): Promise<NativeAvatarCacheResult> =>
    new Promise((resolve, reject) => {
      pending.set(request.requestId, { resolve, reject })
      try {
        transport.send(request)
      } catch (err) {
        pending.delete(request.requestId)
        reject(err instanceof Error ? err : new Error(String(err)))
      }
      setTimeout(() => {
        if (!pending.has(request.requestId)) return
        pending.delete(request.requestId)
        reject(new Error('native avatar cache timeout'))
      }, 60_000)
    })

  const backend: AvatarAssetCacheBackend & { dispose?: () => void } = {
    async get(cacheKey) {
      const result = await call({ type: 'cacheGet', requestId: nextRequestId(), key: cacheKey })
      if (!result.ok || !result.base64) return null
      return {
        data: base64ToArrayBuffer(result.base64),
        contentType: result.contentType || 'application/octet-stream',
        fetchedAt: Number(result.fetchedAt) || 0,
        ttlMs: Number(result.ttlMs) || 0,
      }
    },
    async put(cacheKey, entry: AvatarAssetCacheStored) {
      await call({
        type: 'cachePut',
        requestId: nextRequestId(),
        key: cacheKey,
        base64: arrayBufferToBase64(entry.data),
        contentType: entry.contentType,
        fetchedAt: entry.fetchedAt,
        ttlMs: entry.ttlMs,
      })
    },
    async delete(cacheKey) {
      await call({ type: 'cacheDelete', requestId: nextRequestId(), key: cacheKey })
    },
    dispose() {
      unsubscribe()
      pending.clear()
    },
  }
  return backend
}

/**
 * Install the native backend only when Cache API is missing and a transport is provided.
 * Safe to call multiple times — no-ops when Cache API exists or a backend is already set.
 */
export function installNativeAvatarCacheFallback(transport: NativeAvatarCacheTransport): void {
  if (typeof caches !== 'undefined' && typeof caches.open === 'function') return
  if (getAvatarAssetCacheBackend()) return
  setAvatarAssetCacheBackend(createNativeAvatarCacheBackend(transport))
}
