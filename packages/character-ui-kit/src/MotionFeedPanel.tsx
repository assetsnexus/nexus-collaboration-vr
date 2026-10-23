import { useEffect, useMemo, useState } from 'react'
import {
  actionTimedProgress,
  formatActionDelta,
  formatActionSource,
  formatActionStatus,
  type CharacterActionEvent,
} from '@nexus/character-kit'
import { flattenMotionFeedRows, groupMotionFeedEvents } from './motion-feed-rows.js'

export type MotionFeedPanelProps = {
  open: boolean
  events: CharacterActionEvent[]
  onClose: () => void
  onClear: () => void
  /** Rendered as the "Gestures" toolbar button when provided. */
  onOpenGestureTest?: () => void
}

/**
 * Live motion feed for the 3D viewport.
 *
 * Ported from the reference `MotionDebugPopup`. Docked rather than draggable so
 * it can sit in a host-defined slot (dev panel, settings drawer, side rail).
 */
export function MotionFeedPanel({
  open,
  events,
  onClose,
  onClear,
  onOpenGestureTest,
}: MotionFeedPanelProps) {
  const rows = useMemo(() => flattenMotionFeedRows(groupMotionFeedEvents(events)), [events])
  const playing = useMemo(() => events.filter((e) => e.status === 'playing'), [events])
  const pending = useMemo(() => events.filter((e) => e.status === 'pending'), [events])
  const liveTimed = useMemo(
    () => events.some((e) => e.status === 'playing' && e.durationMs && e.durationMs > 0),
    [events],
  )
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!open) return
    setNow(Date.now())
    if (!liveTimed) return
    const id = window.setInterval(() => setNow(Date.now()), 50)
    return () => window.clearInterval(id)
  }, [open, liveTimed])

  if (!open) return null

  return (
    <div className="motion-debug-popup" role="dialog" aria-label="Motion debug feed" data-ack-ignore="">
      <div className="motion-debug-head">
        <div>
          <strong>Motion feed</strong>
          <p className="muted">
            {playing.length ? `${playing.length} playing` : 'idle'}
            {pending.length ? ` · ${pending.length} pending` : ''}
            {' · '}
            groups / waits / cancels
          </p>
        </div>
        <div className="motion-debug-head-actions">
          {onOpenGestureTest ? (
            <button type="button" className="secondary" onClick={onOpenGestureTest}>
              Gestures
            </button>
          ) : null}
          <button type="button" className="secondary" disabled={!events.length} onClick={onClear}>
            Clear
          </button>
          <button type="button" className="secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      {(playing.length > 0 || pending.length > 0) && (
        <div className="motion-debug-live">
          {playing.map((ev) => (
            <span key={`p-${ev.id}`} className="motion-debug-pill playing">
              ▶ {ev.op} {ev.label}
            </span>
          ))}
          {pending.map((ev) => (
            <span key={`w-${ev.id}`} className="motion-debug-pill pending">
              … {ev.op} {ev.label}
            </span>
          ))}
        </div>
      )}

      {events.length === 0 ? (
        <p className="muted motion-debug-empty">
          No actions yet. Sequences show pending→playing→done; cancels mark discarded steps.
        </p>
      ) : (
        <div className="motion-debug-table-wrap">
          <table className="motion-debug-table">
            <thead>
              <tr>
                <th>Source</th>
                <th>Status</th>
                <th>Δ</th>
                <th>Op</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                if (row.kind === 'series') {
                  return (
                    <tr key={row.key} className="motion-debug-series" data-group={row.groupId}>
                      <td colSpan={5}>
                        series #{row.groupId} · {row.count} steps
                        {' · '}
                        {formatActionSource(row.source, row.detail)}
                      </td>
                    </tr>
                  )
                }
                const ev = row.event
                return (
                  <tr
                    key={row.key}
                    className={`status-${ev.status || 'done'}`}
                    data-status={ev.status || 'done'}
                    data-chain={row.chain}
                    data-group={row.chain ? row.event.groupId : undefined}
                  >
                    <td data-src={ev.source}>
                      {row.step != null && row.total != null ? (
                        <span className="motion-debug-step">
                          {row.step}/{row.total}
                        </span>
                      ) : null}
                      {formatActionSource(ev.source, ev.detail)}
                    </td>
                    <td>
                      <span className={`motion-status status-${ev.status || 'done'}`}>
                        {formatActionStatus(ev.status || 'done')}
                      </span>
                    </td>
                    <td className="muted">{formatActionDelta(ev.dtMs)}</td>
                    <MotionOpCell event={ev} now={now} />
                    <td title={ev.label}>{ev.label}</td>
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

function MotionOpCell({ event, now }: { event: CharacterActionEvent; now: number }) {
  const timed = actionTimedProgress(event, now)
  const canceledUntimed = !timed && (event.status === 'canceled' || event.status === 'discarded')
  const fillPct = timed ? `${(timed.ratio * 100).toFixed(2)}%` : null
  return (
    <td className={timed || canceledUntimed ? 'motion-debug-op has-bar' : 'motion-debug-op'}>
      {timed ? (
        <span className="motion-debug-op-bar" aria-hidden="true">
          <span className="motion-debug-op-fill" style={{ width: fillPct! }} />
          {timed.canceled ? (
            <span className="motion-debug-op-cancel" style={{ left: fillPct! }} />
          ) : null}
        </span>
      ) : canceledUntimed ? (
        <span className="motion-debug-op-bar motion-debug-op-bar-full-cancel" aria-hidden="true" />
      ) : null}
      <span className="motion-debug-op-text">{event.op}</span>
    </td>
  )
}
