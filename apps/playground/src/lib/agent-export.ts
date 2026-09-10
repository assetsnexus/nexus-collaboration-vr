/** Clipboard / JSON transfer for playground agent tabs. */

export const AGENT_EXPORT_KIND = 'openclaw.dev-vrm.agent'
export const AGENT_EXPORT_VERSION = 1

export interface AgentExportOverlayItem {
  sourceId: string
  itemId: string
  transform?: Record<string, unknown>
}

export interface AgentExportWardrobe {
  clothesId?: string
  clothesIds?: string[]
  clothesOverlayId?: string
  clothesOverlayItems?: AgentExportOverlayItem[]
}

/** Portable agent fields — no runtime id, session, messages, or error state. */
export interface AgentExportConfig {
  label: string
  baseUrl?: string
  apiKey?: string
  model?: string
  vocabulary?: string[]
  defaultMood?: string
  vrmUrl?: string
  clothesId?: string
  clothesIds?: string[]
  clothesOverlayId?: string
  clothesOverlayItems?: AgentExportOverlayItem[]
  wardrobeByModel?: Record<string, AgentExportWardrobe>
}

export interface AgentExportEnvelope {
  kind: typeof AGENT_EXPORT_KIND
  version: number
  agent: AgentExportConfig
}

export type ParseAgentExportResult =
  | { ok: true; agent: AgentExportConfig }
  | { ok: false; error: string }

export interface AgentPaneLike {
  label: string
  baseUrl?: string
  apiKey?: string
  model?: string
  vocabulary?: string[]
  defaultMood?: string
  vrmUrl?: string
  clothesId?: string
  clothesIds?: string[]
  clothesOverlayId?: string
  clothesOverlayItems?: AgentExportOverlayItem[]
  wardrobeByModel?: Record<string, AgentExportWardrobe>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out = value.map((item) => String(item).trim()).filter(Boolean)
  return out
}

function parseOverlayItems(raw: unknown): AgentExportOverlayItem[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: AgentExportOverlayItem[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (!isRecord(item)) continue
    const sourceId = asNonEmptyString(item.sourceId)
    const itemId = asNonEmptyString(item.itemId)
    if (!sourceId || !itemId) continue
    const key = `${sourceId}::${itemId}`
    if (seen.has(key)) continue
    seen.add(key)
    const transform = isRecord(item.transform) ? item.transform : undefined
    out.push(transform ? { sourceId, itemId, transform } : { sourceId, itemId })
  }
  return out.length ? out : undefined
}

function parseWardrobe(raw: unknown): AgentExportWardrobe | undefined {
  if (!isRecord(raw)) return undefined
  const clothesIds = asStringArray(raw.clothesIds)
  const items = parseOverlayItems(raw.clothesOverlayItems)
  const slot: AgentExportWardrobe = {
    clothesId: asString(raw.clothesId),
    clothesIds,
    clothesOverlayId: asNonEmptyString(raw.clothesOverlayId),
    clothesOverlayItems: items,
  }
  if (
    slot.clothesId === undefined &&
    slot.clothesIds === undefined &&
    slot.clothesOverlayId === undefined &&
    slot.clothesOverlayItems === undefined
  ) {
    return undefined
  }
  return slot
}

function parseWardrobeMap(raw: unknown): Record<string, AgentExportWardrobe> | undefined {
  if (!isRecord(raw)) return undefined
  const out: Record<string, AgentExportWardrobe> = {}
  for (const [key, value] of Object.entries(raw)) {
    const id = key.trim()
    if (!id) continue
    const slot = parseWardrobe(value)
    if (slot) out[id] = slot
  }
  return Object.keys(out).length ? out : undefined
}

function looksLikeSettingsBlob(raw: Record<string, unknown>): boolean {
  return (
    ('sttProvider' in raw || 'llmRuntime' in raw) &&
    !asNonEmptyString(raw.label) &&
    !isRecord(raw.agent)
  )
}

