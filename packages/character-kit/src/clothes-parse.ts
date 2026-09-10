import type { ClothesOverlayPiece } from './clothes-transform.js'

export const CLOTHES_NONE_ID = 'none'
export const CLOTHES_DEFAULT_ID = 'default'

export type ClothesCategory =
  | 'tops'
  | 'bottoms'
  | 'shoes'
  | 'onepiece'
  | 'accessory'
  | 'other'

export type ClothesSelectMode = 'none' | 'default' | 'items'

export interface ClothesItem {
  id: string
  label: string
  category: ClothesCategory
}

export interface ClothesGroup {
  category: ClothesCategory
  label: string
  items: ClothesItem[]
}

export interface ClothesSelection {
  mode: ClothesSelectMode
  /** Item or category ids when mode is `items`. */
  ids: string[]
}

export interface ClothesSpec {
  /** none | default | catalog id | native group id | tops+shoes */
  id?: string
  /** Visible native item/category ids. Empty means none; omit with no id means default. */
  ids?: string[]
  /**
   * Legacy full-outfit overlay URL. Used only when `overlayPieces` is omitted:
   * all clothing from that VRM is added on top of native slots.
   */
  url?: string | null
  /** Additive overlay pieces (combinable with native clothes). */
  overlayPieces?: ClothesOverlayPiece[]
}

export const CLOTHES_CATEGORY_ORDER: ClothesCategory[] = [
  'tops',
  'bottoms',
  'onepiece',
  'shoes',
  'accessory',
  'other',
]

export const CLOTHES_CATEGORY_LABEL: Record<ClothesCategory, string> = {
  tops: 'Tops',
  bottoms: 'Bottoms',
  shoes: 'Shoes',
  onepiece: 'Onepiece',
  accessory: 'Accessory',
  other: 'Clothes',
}

const VROID_ITEM_RE = /N\d+_(\d+)_\d+_(Tops|Bottoms|Shoes|Onepiece)_/i
const SIMPLE_CLOTH_RE = /(Tops|Bottoms|Shoes|Onepiece)(?:_|$)/i

export function isReservedClothesId(id: string): boolean {
  return id === CLOTHES_NONE_ID || id === CLOTHES_DEFAULT_ID
}

export function normalizeClothesId(raw: string | undefined | null): string {
  const id = (raw ?? '').trim()
  if (!id) return CLOTHES_DEFAULT_ID
  const lower = id.toLowerCase()
  if (lower === CLOTHES_NONE_ID || lower === 'off' || lower === 'naked' || lower === 'undressed') {
    return CLOTHES_NONE_ID
  }
  if (lower === CLOTHES_DEFAULT_ID || lower === 'all' || lower === 'model' || lower === 'native') {
    return CLOTHES_DEFAULT_ID
  }
  return id
}

function stripInstanceSuffix(name: string): string {
  return name.replace(/\s*\(Instance\)\s*$/i, '').trim()
}

function uniqueIds(ids: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of ids) {
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

function categoryFromToken(token: string): ClothesCategory {
  const k = token.toLowerCase()
  if (k === 'tops') return 'tops'
  if (k === 'bottoms') return 'bottoms'
  if (k === 'shoes') return 'shoes'
  if (k === 'onepiece') return 'onepiece'
  if (k === 'accessory') return 'accessory'
  return 'other'
}

function accessoryItem(name: string): ClothesItem {
  const m = name.match(/Accessory_([A-Za-z0-9]+)/i)
  let key = m?.[1] ?? 'accessory'
  if (/^Glasses/i.test(key)) key = 'glasses'
  const id = `accessory-${key.toLowerCase()}`
  const label =
    key.toLowerCase() === 'glasses'
      ? 'Glasses'
      : key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase())
  return { id, label, category: 'accessory' }
}

function fromSlotToken(n: string): ClothesItem | null {
  if (/Accessory_/i.test(n)) return accessoryItem(n)

  const vroid = n.match(VROID_ITEM_RE)
  if (vroid) {
    const itemNo = vroid[1]!
    const cat = categoryFromToken(vroid[2]!)
    const label = `${CLOTHES_CATEGORY_LABEL[cat]} ${itemNo}`
    return { id: `${cat}-${itemNo}`, label, category: cat }
  }

  const simple = n.match(SIMPLE_CLOTH_RE)
  if (simple) {
    const cat = categoryFromToken(simple[1]!)
    return { id: cat, label: CLOTHES_CATEGORY_LABEL[cat], category: cat }
  }
  return null
}

/**
 * Classify a VRoid / VRM material or mesh as a clothing item, or null if it is body/face/hair.
 * Slot names (Tops / Bottoms / Shoes / Onepiece / Accessory) count even without `_CLOTH`.
 */
