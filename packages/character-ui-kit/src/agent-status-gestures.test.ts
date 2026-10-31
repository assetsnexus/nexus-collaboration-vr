import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DEFAULT_STATUS_MOTIONS,
  coalesceAgentStatusPhase,
  defaultMotionsForState,
  formatStatusChip,
  isLiveAgentState,
  motionsForState,
  parseStatusMotions,
  pickStatusGesture,
  serializeStatusMotions,
  statusGesture,
  statusMood,
  statusMoodAfterMotion,
} from '../dist/agent-status-gestures.js'

describe('coalesceAgentStatusPhase', () => {
  it('collapses churn buckets to a stable phase', () => {
    for (const s of ['planning', 'reading', 'running', 'tool_progress', '']) {
      const phase = coalesceAgentStatusPhase(s)
      assert.ok(phase === 'running' || phase === 'thinking', `${s} → ${phase}`)
    }
    assert.equal(coalesceAgentStatusPhase('reasoning'), 'thinking')
    assert.equal(coalesceAgentStatusPhase('writing'), 'writing')
    assert.equal(coalesceAgentStatusPhase('done'), 'done')
    assert.equal(coalesceAgentStatusPhase('cancelled'), 'cancelled')
  })

  it('is case / whitespace tolerant', () => {
    assert.equal(coalesceAgentStatusPhase('  THINKING '), 'thinking')
  })
})

describe('statusMood / statusGesture', () => {
  it('maps live states to a catalog-friendly mood (via coalesced phase)', () => {
    assert.equal(statusMood('thinking'), 'focused')
    assert.equal(statusMood('reasoning'), 'focused')
    assert.equal(statusMood('writing'), 'focused')
    assert.equal(statusMood('done'), 'neutral')
    assert.equal(statusMood('cancelled'), 'neutral')
    // Unknown / plain busy states coalesce into the "running" bucket.
    assert.equal(statusMood('nonsense'), 'focused')
  })

  it('maps live states to a gesture id (via coalesced phase)', () => {
    assert.equal(statusGesture('thinking'), 'think')
    assert.equal(statusGesture('writing'), 'nod')
    assert.equal(statusGesture('running'), 'nod')
  })
})

describe('statusMoodAfterMotion (P6c clobber fix)', () => {
  it('restores the live emotion mood instead of the hardcoded neutral', () => {
    assert.equal(statusMoodAfterMotion('done', { emotionMood: 'worried' }), 'worried')
    assert.equal(statusMoodAfterMotion('done', { emotionMood: 'annoyed' }), 'annoyed')
    // Whitespace-tolerant, like the rest of the module.
    assert.equal(statusMoodAfterMotion('done', { emotionMood: '  playful ' }), 'playful')
  })

  it('falls back to the profile default mood when no emotion mood is live', () => {
    assert.equal(statusMoodAfterMotion('done', { emotionMood: null, defaultMood: 'calm' }), 'calm')
    assert.equal(statusMoodAfterMotion('done', { emotionMood: '  ', defaultMood: ' relaxed ' }), 'relaxed')
  })

  it('keeps the status map when neither is known', () => {
    assert.equal(statusMoodAfterMotion('done'), 'neutral')
    assert.equal(statusMoodAfterMotion('thinking'), 'focused')
  })
})

describe('isLiveAgentState / formatStatusChip', () => {
  it('treats done/cancelled/empty as not live', () => {
    assert.equal(isLiveAgentState('thinking'), true)
    assert.equal(isLiveAgentState('done'), false)
    assert.equal(isLiveAgentState('cancelled'), false)
    assert.equal(isLiveAgentState(undefined), false)
  })

  it('formats an emoji chip with a label fallback', () => {
    assert.equal(formatStatusChip({ state: 'writing' }), '✍️ writing')
    assert.equal(formatStatusChip({ state: 'x', emoji: '⭐️', label: 'Lint' }), '⭐️ Lint')
  })
})

describe('parseStatusMotions / serializeStatusMotions', () => {
  it('returns the defaults for an empty blob', () => {
    const parsed = parseStatusMotions(null)
    assert.deepEqual(parsed, parseStatusMotions(undefined))
    assert.deepEqual(parsed.thinking, DEFAULT_STATUS_MOTIONS.thinking)
  })

  it('normalizes gestures, splits strings, and clamps the interval', () => {
    const parsed = parseStatusMotions({
      status_motions: {
        thinking: { gestures: 'think, wave  think', interval_ms: 999_999 },
        writing: { gestures: [], intervalMs: 10 },
      },
    })
    assert.deepEqual(parsed.thinking!.gestures, ['think', 'wave'])
    assert.equal(parsed.thinking!.intervalMs, 20000)
    // Empty gesture list falls back to the state default rather than disabling.
    assert.deepEqual(parsed.writing!.gestures, defaultMotionsForState('writing').gestures)
    assert.equal(parsed.writing!.intervalMs, 1200)
  })

  it('round-trips through serialize', () => {
    const motions = parseStatusMotions({ status_motions: { reasoning: { gestures: ['nod'] } } })
    const round = parseStatusMotions({ status_motions: serializeStatusMotions(motions) })
    assert.deepEqual(round, motions)
  })
})

describe('motionsForState / pickStatusGesture', () => {
  it('falls back to the state default for an unknown bucket', () => {
    assert.deepEqual(
      motionsForState('unknown', {}),
      defaultMotionsForState('unknown'),
    )
  })

  it('never returns null for a non-empty pool and avoids the last id', () => {
    assert.equal(pickStatusGesture([]), null)
    assert.equal(pickStatusGesture(['think']), 'think')
    for (let i = 0; i < 40; i += 1) {
      const picked = pickStatusGesture(['think', 'nod'], 'think')
      assert.ok(picked === 'nod', `expected nod, got ${picked}`)
    }
  })

  it('de-dupes and trims the pool', () => {
    assert.equal(pickStatusGesture([' nod ', 'nod', '']), 'nod')
  })
})
