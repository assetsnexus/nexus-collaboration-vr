import type { ClothesOverlayItemSave } from './storage'

export interface AgentWardrobe {
  clothesIds?: string[]
  clothesId?: string
  clothesOverlayId?: string
  clothesOverlayItems?: ClothesOverlayItemSave[]
}

export interface WardrobePane {
  vrmUrl?: string
  clothesId?: string
  clothesIds?: string[]
  clothesOverlayId?: string
  clothesOverlayItems?: ClothesOverlayItemSave[]
  wardrobeByModel?: Record<string, AgentWardrobe>
}

export function snapshotWardrobe(pane: WardrobePane): AgentWardrobe {
  return {
    clothesId: pane.clothesId,
    clothesIds: pane.clothesIds,
    clothesOverlayId: pane.clothesOverlayId,
    clothesOverlayItems: pane.clothesOverlayItems,
  }
}

export function applyWardrobe(slot: AgentWardrobe | undefined): AgentWardrobe {
  if (!slot) {
    return {
      clothesId: 'default',
      clothesIds: undefined,
      clothesOverlayId: undefined,
      clothesOverlayItems: undefined,
    }
  }
  return {
    clothesId: slot.clothesId ?? 'default',
    clothesIds: slot.clothesIds,
    clothesOverlayId: slot.clothesOverlayId,
    clothesOverlayItems: slot.clothesOverlayItems,
  }
}

export function mergeClothesIntoWardrobe(
  pane: WardrobePane,
  patch: Partial<AgentWardrobe>,
  modelKey: string,
): Pick<
  WardrobePane,
  | 'clothesId'
  | 'clothesIds'
  | 'clothesOverlayId'
  | 'clothesOverlayItems'
  | 'wardrobeByModel'
> {
  const next: WardrobePane = { ...pane, ...patch }
  const slot = snapshotWardrobe(next)
  return {
    clothesId: next.clothesId,
    clothesIds: next.clothesIds,
    clothesOverlayId: next.clothesOverlayId,
    clothesOverlayItems: next.clothesOverlayItems,
    wardrobeByModel: {
      ...pane.wardrobeByModel,
      [modelKey]: slot,
    },
  }
}

/** Snapshot the current model's clothes, then restore the target model's slot. */
export function switchPaneVrm<T extends WardrobePane>(
  pane: T,
  nextVrmUrl: string,
  fromKey: string,
  toKey: string,
): T {
  const saved: Record<string, AgentWardrobe> = {
    ...pane.wardrobeByModel,
    [fromKey]: snapshotWardrobe(pane),
  }
  const incoming = applyWardrobe(saved[toKey])
  return {
    ...pane,
    vrmUrl: nextVrmUrl,
    clothesId: incoming.clothesId,
    clothesIds: incoming.clothesIds,
    clothesOverlayId: incoming.clothesOverlayId,
    clothesOverlayItems: incoming.clothesOverlayItems,
    wardrobeByModel: saved,
  }
}

export function seedWardrobe<T extends WardrobePane>(pane: T, modelKey: string): T {
  if (!modelKey) return pane
  const existing = pane.wardrobeByModel ?? {}
  if (existing[modelKey]) return { ...pane, wardrobeByModel: existing }
  return {
    ...pane,
    wardrobeByModel: {
      ...existing,
      [modelKey]: snapshotWardrobe(pane),
    },
  }
}
