/** Type-only — keeps picture/cache helpers free of a runtime `three` import. */
import type { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'

/** Cache Storage name kept under the WebView/app cache directory (cleared with OS "clear cache"). */
export const CHARACTER_ASSET_CACHE = 'nexus-avatar-assets-v1'
/** @deprecated Prefer CHARACTER_ASSET_CACHE (`nexus-avatar-assets-v1`). */
export const LEGACY_CHARACTER_ASSET_CACHE = 'openclaw-character-assets-v1'

export const MIN_ASSET_BYTES = 8
/** Default TTL: 7 days. Overridable per put / fetch. */
export const DEFAULT_ASSET_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const FETCHED_AT_HEADER = 'X-Nexus-Fetched-At'
export const TTL_MS_HEADER = 'X-Nexus-Ttl-Ms'
/** Synthetic Request URL prefix when the cache key is a catalog asset id. */
export const ASSET_ID_CACHE_PREFIX = 'https://nexus.local/avatar-asset/'

/** Total tries including the first (VPN / ERR_NETWORK_CHANGED often needs a few). */
export const ASSET_FETCH_ATTEMPTS = 5
/** First retry delay; doubles each subsequent retry (300 → 600 → 1200 → 2400). */
export const ASSET_FETCH_RETRY_BASE_MS = 300

export type AvatarAssetCacheEntryMeta = {
  fetchedAt: number
  ttlMs: number
  contentType: string
}

export type AvatarAssetCacheStored = AvatarAssetCacheEntryMeta & {
  data: ArrayBuffer
}

/**
 * Optional native fallback when Cache API is missing.
 * Host must store blobs under the OS cache dir (Android `getCacheDir` / iOS Caches) —
 * the OS may delete them at any time; never use documents/filesDir.
 */
export type AvatarAssetCacheBackend = {
  get(cacheKey: string): Promise<AvatarAssetCacheStored | null>
  put(cacheKey: string, entry: AvatarAssetCacheStored): Promise<void>
  delete(cacheKey: string): Promise<void>
}

export type AvatarAssetCacheKeyInput = {
  /** Canonical public serve URL (preferred when no assetId). */
  url?: string | null
  /** Catalog asset id — shared across users for the same public asset. */
  assetId?: string | null
  /** Ignored: public assets must not be keyed per account. */
  userId?: string | null
}

export type AvatarAssetStoreDecisionInput = {
  url: string
  /** Owner-local studio preview — never write into the shared cache. */
  previewUnverified?: boolean
  validationStatus?: string | null
}

export type FetchCachedOptions = {
  assetId?: string | null
  userId?: string | null
  previewUnverified?: boolean
  validationStatus?: string | null
  ttlMs?: number
  nowMs?: number
  onProgress?: (ratio: number) => void
}

let nativeBackend: AvatarAssetCacheBackend | null = null

/** Register a native FS cache backend (bridge). Pass null to clear. */
export function setAvatarAssetCacheBackend(backend: AvatarAssetCacheBackend | null): void {
  nativeBackend = backend
}

export function getAvatarAssetCacheBackend(): AvatarAssetCacheBackend | null {
  return nativeBackend
}

export function resourcePathForUrl(url: string): string {
  const q = url.split('?')[0] || url
  const slash = q.lastIndexOf('/')
  return slash >= 0 ? q.slice(0, slash + 1) : ''
}

/** Strip fragment; keep query (CDN versioning). Does not incorporate userId. */
export function canonicalizePublicAssetUrl(url: string): string {
  return (url || '').trim().split('#')[0] || ''
}

/**
 * Shared cache key: catalog asset id when present, else canonical public URL.
 * `userId` is intentionally ignored so two accounts share the same entry.
 */
export function avatarAssetCacheKey(input: AvatarAssetCacheKeyInput): string {
  const assetId = (input.assetId || '').trim()
  if (assetId) return `${ASSET_ID_CACHE_PREFIX}${encodeURIComponent(assetId)}`
  return canonicalizePublicAssetUrl(input.url || '')
}

export function shouldPersistAssetUrl(url: string): boolean {
  const trimmed = url.trim()
  if (!trimmed) return false
  if (/^(blob:|data:|file:)/i.test(trimmed)) return false
  return /^(https?:)?\/\//i.test(trimmed) || trimmed.startsWith('/')
}

/**
 * Whether bytes may be written into the shared OS-clearable cache.
 * Skips blob/data/file and owner-preview (`previewUnverified`) payloads.
 */
export function shouldStoreAvatarAsset(input: AvatarAssetStoreDecisionInput): boolean {
  if (input.previewUnverified === true) return false
  return shouldPersistAssetUrl(input.url)
}

export function isAvatarAssetCacheEntryFresh(
  fetchedAt: number,
  ttlMs: number,
  nowMs: number = Date.now(),
): boolean {
  if (!Number.isFinite(fetchedAt) || fetchedAt <= 0) return false
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) return false
  return nowMs < fetchedAt + ttlMs
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

function cacheApiAvailable(): boolean {
  return typeof caches !== 'undefined' && typeof caches.open === 'function'
}

function readEntryMeta(res: Response): AvatarAssetCacheEntryMeta | null {
  const fetchedAt = Number(res.headers.get(FETCHED_AT_HEADER) || '')
  const ttlMs = Number(res.headers.get(TTL_MS_HEADER) || '')
  if (!Number.isFinite(fetchedAt) || !Number.isFinite(ttlMs)) return null
  return {
    fetchedAt,
    ttlMs,
    contentType: res.headers.get('Content-Type') || 'application/octet-stream',
  }
}

async function cacheApiGet(
  cacheKey: string,
  sourceUrl: string,
  nowMs: number,
): Promise<AvatarAssetCacheStored | null> {
  if (!cacheApiAvailable() || !cacheKey) return null
  try {
    const cache = await caches.open(CHARACTER_ASSET_CACHE)
    const hit = await cache.match(cacheKey)
    if (!hit || !hit.ok) return null
    const meta = readEntryMeta(hit)
    if (!meta || !isAvatarAssetCacheEntryFresh(meta.fetchedAt, meta.ttlMs, nowMs)) {
      await cache.delete(cacheKey)
      return null
    }
    const data = await hit.arrayBuffer()
    if (!assetBodyLooksValid(sourceUrl || cacheKey, data)) {
      await cache.delete(cacheKey)
      return null
    }
    return { data, ...meta }
  } catch {
    return null
  }
}

async function cacheApiPut(
  cacheKey: string,
  sourceUrl: string,
  data: ArrayBuffer,
  contentType: string,
  ttlMs: number,
  fetchedAt: number,
): Promise<void> {
  if (!cacheApiAvailable() || !cacheKey) return
  if (!assetBodyLooksValid(sourceUrl || cacheKey, data)) return
  try {
    const cache = await caches.open(CHARACTER_ASSET_CACHE)
    await cache.put(
      cacheKey,
      new Response(data.slice(0), {
        headers: {
          'Content-Type': contentType || 'application/octet-stream',
          [FETCHED_AT_HEADER]: String(fetchedAt),
          [TTL_MS_HEADER]: String(ttlMs),
        },
      }),
    )
  } catch {
    /* quota / private mode */
  }
}

async function persistGet(
  cacheKey: string,
  sourceUrl: string,
  nowMs: number,
): Promise<AvatarAssetCacheStored | null> {
  if (!cacheKey) return null
  const fromApi = await cacheApiGet(cacheKey, sourceUrl, nowMs)
  if (fromApi) return fromApi
  if (!nativeBackend) return null
  try {
    const hit = await nativeBackend.get(cacheKey)
    if (!hit) return null
    if (!isAvatarAssetCacheEntryFresh(hit.fetchedAt, hit.ttlMs, nowMs)) {
      await nativeBackend.delete(cacheKey)
      return null
    }
    if (!assetBodyLooksValid(sourceUrl || cacheKey, hit.data)) {
      await nativeBackend.delete(cacheKey)
      return null
    }
    return hit
  } catch {
    return null
  }
}

async function persistPut(
  cacheKey: string,
  sourceUrl: string,
  data: ArrayBuffer,
  contentType: string,
  ttlMs: number,
  store: boolean,
): Promise<void> {
  if (!store || !cacheKey) return
  if (!assetBodyLooksValid(sourceUrl || cacheKey, data)) return
  const fetchedAt = Date.now()
  if (cacheApiAvailable()) {
    await cacheApiPut(cacheKey, sourceUrl, data, contentType, ttlMs, fetchedAt)
    return
  }
  if (!nativeBackend) return
  try {
    await nativeBackend.put(cacheKey, {
      data: data.slice(0),
      contentType: contentType || 'application/octet-stream',
      fetchedAt,
      ttlMs,
    })
  } catch {
    /* native write failed */
  }
}

async function readResponseBody(
  res: Response,
  onProgress?: (ratio: number) => void,
): Promise<ArrayBuffer> {
  const total = Number(res.headers.get('Content-Length') || '') || 0
  if (!res.body || !onProgress) {
    const data = await res.arrayBuffer()
    onProgress?.(assetLoadRatio(data.byteLength, total > 0 ? total : data.byteLength))
    return data
  }
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let loaded = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      chunks.push(value)
      loaded += value.byteLength
      onProgress(assetLoadRatio(loaded, total))
    }
  }
  const out = new Uint8Array(loaded)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  if (total <= 0) onProgress(1)
  return out.buffer
}

