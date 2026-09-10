import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { chromeAfterFullscreenChange, isImmersive } from './immersive.ts'

describe('isImmersive', () => {
  it('is true when expanded or fullscreen', () => {
    assert.equal(isImmersive({ expanded: false, fullscreen: false }), false)
    assert.equal(isImmersive({ expanded: true, fullscreen: false }), true)
    assert.equal(isImmersive({ expanded: false, fullscreen: true }), true)
  })
})

describe('chromeAfterFullscreenChange', () => {
  it('keeps expand when native fullscreen ends', () => {
    const next = chromeAfterFullscreenChange(
      { expanded: true, fullscreen: true },
      false,
    )
    assert.deepEqual(next, { expanded: true, fullscreen: false })
  })
})
