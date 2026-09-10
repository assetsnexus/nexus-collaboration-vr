import {
  CHARACTER_SKILL,
  type ChatCompletionTool,
} from '@nexus/character-kit'
import type { ChatCompletionResponse, ChatMessage, HermesConfig } from './hermes'
import { HermesFetchError, hermesTrustUrl } from './hermes'
import { isChatAbortError, playgroundFetchBase, withChatTimeout } from './llm-endpoint'

export interface ToolsLlmConfig {
  /** e.g. https://openrouter.ai/api/v1 or empty to use cfg.baseUrl */
  baseUrl: string
  apiKey: string
  model: string
  sessionId?: string
}

/**
 * OpenAI-compatible chat with real client-side tool_calls (OpenRouter, etc.).
 * Hermes gateway executes tools server-side and is NOT suitable for VRM tools.
 */
export async function toolsChat(
  cfg: ToolsLlmConfig,
  messages: ChatMessage[],
  options: {
    tools?: ChatCompletionTool[]
    signal?: AbortSignal
  } = {},
): Promise<ChatCompletionResponse> {
  const base = playgroundFetchBase(cfg.baseUrl)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (cfg.apiKey.trim()) {
    headers.Authorization = `Bearer ${cfg.apiKey.trim()}`
  }
  if (cfg.baseUrl.includes('openrouter') || base.includes('openrouter')) {
    headers['HTTP-Referer'] = typeof location !== 'undefined' ? location.origin : 'http://localhost'
    headers['X-Title'] = 'AI Agent VRM'
  }

  let res: Response
  try {
    res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers,
      signal: withChatTimeout(options.signal),
      body: JSON.stringify({
        model: cfg.model,
        messages,
        tools: options.tools ?? CHARACTER_SKILL.allTools(),
        tool_choice: 'auto',
      }),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (isChatAbortError(err)) {
      throw new HermesFetchError(
        `Chat request timed out (${msg}). Check the OpenAI-compatible base URL.`,
        'network',
        hermesTrustUrl(cfg.baseUrl),
      )
    }
    throw new HermesFetchError(`Tools LLM fetch failed: ${msg}`, 'network', hermesTrustUrl(cfg.baseUrl))
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new HermesFetchError(`Tools LLM ${res.status}: ${body.slice(0, 500)}`, 'http')
  }

  return (await res.json()) as ChatCompletionResponse
}

/** Map Hermes pane config → OpenRouter tools endpoint when using tools runtime. */
export function openRouterFromEnv(model: string): ToolsLlmConfig | null {
  const key = import.meta.env.VITE_OPENROUTER_API_KEY as string | undefined
  if (!key?.trim()) return null
  return {
    baseUrl: (import.meta.env.VITE_OPENROUTER_BASE_URL as string) || 'https://openrouter.ai/api/v1',
    apiKey: key,
    model: model.includes('/') ? model : `openai/${model}`,
  }
}

export function hermesAsToolsIncompatible(_cfg: HermesConfig): boolean {
  return true
}
