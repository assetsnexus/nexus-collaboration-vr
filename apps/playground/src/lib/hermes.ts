import { CHARACTER_SKILL, type ChatCompletionTool } from '@nexus/character-kit'
import { chatCompletionsUrl, healthUrl, isChatAbortError, playgroundFetchBase, withChatTimeout } from './llm-endpoint'

export interface HermesConfig {
  baseUrl: string
  apiKey: string
  model: string
  sessionId?: string
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | Array<Record<string, unknown>> | null
  name?: string
  tool_call_id?: string
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
}

export interface ChatCompletionResponse {
  id?: string
  choices: Array<{
    message: ChatMessage
    finish_reason?: string
  }>
}

export class HermesFetchError extends Error {
  readonly kind: 'ssl' | 'network' | 'http'
  readonly trustUrl?: string

  constructor(message: string, kind: 'ssl' | 'network' | 'http', trustUrl?: string) {
    super(message)
    this.name = 'HermesFetchError'
    this.kind = kind
    this.trustUrl = trustUrl
  }
}

/** Origin used for self-signed cert exception (health endpoint). */
export function hermesTrustUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/$/, '')
  if (base.startsWith('/')) {
    return healthUrl(base)
  }
  try {
    const raw = base.includes('://') ? base : `https://${base}`
    const origin = new URL(raw.replace(/\/v1$/i, '')).origin
    return `${origin}/health`
  } catch {
    return healthUrl(base)
  }
}

function isLikelyTlsFailure(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /failed to fetch|ssl|certificate|ERR_CERT|net::ERR_/i.test(msg)
}

export async function hermesChat(
  cfg: HermesConfig,
  messages: ChatMessage[],
  options: {
    tools?: ChatCompletionTool[]
    /** Hermes API is a server-side agent — client OpenAI tools are not executed in-browser. Default: omit. */
    includeTools?: boolean
    signal?: AbortSignal
  } = {},
): Promise<ChatCompletionResponse> {
  const trustUrl = hermesTrustUrl(cfg.baseUrl)
  const completions = chatCompletionsUrl(cfg.baseUrl)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${cfg.apiKey}`,
  }
  if (cfg.sessionId) {
    headers['X-Hermes-Session-Id'] = cfg.sessionId
  }

  const body: Record<string, unknown> = {
    model: cfg.model,
    messages,
  }
  if (options.includeTools) {
    body.tools = options.tools ?? CHARACTER_SKILL.allTools()
    body.tool_choice = 'auto'
  }

  let res: Response
  try {
    res = await fetch(completions, {
      method: 'POST',
      headers,
      signal: withChatTimeout(options.signal),
      body: JSON.stringify(body),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (isChatAbortError(err)) {
      throw new HermesFetchError(
        `Chat request timed out (${msg}). Check Base URL — the host may be unreachable.`,
        'network',
        trustUrl,
      )
    }
    if (isLikelyTlsFailure(err) || playgroundFetchBase(cfg.baseUrl).startsWith('https://')) {
      throw new HermesFetchError(
        `Failed to reach Hermes (${msg}). If using HTTPS with a self-signed cert, open the trust URL, accept the warning, then retry.`,
        'ssl',
        trustUrl,
      )
    }
    throw new HermesFetchError(
      `Failed to reach Hermes (${msg}). Check Base URL / network / CORS.`,
      'network',
      trustUrl,
    )
  }

  if (!res.ok) {
    const bodyText = await res.text().catch(() => '')
    throw new HermesFetchError(`Hermes ${res.status}: ${bodyText.slice(0, 500)}`, 'http', trustUrl)
  }

  return (await res.json()) as ChatCompletionResponse
}

/** Probe health — used by Trust / Check connection. */
export async function hermesHealth(baseUrl: string): Promise<{ ok: boolean; detail: string }> {
  const url = healthUrl(baseUrl)
  try {
    const res = await fetch(url, { method: 'GET' })
    const text = await res.text()
    return { ok: res.ok, detail: `${res.status} ${text.slice(0, 120)}` }
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    }
  }
}

/** Build multimodal user content from text + pasted files (images). */
export async function filesToContentParts(
  text: string,
  files: File[],
): Promise<Array<Record<string, unknown>>> {
  const parts: Array<Record<string, unknown>> = []
  if (text.trim()) parts.push({ type: 'text', text })
  for (const file of files) {
    if (!file.type.startsWith('image/')) {
      parts.push({ type: 'text', text: `[attached file: ${file.name} (${file.type || 'unknown'})]` })
      continue
    }
    const dataUrl = await readAsDataUrl(file)
    parts.push({
      type: 'image_url',
      image_url: { url: dataUrl },
    })
  }
  return parts
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}
