/** OpenAI-compatible chat URL helpers for the playground. */

/** Vite dev proxy prefix (see vite.config.ts). */
export const LLM_PROXY = '/api/llm'
export const LLM_HTTPS_DEFAULT = 'https://127.0.0.1:8443'
export const LLM_HTTP_DEFAULT = 'http://127.0.0.1:8080'

export const CHAT_FETCH_TIMEOUT_MS = 90_000

export function withChatTimeout(signal?: AbortSignal, timeoutMs = CHAT_FETCH_TIMEOUT_MS): AbortSignal {
  const timeout =
    typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(timeoutMs)
      : (() => {
          const c = new AbortController()
          setTimeout(() => c.abort(new DOMException('chat timeout', 'TimeoutError')), timeoutMs)
          return c.signal
        })()
  if (!signal) return timeout
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([signal, timeout])
  return timeout
}

export function isChatAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const name = (err as { name?: string }).name
  return name === 'AbortError' || name === 'TimeoutError'
}

function trimBase(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

function stripV1(url: string): string {
  return trimBase(url).replace(/\/v1$/i, '')
}

export function hasOpenAiV1Path(baseUrl: string): boolean {
  return /\/v1$/i.test(trimBase(baseUrl))
}

export function isOpenAiCompatBase(baseUrl: string): boolean {
  const u = trimBase(baseUrl)
  if (!u) return false
  if (hasOpenAiV1Path(u)) return true
  return /openrouter\.ai/i.test(u)
}

/** Relative Vite proxy or a same-origin `/api/llm` gateway (no client tools). */
export function isHermesGatewayBase(baseUrl: string): boolean {
  const u = stripV1(baseUrl)
  if (!u) return false
  if (/^\/api\/llm(\/|$)/i.test(u)) return true
  if (/^\/api\/hermes(\/|$)/i.test(u)) return true
  return false
}

/**
 * Rewrite stale playground localStorage bases onto the generic Vite proxy.
 * OpenAI-style `…/v1` URLs are left alone.
 */
export function migrateLegacyHermesBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim()
  const u = trimBase(trimmed)
  if (hasOpenAiV1Path(u)) return trimmed
  if (/^\/api\/hermes(\/|$)/i.test(u)) return LLM_PROXY
  if (u === LLM_HTTP_DEFAULT) return LLM_HTTPS_DEFAULT
  return trimmed
}

/**
 * Browser-fetch base: local HTTP gateway traffic can go through the Vite proxy (CORS).
 * HTTPS and custom OpenAI hosts are left as typed.
 */
export function playgroundFetchBase(baseUrl: string): string {
  const u = trimBase(baseUrl)
  const v1 = hasOpenAiV1Path(u)
  const origin = v1 ? stripV1(u) : u
  if (origin === LLM_HTTP_DEFAULT) {
    return v1 ? `${LLM_PROXY}/v1` : LLM_PROXY
  }
  if (/^\/api\/hermes(\/|$)/i.test(origin)) {
    return v1 ? `${LLM_PROXY}/v1` : LLM_PROXY
  }
  return u
}

export function chatCompletionsUrl(baseUrl: string): string {
  const base = playgroundFetchBase(baseUrl)
  if (hasOpenAiV1Path(base)) return `${base}/chat/completions`
  return `${base}/v1/chat/completions`
}

export function healthUrl(baseUrl: string): string {
  return `${stripV1(playgroundFetchBase(baseUrl))}/health`
}

export function paneUsesHermesChat(runtime: 'tools' | 'hermes', baseUrl: string): boolean {
  if (runtime === 'hermes') return true
  return isHermesGatewayBase(baseUrl) && isOpenAiCompatBase(baseUrl)
}

export type ToolsEndpointSource = 'pane' | 'openrouter'

export interface ToolsEndpoint {
  baseUrl: string
  apiKey: string
  source: ToolsEndpointSource
}

/**
 * Tools runtime: use the agent pane when its base URL is OpenAI-compatible
 * (`/v1` or OpenRouter). Bare gateway hosts keep using the global OpenRouter key.
 */
export function resolveToolsEndpoint(opts: {
  paneBaseUrl: string
  paneApiKey: string
  openrouterBaseUrl: string
  openrouterApiKey: string
}): ToolsEndpoint {
  const paneUrl = opts.paneBaseUrl.trim()
  const paneKey = opts.paneApiKey.trim()
  const orUrl = opts.openrouterBaseUrl.trim() || 'https://openrouter.ai/api/v1'
  const orKey = opts.openrouterApiKey.trim()

  if (paneUrl && isOpenAiCompatBase(paneUrl)) {
    return { baseUrl: paneUrl, apiKey: paneKey || orKey, source: 'pane' }
  }
  return { baseUrl: orUrl, apiKey: orKey, source: 'openrouter' }
}
