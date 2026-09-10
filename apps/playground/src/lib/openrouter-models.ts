/** Default per-agent chat model (OpenRouter id). */
export const DEFAULT_CHAT_MODEL = 'deepseek/deepseek-v4-flash'

export interface FavoriteModel {
  id: string
  /** Compact chip / button label */
  label: string
  hint: string
}

/** Pinned at the top of the picker. Order matches the product shortlist. */
export const FAVORITE_MODELS: FavoriteModel[] = [
  { id: 'openai/gpt-5.5', label: 'GPT', hint: 'GPT-5.5' },
  { id: 'anthropic/claude-sonnet-5', label: 'Sonnet', hint: 'Claude Sonnet 5' },
  { id: 'deepseek/deepseek-v4-flash', label: 'DS Flash', hint: 'DeepSeek V4 Flash' },
  { id: 'deepseek/deepseek-v4-pro', label: 'DS Pro', hint: 'DeepSeek V4 Pro' },
  { id: 'x-ai/grok-4.6', label: 'Grok 4.6', hint: 'Grok 4.6' },
]

export const FAVORITE_MODEL_IDS = new Set(FAVORITE_MODELS.map((m) => m.id))

export interface OpenRouterCatalogModel {
  id: string
  name: string
  prompt: number
  completion: number
}

interface OpenRouterModelsResponse {
  data?: Array<{
    id?: unknown
    name?: unknown
    pricing?: { prompt?: unknown; completion?: unknown }
  }>
}

const CACHE_TTL_MS = 6 * 60 * 60 * 1000
let memoryCache: { at: number; models: OpenRouterCatalogModel[] } | null = null
let inflight: Promise<OpenRouterCatalogModel[]> | null = null

function parsePrice(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw)
  return Number.isFinite(n) ? n : 0
}

export function isFreeOpenRouterModel(model: {
  id: string
  prompt: number
  completion: number
}): boolean {
  const id = model.id.toLowerCase()
  if (id.includes(':free') || id.endsWith('/free')) return true
  return model.prompt <= 0 && model.completion <= 0
}

export function isListedChatModel(model: OpenRouterCatalogModel): boolean {
  if (!model.id || model.id.startsWith('~')) return false
  if (model.id.includes(':batch')) return false
  if (isFreeOpenRouterModel(model)) return false
  return true
}

export function parseOpenRouterModels(payload: unknown): OpenRouterCatalogModel[] {
  const data = (payload as OpenRouterModelsResponse)?.data
  if (!Array.isArray(data)) return []
  const out: OpenRouterCatalogModel[] = []
  const seen = new Set<string>()
  for (const row of data) {
    const id = String(row?.id ?? '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    const model: OpenRouterCatalogModel = {
      id,
      name: String(row?.name ?? id),
      prompt: parsePrice(row?.pricing?.prompt),
      completion: parsePrice(row?.pricing?.completion),
    }
    if (!isListedChatModel(model)) continue
    out.push(model)
  }
  return out
}

export function shortModelLabel(id: string): string {
  const fav = FAVORITE_MODELS.find((m) => m.id === id)
  if (fav) return fav.label
  const slug = id.split('/').pop() ?? id
  return slug.replace(/:.*$/, '')
}

export function matchesModelQuery(model: { id: string; name: string }, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const hay = `${model.id} ${model.name}`.toLowerCase()
  return q.split(/\s+/).every((tok) => hay.includes(tok))
}

export function filterCatalog(
  models: OpenRouterCatalogModel[],
  query: string,
): { favorites: FavoriteModel[]; rest: OpenRouterCatalogModel[] } {
  const favorites = FAVORITE_MODELS.filter((fav) =>
    matchesModelQuery({ id: fav.id, name: `${fav.label} ${fav.hint}` }, query),
  )
  const favIds = new Set(FAVORITE_MODELS.map((m) => m.id))
  const rest = models.filter((m) => !favIds.has(m.id) && matchesModelQuery(m, query))
  return { favorites, rest }
}

export function peekOpenRouterModels(): OpenRouterCatalogModel[] | null {
  if (memoryCache && Date.now() - memoryCache.at < CACHE_TTL_MS) return memoryCache.models
  return null
}

export async function loadOpenRouterModels(opts: {
  baseUrl: string
  apiKey?: string
  force?: boolean
}): Promise<OpenRouterCatalogModel[]> {
  const now = Date.now()
  if (!opts.force && memoryCache && now - memoryCache.at < CACHE_TTL_MS) {
    return memoryCache.models
  }
  if (inflight && !opts.force) return inflight

  inflight = (async () => {
    const base = (opts.baseUrl || 'https://openrouter.ai/api/v1').replace(/\/$/, '')
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (opts.apiKey?.trim()) headers.Authorization = `Bearer ${opts.apiKey.trim()}`
    const res = await fetch(`${base}/models`, { headers })
    if (!res.ok) {
      throw new Error(`OpenRouter models ${res.status}`)
    }
    const models = parseOpenRouterModels(await res.json())
    memoryCache = { at: Date.now(), models }
    return models
  })()

  try {
    return await inflight
  } finally {
    inflight = null
  }
}

/** Old playground default — migrate to DS Flash so existing panes pick up the new default. */
export function migrateChatModel(raw: string | undefined | null): string {
  const id = (raw ?? '').trim()
  if (!id || id === 'openai/gpt-4o-mini' || id === 'gpt-4o-mini') return DEFAULT_CHAT_MODEL
  return id
}