export function parseClothesMaterialName(name: string): ClothesItem | null {
  const n = stripInstanceSuffix(name)
  if (!n) return null
  if (/_(?:SKIN|FACE|HAIR)(?:_|$|\s)/i.test(n) || /^(?:Face|Hair|Body)(?:_|$)/i.test(n)) {
    return null
  }

  const slotted = fromSlotToken(n)
  if (slotted) return slotted

  const isCloth = /_CLOTH(?:_|$|\s)/i.test(n) || /CLOTH/i.test(n)
  if (!isCloth) return null

  const slug = n
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return { id: slug || 'other', label: n, category: 'other' }
}

/** Split `tops+shoes`, `tops,shoes`, or an ids array into normalized clothes ids. */
export function parseClothesIdList(raw: string | string[] | undefined | null): string[] {
  if (raw == null) return []
  const parts = Array.isArray(raw) ? raw : raw.split(/[+|,;]+/)
  const ids: string[] = []
  for (const part of parts) {
    const trimmed = part.trim()
    if (!trimmed) continue
    ids.push(normalizeClothesId(trimmed))
  }
  return uniqueIds(ids)
}

export function resolveClothesSelection(spec: {
  id?: string | null
  ids?: string[] | string | null
}): ClothesSelection {
  const idsProvided = spec.ids !== undefined && spec.ids !== null
  const fromIds = parseClothesIdList(spec.ids)
  if (idsProvided) {
    return selectionFromIds(fromIds)
  }
  const fromId =
    spec.id != null && String(spec.id).trim() !== '' ? parseClothesIdList(spec.id) : []
  if (!fromId.length) return { mode: 'default', ids: [] }
  return selectionFromIds(fromId)
}

function selectionFromIds(all: string[]): ClothesSelection {
  if (!all.length) return { mode: 'none', ids: [] }
  if (all.every((id) => id === CLOTHES_NONE_ID)) return { mode: 'none', ids: [] }
  if (all.every((id) => id === CLOTHES_DEFAULT_ID)) return { mode: 'default', ids: [] }
  const ids = all.filter((id) => id !== CLOTHES_NONE_ID && id !== CLOTHES_DEFAULT_ID)
  if (!ids.length) return { mode: 'none', ids: [] }
  return { mode: 'items', ids }
}

export function isClothesItemSelected(
  item: ClothesItem,
  selection: ClothesSelection,
): boolean {
  if (selection.mode === 'none') return false
  if (selection.mode === 'default') return true
  return selection.ids.some((id) => id === item.id || id === item.category)
}

export function summarizeClothesSelection(selection: ClothesSelection): string {
  if (selection.mode === 'none') return CLOTHES_NONE_ID
  if (selection.mode === 'default') return CLOTHES_DEFAULT_ID
  return selection.ids.join('+')
}

export function groupClothesByCategory(items: ClothesItem[]): ClothesGroup[] {
  const map = new Map<ClothesCategory, ClothesItem[]>()
  for (const cat of CLOTHES_CATEGORY_ORDER) map.set(cat, [])
  for (const item of items) {
    const list = map.get(item.category) ?? map.get('other')!
    list.push(item)
  }
  return CLOTHES_CATEGORY_ORDER.map((category) => ({
    category,
    label: CLOTHES_CATEGORY_LABEL[category],
    items: [...(map.get(category) ?? [])].sort((a, b) => a.label.localeCompare(b.label)),
  })).filter((g) => g.items.length > 0)
}

export function uniqueClothesItems(items: ClothesItem[]): ClothesItem[] {
  const seen = new Map<string, ClothesItem>()
  for (const item of items) {
    if (!seen.has(item.id)) seen.set(item.id, item)
  }
  return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label))
}

export function describeClothesState(opts: {
  id: string
  ids?: string[]
  native: ClothesItem[]
  overlayUrl?: string | null
}): {
  id: string
  ids: string[]
  mode: ClothesSelectMode | 'overlay'
  overlayUrl: string | null
  native: ClothesItem[]
  groups: ClothesGroup[]
} {
  const overlayUrl = opts.overlayUrl ?? null
  const selection = resolveClothesSelection({ id: opts.id, ids: opts.ids })
  return {
    id: opts.id,
    ids: selection.mode === 'items' ? selection.ids : selection.mode === 'none' ? [] : opts.native.map((n) => n.id),
    mode: overlayUrl ? 'overlay' : selection.mode,
    overlayUrl,
    native: opts.native,
    groups: groupClothesByCategory(opts.native),
  }
}
