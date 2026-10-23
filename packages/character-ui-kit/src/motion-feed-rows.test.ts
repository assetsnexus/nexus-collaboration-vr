import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { CharacterActionEvent } from '@nexus/character-kit'
import {
  agentKey,
  flattenMotionFeedRows,
  groupMotionFeedEvents,
} from '../dist/motion-feed-rows.js'

let seq = 0
function ev(over: Partial<CharacterActionEvent> = {}): CharacterActionEvent {
  seq += 1
  return {
    id: `ev-${seq}`,
    op: 'play',
    label: `clip ${seq}`,
    source: 'agent',
    at: seq * 10,
    dtMs: 10,
    ...over,
  } as CharacterActionEvent
}

describe('agentKey', () => {
  it('lowercases and trims, and treats undefined as empty', () => {
    assert.equal(agentKey(' Bot '), 'bot')
    assert.equal(agentKey(undefined), '')
  })
})

describe('groupMotionFeedEvents', () => {
  it('clusters consecutive same-group events from one agent', () => {
    const events = [ev({ groupId: 7 }), ev({ groupId: 7 }), ev({ groupId: 7 })]
    const groups = groupMotionFeedEvents(events)
    assert.equal(groups.length, 1)
    assert.equal(groups[0]!.events.length, 3)
    assert.equal(groups[0]!.groupId, 7)
  })

  it('does not merge same groupId across different agents', () => {
    const events = [ev({ groupId: 3, agent: 'a' }), ev({ groupId: 3, agent: 'b' })]
    const groups = groupMotionFeedEvents(events)
    assert.equal(groups.length, 2)
  })

  it('leaves non-grouped events as singletons', () => {
    const groups = groupMotionFeedEvents([ev(), ev()])
    assert.equal(groups.length, 2)
    assert.equal(groups[0]!.groupId, undefined)
  })
})

describe('flattenMotionFeedRows', () => {
  it('emits a banner + chronological steps for a chained group', () => {
    const events = [
      ev({ groupId: 5, label: 'third' }),
      ev({ groupId: 5, label: 'second' }),
      ev({ groupId: 5, label: 'first' }),
    ]
    const rows = flattenMotionFeedRows(groupMotionFeedEvents(events))
    assert.equal(rows.length, 4)
    const banner = rows[0]!
    assert.equal(banner.kind, 'series')
    assert.equal(banner.kind === 'series' && banner.count, 3)
    const steps = rows.slice(1)
    assert.deepEqual(
      steps.map((r) => (r.kind === 'event' ? r.step : null)),
      [1, 2, 3],
    )
    assert.deepEqual(
      steps.map((r) => (r.kind === 'event' ? r.chain : null)),
      ['first', 'mid', 'last'],
    )
    // Chronological within the series, newest group first.
    assert.deepEqual(
      steps.map((r) => (r.kind === 'event' ? r.event.label : null)),
      ['first', 'second', 'third'],
    )
  })

  it('emits a single row for an ungrouped event', () => {
    const rows = flattenMotionFeedRows(groupMotionFeedEvents([ev({ label: 'waving' })]))
    assert.equal(rows.length, 1)
    assert.equal(rows[0]!.kind, 'event')
    assert.equal(rows[0]!.kind === 'event' && rows[0]!.event.label, 'waving')
  })

  it('treats a single-event group as ungrouped (no banner)', () => {
    const rows = flattenMotionFeedRows(groupMotionFeedEvents([ev({ groupId: 9 })]))
    assert.equal(rows.length, 1)
    assert.equal(rows[0]!.kind, 'event')
  })

  it('keeps newest group first across multiple series', () => {
    const rows = flattenMotionFeedRows(
      groupMotionFeedEvents([
        ev({ groupId: 2 }),
        ev({ groupId: 2 }),
        ev({ groupId: 1 }),
        ev({ groupId: 1 }),
      ]),
    )
    const series = rows.filter((r) => r.kind === 'series')
    assert.deepEqual(
      series.map((r) => (r.kind === 'series' ? r.groupId : null)),
      [2, 1],
    )
  })
})
