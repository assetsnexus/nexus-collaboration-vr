import { useEffect, useMemo, useRef, useState } from 'react'
import { formatClipDuration, type LoadedGestureInfo } from '@nexus/character-kit'

export type GestureTestPanelProps = {
  open: boolean
  /** Live catalogue reader (polled while open). */
  getCatalog: () => LoadedGestureInfo[]
  playingId?: string | null
  onPlay: (id: string, loop: boolean) => void
  onClose: () => void
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('aborted', 'AbortError'))
      return
    }
    const t = window.setTimeout(resolve, ms)
    const onAbort = () => {
      window.clearTimeout(t)
      reject(new DOMException('aborted', 'AbortError'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Catalogue of every loaded clip — play one or run all one-shots in sequence.
 *
 * Ported from the reference `GestureTestPopup`, docked instead of draggable.
 */
export function GestureTestPanel({
  open,
  getCatalog,
  playingId = null,
  onPlay,
  onClose,
}: GestureTestPanelProps) {
  const [catalog, setCatalog] = useState<LoadedGestureInfo[]>([])
  const [query, setQuery] = useState('')
  const [loop, setLoop] = useState(false)
  const [runningAll, setRunningAll] = useState(false)
  const [queueId, setQueueId] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!open) return
    const tick = () => setCatalog(getCatalog())
    tick()
    const id = window.setInterval(tick, 800)
    return () => window.clearInterval(id)
  }, [open, getCatalog])

  useEffect(() => {
    if (open) return
    abortRef.current?.abort()
    abortRef.current = null
    setRunningAll(false)
    setQueueId(null)
  }, [open])

  useEffect(() => () => abortRef.current?.abort(), [])

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return catalog
    return catalog.filter(
      (g) => g.id.toLowerCase().includes(q) || (g.description || '').toLowerCase().includes(q),
    )
  }, [catalog, query])

  const oneshots = useMemo(() => rows.filter((g) => !g.loop), [rows])

  async function playAll(): Promise<void> {
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    setRunningAll(true)
    try {
      for (const g of oneshots) {
        if (ac.signal.aborted) return
        setQueueId(g.id)
        onPlay(g.id, false)
        const waitMs = Math.max(400, (g.durationMs ?? 1200) + 180)
        await sleep(waitMs, ac.signal)
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) throw err
    } finally {
      if (abortRef.current === ac) {
        abortRef.current = null
        setRunningAll(false)
        setQueueId(null)
      }
    }
  }

  function stopAll(): void {
    abortRef.current?.abort()
    abortRef.current = null
    setRunningAll(false)
    setQueueId(null)
  }

  if (!open) return null

  const activeId = queueId || playingId

  return (
    <div
      className="motion-debug-popup gesture-test-popup"
      role="dialog"
      aria-label="Gesture tester"
      data-ack-ignore=""
    >
      <div className="motion-debug-head">
        <div>
          <strong>Gesture tester</strong>
          <p className="muted">
            {catalog.length} loaded
            {oneshots.length !== catalog.length ? ` · ${oneshots.length} one-shots` : ''}
            {runningAll ? ' · playing all' : ''}
          </p>
        </div>
        <div className="motion-debug-head-actions">
          {runningAll ? (
            <button type="button" className="secondary" onClick={stopAll}>
              Stop
            </button>
          ) : (
            <button
              type="button"
              className="secondary"
              disabled={!oneshots.length}
              onClick={() => void playAll()}
            >
              Play all
            </button>
          )}
          <button type="button" className="secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      <div className="gesture-test-toolbar">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter clips"
          aria-label="Filter gestures"
        />
        <label className="chat-avatar-toggle">
          <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} />
          Loop
        </label>
      </div>

      {rows.length === 0 ? (
        <p className="muted motion-debug-empty">
          {catalog.length === 0
            ? 'No clips yet — wait for the VRM / gesture pack.'
            : 'No clips match that filter.'}
        </p>
      ) : (
        <div className="motion-debug-table-wrap">
          <table className="motion-debug-table">
            <thead>
              <tr>
                <th />
                <th>Clip</th>
                <th>Duration</th>
                <th>Kind</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((g) => {
                const kind = g.loop ? 'loop' : g.overlay ? 'overlay' : 'body'
                const active = activeId === g.id
                return (
                  <tr
                    key={g.id}
                    className={active ? 'status-playing' : undefined}
                    data-status={active ? 'playing' : undefined}
                  >
                    <td>
                      <button
                        type="button"
                        className="secondary gesture-test-play"
                        disabled={runningAll}
                        onClick={() => onPlay(g.id, loop)}
                      >
                        Play
                      </button>
                    </td>
                    <td title={g.description || g.id}>{g.id}</td>
                    <td className="muted">{formatClipDuration(g.durationMs, g.loop)}</td>
                    <td className="muted">{kind}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