export function parseAgentConfig(raw: unknown): ParseAgentExportResult {
  if (!isRecord(raw)) {
    return { ok: false, error: 'Agent config must be a JSON object' }
  }
  if (looksLikeSettingsBlob(raw)) {
    return { ok: false, error: 'That JSON looks like playground settings, not an agent' }
  }

  const kind = asString(raw.kind)
  if (kind !== undefined && kind !== AGENT_EXPORT_KIND) {
    return { ok: false, error: `Unknown export kind: ${kind}` }
  }

  const nested = isRecord(raw.agent) ? raw.agent : raw
  const label = asNonEmptyString(nested.label)
  if (!label) {
    return { ok: false, error: 'Agent config needs a label' }
  }

  const hasIdentity =
    asString(nested.baseUrl) !== undefined ||
    asString(nested.vrmUrl) !== undefined ||
    asString(nested.model) !== undefined ||
    asString(nested.apiKey) !== undefined ||
    Array.isArray(nested.vocabulary) ||
    nested.defaultMood !== undefined ||
    nested.clothesIds !== undefined ||
    nested.clothesId !== undefined ||
    nested.wardrobeByModel !== undefined ||
    kind === AGENT_EXPORT_KIND

  if (!hasIdentity) {
    return { ok: false, error: 'JSON is missing agent fields (URL, model, or avatar)' }
  }

  const agent: AgentExportConfig = { label }
  const baseUrl = asString(nested.baseUrl)
  const apiKey = asString(nested.apiKey)
  const model = asNonEmptyString(nested.model)
  const vocabulary = asStringArray(nested.vocabulary)
  const defaultMood = asNonEmptyString(nested.defaultMood)
  const vrmUrl = asString(nested.vrmUrl)
  const clothesId = asString(nested.clothesId)
  const clothesIds = asStringArray(nested.clothesIds)
  const clothesOverlayId = asNonEmptyString(nested.clothesOverlayId)
  const clothesOverlayItems = parseOverlayItems(nested.clothesOverlayItems)
  const wardrobeByModel = parseWardrobeMap(nested.wardrobeByModel)

  if (baseUrl !== undefined) agent.baseUrl = baseUrl
  if (apiKey !== undefined) agent.apiKey = apiKey
  if (model) agent.model = model
  if (vocabulary) agent.vocabulary = vocabulary
  if (defaultMood) agent.defaultMood = defaultMood
  if (vrmUrl !== undefined) agent.vrmUrl = vrmUrl
  if (clothesId !== undefined) agent.clothesId = clothesId
  if (clothesIds) agent.clothesIds = clothesIds
  if (clothesOverlayId) agent.clothesOverlayId = clothesOverlayId
  if (clothesOverlayItems) agent.clothesOverlayItems = clothesOverlayItems
  if (wardrobeByModel) agent.wardrobeByModel = wardrobeByModel

  return { ok: true, agent }
}

export function parseAgentExport(text: string): ParseAgentExportResult {
  const trimmed = text.trim()
  if (!trimmed) return { ok: false, error: 'Nothing to import' }
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return { ok: false, error: 'Clipboard text is not valid JSON' }
  }
  if (Array.isArray(parsed)) {
    if (parsed.length !== 1) {
      return { ok: false, error: 'Paste a single agent object, not a list' }
    }
    return parseAgentConfig(parsed[0])
  }
  return parseAgentConfig(parsed)
}

export function portableConfigFromPane(pane: AgentPaneLike): AgentExportConfig {
  const parsed = parseAgentConfig({
    kind: AGENT_EXPORT_KIND,
    label: pane.label,
    baseUrl: pane.baseUrl,
    apiKey: pane.apiKey,
    model: pane.model,
    vocabulary: pane.vocabulary,
    defaultMood: pane.defaultMood,
    vrmUrl: pane.vrmUrl,
    clothesId: pane.clothesId,
    clothesIds: pane.clothesIds,
    clothesOverlayId: pane.clothesOverlayId,
    clothesOverlayItems: pane.clothesOverlayItems,
    wardrobeByModel: pane.wardrobeByModel,
  })
  if (!parsed.ok) {
    return { label: pane.label.trim() || 'Agent' }
  }
  return parsed.agent
}

export function stringifyAgentExport(pane: AgentPaneLike): string {
  const envelope: AgentExportEnvelope = {
    kind: AGENT_EXPORT_KIND,
    version: AGENT_EXPORT_VERSION,
    agent: portableConfigFromPane(pane),
  }
  return `${JSON.stringify(envelope, null, 2)}\n`
}

export function summarizeAgentExport(agent: AgentExportConfig): string {
  const bits = [agent.label]
  if (agent.defaultMood) bits.push(agent.defaultMood)
  if (agent.vrmUrl) {
    const file = agent.vrmUrl.split('/').pop()?.replace(/\.vrm$/i, '')
    if (file) bits.push(file)
  }
  if (agent.model) bits.push(agent.model)
  return bits.join(' · ')
}

export function logAgentExport(
  event: string,
  meta: Record<string, unknown> = {},
): void {
  console.info(`[agent-export] ${event}`, meta)
}

export async function writeClipboardText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logAgentExport('clipboard-write-fallback', { reason: msg })
    }
  }
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.position = 'fixed'
  ta.style.top = '0'
  ta.style.left = '0'
  ta.style.width = '2px'
  ta.style.height = '2px'
  ta.style.opacity = '0.01'
  ta.style.pointerEvents = 'none'
  document.body.appendChild(ta)
  ta.focus()
  ta.select()
  ta.setSelectionRange(0, text.length)
  let ok = false
  try {
    ok = document.execCommand('copy')
  } finally {
    document.body.removeChild(ta)
  }
  if (!ok) throw new Error('Clipboard copy is not available')
}

export async function readClipboardText(): Promise<string | null> {
  try {
    if (!navigator.clipboard?.readText) return null
    const text = await navigator.clipboard.readText()
    return text || null
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logAgentExport('clipboard-read-skipped', { reason: msg })
    return null
  }
}
