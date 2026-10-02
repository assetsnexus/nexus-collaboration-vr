import type { ClusterListFilters, ClusterSummary } from './ClusterList.js'

export type ClusterListCommandClient = {
  send: (command: string, payload?: Record<string, unknown>) => Promise<unknown>
}

function unwrapData(result: unknown): Record<string, unknown> {
  if (!result || typeof result !== 'object') return {}
  const r = result as Record<string, unknown>
  if (r.data && typeof r.data === 'object') return r.data as Record<string, unknown>
  if (r.responseObject && typeof r.responseObject === 'object') {
    return r.responseObject as Record<string, unknown>
  }
  return r
}

function asClusters(raw: unknown): ClusterSummary[] {
  const rows = Array.isArray(raw) ? raw : []
  return rows
    .map((row, i) => {
      if (!row || typeof row !== 'object') return null
      const r = row as Record<string, unknown>
      const id = String(r.id || r._id || r.clusterId || '').trim()
      if (!id) return null
      return {
        ...r,
        id,
        name: typeof r.name === 'string' ? r.name : typeof r.title === 'string' ? r.title : id,
        description: typeof r.description === 'string' ? r.description : undefined,
        roomId:
          typeof r.roomId === 'string' && r.roomId.trim()
            ? r.roomId.trim()
            : typeof r.playRoomId === 'string'
              ? r.playRoomId
              : undefined,
        _index: i,
      } as ClusterSummary
    })
    .filter((c): c is ClusterSummary => Boolean(c))
}

/** Map `anx.cluster.list` (portal/region) into ClusterList items. Does not invent a new command. */
export async function listClustersFromCommand(
  client: ClusterListCommandClient,
  filters: ClusterListFilters = {},
): Promise<{ items: ClusterSummary[] }> {
  const payload: Record<string, unknown> = {
    page: typeof filters.page === 'number' ? filters.page : 1,
    perPage: typeof filters.limit === 'number' ? filters.limit : typeof filters.perPage === 'number' ? filters.perPage : 20,
  }
  if (filters.query) payload.search = filters.query
  if (filters.search) payload.search = filters.search
  if (filters.orgId) payload.orgId = filters.orgId
  for (const [k, v] of Object.entries(filters)) {
    if (k === 'query' || k === 'limit' || v === undefined) continue
    if (!(k in payload)) payload[k] = v
  }

  const result = await client.send('anx.cluster.list', payload)
  if (result && typeof result === 'object' && 'ok' in result && (result as { ok: boolean }).ok === false) {
    const fail = result as { message?: string }
    throw new Error(fail.message || 'anx.cluster.list failed')
  }
  const data = unwrapData(result)
  const items = asClusters(
    data.items ?? data.clusters ?? data.rows ?? (Array.isArray(result) ? result : []),
  )
  return { items }
}
