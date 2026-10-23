import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { releaseLipSync, type LipSyncContextOwner } from './lip-sync-lifecycle.ts'

function fakeContext(state: AudioContextState = 'running') {
  let closed = 0
  const ctx = {
    get state() {
      return closed ? ('closed' as AudioContextState) : state
    },
    close() {
      closed += 1
      return Promise.resolve()
    },
  }
  return { ctx: ctx as unknown as AudioContext, closes: () => closed }
}

function fakeLip(ctx: AudioContext | null) {
  let disposed = 0
  const lip: LipSyncContextOwner = {
    audioContext: ctx,
    dispose() {
      disposed += 1
    },
  }
  return { lip, disposals: () => disposed }
}

describe('releaseLipSync', () => {
  it('closes an AudioContext this component created', () => {
    const { ctx, closes } = fakeContext('running')
    const { lip, disposals } = fakeLip(ctx)
    const closed = releaseLipSync(lip, true)
    assert.equal(closed, true)
    assert.equal(closes(), 1)
    assert.equal(disposals(), 1)
  })

  it('never closes a provided/shared AudioContext', () => {
    const { ctx, closes } = fakeContext('running')
    const { lip, disposals } = fakeLip(ctx)
    const closed = releaseLipSync(lip, false)
    assert.equal(closed, false)
    assert.equal(closes(), 0) // shared context left alone
    assert.equal(disposals(), 1) // engine still torn down
  })

  it('is a no-op for a missing instance', () => {
    assert.equal(releaseLipSync(null, true), false)
    assert.equal(releaseLipSync(undefined, true), false)
  })

  it('does not double-close an already-closed context', () => {
    const { ctx, closes } = fakeContext('closed')
    const { lip } = fakeLip(ctx)
    assert.equal(releaseLipSync(lip, true), false)
    assert.equal(closes(), 0)
  })

  it('still disposes the engine when close() rejects', () => {
    const { lip, disposals } = fakeLip({
      state: 'running',
      close: () => Promise.reject(new Error('already closing')),
    } as unknown as AudioContext)
    assert.doesNotThrow(() => releaseLipSync(lip, true))
    assert.equal(disposals(), 1)
  })
})
