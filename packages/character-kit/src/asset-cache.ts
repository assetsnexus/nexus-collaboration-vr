import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'

export const CHARACTER_ASSET_CACHE = 'openclaw-character-assets-v1'
export const MIN_ASSET_BYTES = 8
/** Total tries including the first (VPN / ERR_NETWORK_CHANGED often needs a few). */
export const ASSET_FETCH_ATTEMPTS = 5
/** First retry delay; doubles each subsequent retry (300 → 600 → 1200 → 2400). */
export const ASSET_FETCH_RETRY_BASE_MS = 300

export function resourcePathForUrl(url: string): string {
  const q = url.split('?')[0] || url
  const slash = q.lastIndexOf('/')
  return slash >= 0 ? q.slice(0, slash + 1) : ''
}

export function shouldPersistAssetUrl(url: string): boolean {
  const trimmed = url.trim()
  if (!trimmed) return false
  if (/^(blob:|data:|file:)/i.test(trimmed)) return false
  return /^(https?:)?\/\//i.test(trimmed) || trimmed.startsWith('/')
}

export function assetBodyLooksValid(url: string, data: ArrayBuffer): boolean {
  if (!data || data.byteLength < MIN_ASSET_BYTES) return false
  if (/\.(vrm|vrma|glb)(\?|$)/i.test(url.split('?')[0] || url)) {
    const magic = new TextDecoder().decode(new Uint8Array(data, 0, 4))
    return magic === 'glTF'
  }
  return true
}

/** 0–1 when Content-Length is known; -1 means indeterminate. */
export function assetLoadRatio(loaded: number, total: number): number {
  if (Number.isFinite(total) && total > 0 && Number.isFinite(loaded)) {
    return Math.min(1, Math.max(0, loaded / total))
  }
  return -1
}

/** Delay before retry `attemptIndex` (0 = first retry after initial failure). */
export function assetFetchRetryDelayMs(attemptIndex: number): number {
  const i = Math.max(0, Math.floor(attemptIndex))
  return ASSET_FETCH_RETRY_BASE_MS * 2 ** i
}

export function isRetryableAssetFetchError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '')
  const lower = msg.toLowerCase()
  // Permanent client errors — do not burn retries on missing assets.
  const http = lower.match(/\bhttp\s+(\d{3})\b/)
  if (http) {
    const code = Number(http[1])
    if (code === 408 || code === 425 || code === 429) return true
    if (code >= 400 && code < 500) return false
    if (code >= 500) return true
  }
  if (/empty or invalid body/.test(lower)) return false
  return true
}

export async function withAssetFetchRetries<T>(
  url: string,
  run: () => Promise<T>,
  opts?: { attempts?: number },
): Promise<T> {
  const attempts = Math.max(1, opts?.attempts ?? ASSET_FETCH_ATTEMPTS)
  let lastErr: unknown
  for (let tryIndex = 0; tryIndex < attempts; tryIndex++) {
    try {
      return await run()
    } catch (err) {
      lastErr = err
      const retriesLeft = attempts - tryIndex - 1
      if (retriesLeft <= 0 || !isRetryableAssetFetchError(err)) throw err
      const delayMs = assetFetchRetryDelayMs(tryIndex)
      console.warn(
        `[character-kit] asset fetch retry ${tryIndex + 1}/${attempts - 1} in ${delayMs}ms`,
        url,
        err instanceof Error ? err.message : err,
      )
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs))
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

async function persistGet(url: string): Promise<ArrayBuffer | null> {
  if (typeof caches === 'undefined' || !shouldPersistAssetUrl(url)) return null
  try {
    const cache = await caches.open(CHARACTER_ASSET_CACHE)
    const hit = await cache.match(url)
    if (!hit || !hit.ok) return null
    const data = await hit.arrayBuffer()
    if (!assetBodyLooksValid(url, data)) {
      await cache.delete(url)
      return null
    }
    return data
  } catch {
    return null
  }
}

async function persistPut(url: string, data: ArrayBuffer, contentType: string): Promise<void> {
  if (typeof caches === 'undefined' || !shouldPersistAssetUrl(url)) return
  if (!assetBodyLooksValid(url, data)) return
  try {
    const cache = await caches.open(CHARACTER_ASSET_CACHE)
    await cache.put(
      url,
      new Response(data.slice(0), {
        headers: { 'Content-Type': contentType || 'application/octet-stream' },
      }),
    )
  } catch {
    /* quota / private mode */
  }
}

/** Fetch a VRM/VRMA/JSON body, preferring Cache Storage then HTTP cache. */
export async function fetchCachedArrayBuffer(url: string): Promise<ArrayBuffer> {
  const cached = await persistGet(url)
  if (cached) return cached

  return withAssetFetchRetries(url, async () => {
    const res = await fetch(url)
    if (!res.ok) {
      throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`)
    }
    const data = await res.arrayBuffer()
    if (!assetBodyLooksValid(url, data)) {
      throw new Error(`Failed to fetch ${url}: empty or invalid body (${data.byteLength} bytes)`)
    }
    await persistPut(url, data, res.headers.get('Content-Type') || 'application/octet-stream')
    return data
  })
}

/**
 * Decode through the real URL so VRMA keeps `userData.vrmAnimations`.
 * Do not pre-download into Cache Storage first — that doubled VRAM/RAM on
 * mobile and could stall the second fetch, leaving the stand-in forever.
 */
export async function loadCachedGltf(
  loader: GLTFLoader,
  url: string,
  onProgress?: (ratio: number) => void,
): Promise<GLTF> {
  return withAssetFetchRetries(url, () =>
    loader.loadAsync(url, (ev) => {
      if (!onProgress) return
      onProgress(assetLoadRatio(ev.loaded, ev.total))
    }),
  )
}

export async function preloadCharacterAssets(urls: string[]): Promise<void> {
  const unique = [...new Set(urls.map((u) => u.trim()).filter(Boolean))]
  await Promise.all(unique.map((url) => fetchCachedArrayBuffer(url).catch(() => undefined)))
}
