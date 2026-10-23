/**
 * Motion-feed row shaping.
 *
 * Ported from the oc-controller reference project's `lib/motionFeedRows.ts`
 * (same `CharacterActionEvent` source). Pure, dependency-free — the React panel
 * only renders what this returns.
 *
 * @module motion-feed-rows
 */
import type { CharacterActionEvent } from '@nexus/character-kit'

export type MotionFeedGroup = {
  key: string
  groupId?: number
  agent?: string
  events: CharacterActionEvent[]
}

export type MotionFeedSeriesRow = {
  kind: 'series'
  key: string
  groupId: number
  count: number
  source: CharacterActionEvent['source']
  detail?: string
}

export type MotionFeedEventRow = {
  kind: 'event'
  key: string
  event: CharacterActionEvent
  /** Display order within a series (1-based, chronological). */
  step?: number
  total?: number
  chain?: 'first' | 'mid' | 'last'
}

export type MotionFeedRow = MotionFeedSeriesRow | MotionFeedEventRow

export function agentKey(agent?: string): string {
  return (agent || '').trim().toLowerCase()
}

/** Cluster consecutive same-groupId events from the same agent. Input is newest-first. */
export function groupMotionFeedEvents(events: CharacterActionEvent[]): MotionFeedGroup[] {
  const groups: MotionFeedGroup[] = []
  for (const ev of events) {
    const last = groups[groups.length - 1]
    const agent = agentKey(ev.agent)
    if (ev.groupId != null && last && last.groupId === ev.groupId && agentKey(last.agent) === agent) {
      last.events.push(ev)
    } else {
      groups.push({
        key: ev.groupId != null ? `g-${agent}-${ev.groupId}-${ev.id}` : `e-${agent}-${ev.id}`,
        groupId: ev.groupId,
        agent: ev.agent,
        events: [ev],
      })
    }
  }
  return groups
}

/**
 * Flatten groups into one table: a series banner row plus chronological steps,
 * otherwise a single event row. Preserves newest-first group order.
 */
export function flattenMotionFeedRows(groups: MotionFeedGroup[]): MotionFeedRow[] {
  const rows: MotionFeedRow[] = []
  for (const group of groups) {
    const chained = group.groupId != null && group.events.length > 1
    if (!chained) {
      const ev = group.events[0]
      if (!ev) continue
      rows.push({ kind: 'event', key: `e-${agentKey(ev.agent)}-${ev.id}`, event: ev })
      continue
    }

    const chronological = group.events.slice().reverse()
    const lead = chronological[0]!
    rows.push({
      kind: 'series',
      key: `series-${group.key}`,
      groupId: group.groupId!,
      count: chronological.length,
      source: lead.source,
      detail: lead.detail,
    })
    chronological.forEach((ev, i) => {
      const last = chronological.length - 1
      rows.push({
        kind: 'event',
        key: `e-${agentKey(ev.agent)}-${ev.id}`,
        event: ev,
        step: i + 1,
        total: chronological.length,
        chain: i === 0 ? 'first' : i === last ? 'last' : 'mid',
      })
    })
  }
  return rows
}