/** Fetch a VRM/VRMA/JSON/picture body, preferring Cache Storage (with TTL) then HTTP. */
export async function fetchCachedArrayBuffer(
  url: string,
  opts: FetchCachedOptions = {},
): Promise<ArrayBuffer> {
  const cacheKey = avatarAssetCacheKey({
    url,
    assetId: opts.assetId,
    userId: opts.userId,
  })
  const nowMs = opts.nowMs ?? Date.now()
  const store = shouldStoreAvatarAsset({
    url,
    previewUnverified: opts.previewUnverified,
    validationStatus: opts.validationStatus,
  })

  if (store) {
    const cached = await persistGet(cacheKey, url, nowMs)
    if (cached) {
      opts.onProgress?.(1)
      return cached.data
    }
  }

  return withAssetFetchRetries(url, async () => {
    const res = await fetch(url)
    if (!res.ok) {
      throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`)
    }
    const data = await readResponseBody(res, opts.onProgress)
    if (!assetBodyLooksValid(url, data)) {
      throw new Error(`Failed to fetch ${url}: empty or invalid body (${data.byteLength} bytes)`)
    }
    await persistPut(
      cacheKey,
      url,
      data,
      res.headers.get('Content-Type') || 'application/octet-stream',
      opts.ttlMs ?? DEFAULT_ASSET_TTL_MS,
      store,
    )
    return data
  })
}

/**
 * Picture / portrait avatar helper — same shared Cache API store as VRM/VRMA.
 * Returns an object URL the caller should eventually revoke.
 */
export async function fetchCachedPictureObjectUrl(
  url: string,
  opts: FetchCachedOptions = {},
): Promise<string> {
  const data = await fetchCachedArrayBuffer(url, opts)
  const type = guessPictureMime(url)
  const blob = new Blob([new Uint8Array(data)], { type })
  return URL.createObjectURL(blob)
}

function guessPictureMime(url: string): string {
  const path = (url.split('?')[0] || '').toLowerCase()
  if (path.endsWith('.png')) return 'image/png'
  if (path.endsWith('.webp')) return 'image/webp'
  if (path.endsWith('.gif')) return 'image/gif'
  if (path.endsWith('.svg')) return 'image/svg+xml'
  return 'image/jpeg'
}

function parseGltfFromArrayBuffer(loader: GLTFLoader, url: string, data: ArrayBuffer): Promise<GLTF> {
  return new Promise((resolve, reject) => {
    loader.parse(
      data,
      resourcePathForUrl(url),
      (gltf) => resolve(gltf),
      (err) => reject(err instanceof Error ? err : new Error(String(err))),
    )
  })
}

/**
 * Load a GLTF/VRM/VRMA through the shared avatar asset cache.
 * Cache hits parse from ArrayBuffer (no second network round-trip).
 */
export async function loadCachedGltf(
  loader: GLTFLoader,
  url: string,
  onProgress?: (ratio: number) => void,
  opts: FetchCachedOptions = {},
): Promise<GLTF> {
  const cacheKey = avatarAssetCacheKey({
    url,
    assetId: opts.assetId,
    userId: opts.userId,
  })
  const nowMs = opts.nowMs ?? Date.now()
  const store = shouldStoreAvatarAsset({
    url,
    previewUnverified: opts.previewUnverified,
    validationStatus: opts.validationStatus,
  })

  if (store) {
    const cached = await persistGet(cacheKey, url, nowMs)
    if (cached) {
      onProgress?.(1)
      return parseGltfFromArrayBuffer(loader, url, cached.data)
    }
  }

  return withAssetFetchRetries(url, async () => {
    const res = await fetch(url)
    if (!res.ok) {
      throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`)
    }
    const data = await readResponseBody(res, onProgress)
    if (!assetBodyLooksValid(url, data)) {
      throw new Error(`Failed to fetch ${url}: empty or invalid body (${data.byteLength} bytes)`)
    }
    await persistPut(
      cacheKey,
      url,
      data,
      res.headers.get('Content-Type') || 'application/octet-stream',
      opts.ttlMs ?? DEFAULT_ASSET_TTL_MS,
      store,
    )
    return parseGltfFromArrayBuffer(loader, url, data)
  })
}

export async function preloadCharacterAssets(
  urls: string[],
  opts: FetchCachedOptions = {},
): Promise<void> {
  const unique = [...new Set(urls.map((u) => u.trim()).filter(Boolean))]
  await Promise.all(
    unique.map((url) =>
      fetchCachedArrayBuffer(url, { ...opts, onProgress: undefined }).catch(() => undefined),
    ),
  )
}
