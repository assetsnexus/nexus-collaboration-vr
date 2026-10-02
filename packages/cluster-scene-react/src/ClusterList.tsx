import { useCallback, useEffect, useState } from 'react'

export type ClusterSummary = {
  id: string
  name?: string
  description?: string
  roomId?: string
  [key: string]: unknown
}

export type ClusterListFilters = {
  query?: string
  orgId?: string
  limit?: number
  [key: string]: unknown
}

export type ClusterListProps = {
  listClusters: (filters: ClusterListFilters) => Promise<{ items: ClusterSummary[] }>
  onSelect?: (cluster: ClusterSummary) => void
  selectedId?: string | null
  initialFilters?: ClusterListFilters
}

export function ClusterList({
  listClusters,
  onSelect,
  selectedId,
  initialFilters,
}: ClusterListProps) {
  const [query, setQuery] = useState(initialFilters?.query ?? '')
  const [items, setItems] = useState<ClusterSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await listClusters({ ...initialFilters, query: query.trim() || undefined })
      setItems(res.items ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [listClusters, initialFilters, query])

  useEffect(() => {
    void reload()
  }, [reload])

  return (
    <div className="nexus-cluster-list" style={{ display: 'grid', gap: 8 }}>
      <input
        type="search"
        placeholder="Search clusters…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search clusters"
      />
      {loading ? <p>Loading…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {items.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => onSelect?.(c)}
              style={{
                width: '100%',
                textAlign: 'left',
                padding: '8px 10px',
                fontWeight: selectedId === c.id ? 600 : 400,
              }}
            >
              {c.name ?? c.id}
              {c.description ? (
                <span style={{ display: 'block', fontSize: 12, opacity: 0.75 }}>{c.description}</span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
      {!loading && !items.length ? <p>No clusters found.</p> : null}
    </div>
  )
}
