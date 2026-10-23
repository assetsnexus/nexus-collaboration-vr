import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { PRESENCE_MOODS } from '@nexus/character-kit/presence-moods'
import {
  ROUTINE_NAMES,
  allConfiguredGestureIds,
  defaultRoutineConfig,
  moodGesturePool,
  parseGestureRoutineConfig,
  serializeGestureRoutineConfig,
  withStatusMotion,
} from '../dist/gesture-routines.js'

describe('moodGesturePool', () => {
  it('unions micro/medium/long without duplicates', () => {
    for (const mood of Object.values(PRESENCE_MOODS)) {
      const pool = moodGesturePool(mood.id)
      assert.equal(new Set(pool).size, pool.length, `${mood.id} pool has duplicates`)
      assert.ok(pool.length > 0, `${mood.id} pool is empty`)
    }
  })
})

describe('allConfiguredGestureIds', () => {
  it('covers every id referenced by moods and status motions and is sorted', () => {
    const ids = allConfiguredGestureIds()
    assert.deepEqual(ids, [...ids].sort())
    for (const mood of Object.values(PRESENCE_MOODS)) {
      for (const id of moodGesturePool(mood.id)) {
        assert.ok(ids.includes(id), `missing mood gesture ${id}`)
      }
    }
    assert.ok(ids.includes('think'), 'status motion gesture missing')
  })
})

describe('parseGestureRoutineConfig', () => {
  it('returns complete defaults for a missing/empty blob', () => {
    const cfg = parseGestureRoutineConfig(null, null)
    for (const name of ROUTINE_NAMES) {
      assert.ok(Array.isArray(cfg.routines[name]), `${name} missing`)
    }
    assert.deepEqual(cfg.routines, defaultRoutineConfig().routines)
    assert.ok(cfg.statusMotions.thinking)
    assert.ok(cfg.moods.neutral)
  })

  it('accepts a partial routine blob and keeps defaults for the rest', () => {
    const cfg = parseGestureRoutineConfig({ routines: { greeting: ['wave', { id: 'nod', waitMs: 400 }] } })
    assert.deepEqual(cfg.routines.greeting, ['wave', { id: 'nod', waitMs: 400 }])
    assert.deepEqual(cfg.routines.farewell, defaultRoutineConfig().routines.farewell)
  })

  it('falls back to the embodiment blob when settings has no routines', () => {
    const cfg = parseGestureRoutineConfig(null, { routines: { onThink: ['think'] } })
    assert.deepEqual(cfg.routines.onThink, ['think'])
  })

  it('never throws on garbage input and drops unusable steps', () => {
    const cfg = parseGestureRoutineConfig({
      routines: { greeting: [42, null, { nope: true }, 'wave'] },
    })
    assert.deepEqual(cfg.routines.greeting, ['wave'])
  })

  it('keeps unusable steps from throwing before a usable step', () => {
    const cfg = parseGestureRoutineConfig({ routines: { onListen: [{ mood: 'curious' }] } })
    assert.deepEqual(cfg.routines.onListen, [{ mood: 'curious' }])
  })

  it('ignores non-array routines', () => {
    const cfg = parseGestureRoutineConfig({ routines: { greeting: 'wave' } })
    assert.deepEqual(cfg.routines.greeting, defaultRoutineConfig().routines.greeting)
  })
})

describe('serializeGestureRoutineConfig', () => {
  it('round-trips through the settings shape', () => {
    const cfg = defaultRoutineConfig()
    const round = parseGestureRoutineConfig(serializeGestureRoutineConfig(cfg))
    assert.deepEqual(round.routines, cfg.routines)
    assert.deepEqual(round.statusMotions, cfg.statusMotions)
  })
})

describe('withStatusMotion', () => {
  it('patches one state without mutating the input', () => {
    const cfg = defaultRoutineConfig()
    const next = withStatusMotion(cfg, 'thinking', { intervalMs: 9000 })
    assert.equal(next.statusMotions.thinking!.intervalMs, 9000)
    assert.notEqual(cfg.statusMotions.thinking!.intervalMs, 9000)
    assert.deepEqual(cfg.statusMotions.writing, next.statusMotions.writing)
  })

  it('keeps the current gestures when only the interval is patched', () => {
    const cfg = defaultRoutineConfig()
    const next = withStatusMotion(cfg, 'writing', { intervalMs: 7777 })
    assert.deepEqual(next.statusMotions.writing!.gestures, cfg.statusMotions.writing!.gestures)
  })
})
