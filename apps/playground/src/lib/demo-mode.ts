/** Character models shown when Demo is on. Keep this list explicit. */
export const DEMO_VRM_IDS = [
  'hoodie',
  'tori',
  'curt',
  'apollo',
  'bob',
  'sample',
] as const

export type DemoVrmId = (typeof DEMO_VRM_IDS)[number]

export function isDemoVrmId(id: string): boolean {
  return (DEMO_VRM_IDS as readonly string[]).includes(id)
}

export function filterDemoCatalog<T extends { id: string }>(
  items: readonly T[],
  demoMode: boolean,
): T[] {
  if (!demoMode) return [...items]
  return items.filter((item) => isDemoVrmId(item.id))
}

export function catalogIdFromUrl(
  url: string | undefined,
  catalog: ReadonlyArray<{ id: string; url: string }>,
): string {
  const trimmed = (url ?? '').trim()
  if (!trimmed) return ''
  return catalog.find((v) => v.url === trimmed)?.id ?? trimmed
}

export function demoFallbackUrl(
  catalog: ReadonlyArray<{ id: string; url: string }>,
): string {
  return catalog.find((v) => v.id === 'hoodie')?.url ?? catalog[0]?.url ?? ''
}
