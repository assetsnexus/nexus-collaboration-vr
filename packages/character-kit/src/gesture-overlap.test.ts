import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  clipIsOverlay,
  decideGestureOverlap,
  logicalGestureId,
  MAX_GESTURE_QUEUE,
  normalizeTrackTarget,
  occupancyConflicts,
  sameLogicalMotion,
  shouldDropQueued,
  trackOccupancy,
  type PlayingGestureSpec,
} from '../dist/gesture-overlap.js'

function spec(partial: Partial<PlayingGestureSpec> & Pick<PlayingGestureSpec, 'id'>): PlayingGestureSpec {
  return {
    source: 'user',
    overlay: true,
    occupied: [],
    ...partial,
  }
}

describe('normalizeTrackTarget', () => {
  it('maps VRMA and procedural head tracks to the same bone', () => {
    assert.equal(normalizeTrackTarget('Normalized_Head.quaternion'), 'head')
    assert.equal(normalizeTrackTarget('head.quaternion'), 'head')
    assert.equal(normalizeTrackTarget('Armature/Normalized_RightUpperArm.quaternion'), 'rightupperarm')
  })
})

describe('trackOccupancy / clipIsOverlay', () => {
  it('collects unique normalized bones', () => {
    assert.deepEqual(
      trackOccupancy({
        tracks: [
          { name: 'head.quaternion' },
          { name: 'Normalized_Head.position' },
          { name: 'neck.quaternion' },
        ],
      }),
      ['head', 'neck'],
    )
  })

  it('treats hips/leg clips as body replacements and allows spine overlays', () => {
    assert.equal(clipIsOverlay(['head', 'neck']), true)
    assert.equal(clipIsOverlay(['rightupperarm', 'righthand']), true)
    assert.equal(clipIsOverlay(['spine', 'chest']), true)
    assert.equal(clipIsOverlay(['hips', 'spine']), false)
    assert.equal(clipIsOverlay(['upperchest']), true)
    assert.equal(clipIsOverlay(['leftupperleg']), false)
  })

  it('ignores hips.position when deciding overlay vs body', () => {
    assert.deepEqual(
      trackOccupancy({
        tracks: [
          { name: 'Normalized_Hips.position' },
          { name: 'Normalized_RightUpperArm.quaternion' },
        ],
      }),
      ['rightupperarm'],
    )
    assert.equal(clipIsOverlay(['rightupperarm']), true)
  })
})

describe('occupancyConflicts', () => {
  it('is false for disjoint overlays and true when a bone is shared', () => {
    assert.equal(occupancyConflicts(['head'], ['rightupperarm']), false)
    assert.equal(occupancyConflicts(['head', 'neck'], ['neck', 'rightshoulder']), true)
    assert.equal(occupancyConflicts([], ['head']), false)
  })
})

describe('logicalGestureId', () => {
  it('collapses variant groups', () => {
    assert.equal(logicalGestureId('nod_soft'), 'nod')
    assert.equal(logicalGestureId('wave_left'), 'wave')
    assert.equal(logicalGestureId('think'), 'think')
  })
})

describe('decideGestureOverlap', () => {
  const nod = spec({ id: 'nod', occupied: ['head', 'neck'] })
  const wave = spec({ id: 'wave', occupied: ['rightupperarm', 'righthand'] })
  const think = spec({
    id: 'think',
    overlay: false,
    occupied: ['hips', 'spine', 'rightupperarm'],
    source: 'agent',
  })

  it('plays when idle', () => {
    assert.equal(decideGestureOverlap(nod, []), 'play')
  })

  it('merges disjoint overlays even from the same source', () => {
    assert.equal(decideGestureOverlap(wave, [nod]), 'merge')
    assert.equal(decideGestureOverlap(nod, [wave]), 'merge')
  })

  it('skips the same logical motion', () => {
    assert.equal(decideGestureOverlap(spec({ id: 'nod_soft', occupied: ['head'] }), [nod]), 'skip')
    assert.equal(sameLogicalMotion('nod', 'nod_soft'), true)
  })

  it('skips a conflicting clip from the same source', () => {
    const otherNod = spec({ id: 'agree', occupied: ['head', 'neck'], source: 'user' })
    assert.equal(decideGestureOverlap(otherNod, [nod]), 'skip')
  })

  it('queues a conflicting clip from another source', () => {
    const thinkHead = spec({
      id: 'think',
      overlay: false,
      occupied: ['hips', 'head'],
      source: 'agent',
    })
    assert.equal(decideGestureOverlap(thinkHead, [nod]), 'queue')
  })

  it('skips instead of queuing behind a looping clip', () => {
    const talk = spec({
      id: 'talk',
      overlay: false,
      occupied: ['hips', 'head', 'neck'],
      source: 'agent',
      loop: true,
    })
    assert.equal(decideGestureOverlap(nod, [talk]), 'skip')
  })

  it('merges an overlay onto a body clip when bones do not overlap', () => {
    assert.equal(decideGestureOverlap(nod, [think]), 'merge')
  })

  it('merges a body clip under overlays when bones do not overlap', () => {
    const bodyWave = spec({
      id: 'wave',
      overlay: false,
      occupied: ['spine', 'rightupperarm'],
      source: 'agent',
    })
    assert.equal(decideGestureOverlap(bodyWave, [nod]), 'merge')
  })

  it('does not merge two body clips that share stance bones', () => {
    const think2 = spec({
      id: 'sad',
      overlay: false,
      occupied: ['hips', 'spine'],
      source: 'agent',
    })
    assert.equal(decideGestureOverlap(think2, [think]), 'skip')
  })
})

describe('shouldDropQueued', () => {
  it('drops duplicate logical ids and keeps the queue cap meaningful', () => {
    assert.equal(shouldDropQueued('nod_soft', [{ id: 'nod' }]), true)
    assert.equal(shouldDropQueued('wave', [{ id: 'nod' }]), false)
    assert.ok(MAX_GESTURE_QUEUE >= 1)
  })
})
