/** Walk a parent chain (THREE bones or test stubs) until a name exists in `mapped`. */
export function nearestMappedAncestorName(
  node: { name: string; parent: unknown },
  mapped: Set<string>,
): string | null {
  let current: unknown = node.parent
  while (current && typeof current === 'object') {
    const rec = current as { name?: unknown; parent?: unknown }
    const name = typeof rec.name === 'string' ? rec.name : ''
    if (name && mapped.has(name)) return name
    current = rec.parent ?? null
  }
  return null
}

export function namedNodeDepth(node: { parent: unknown }): number {
  let depth = 0
  let current: unknown = node.parent
  while (current && typeof current === 'object') {
    depth += 1
    current = (current as { parent?: unknown }).parent ?? null
  }
  return depth
}
