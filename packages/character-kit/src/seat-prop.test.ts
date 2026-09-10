import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isSitGestureId,
  isSitRestLoopId,
  gesturePreservesSitRest,
  SIT_GESTURE_IDS,
} from './seat-prop.ts'

describe('isSitGestureId', () => {
  it('treats sit and sit_wave as seated', () => {
    assert.equal(isSitGestureId('sit'), true)
    assert.equal(isSitGestureId('sit_wave'), true)
    assert.ok(SIT_GESTURE_IDS.size === 2)
  })

  it('rejects standing loops and empty ids', () => {
    assert.equal(isSitGestureId('idle'), false)
    assert.equal(isSitGestureId('wave'), false)
    assert.equal(isSitGestureId(''), false)
    assert.equal(isSitGestureId(null), false)
  })
})

describe('sit rest loop', () => {
  it('treats only sit as the rest loop, not sit_wave', () => {
    assert.equal(isSitRestLoopId('sit'), true)
    assert.equal(isSitRestLoopId('sit_wave'), false)
    assert.equal(isSitRestLoopId('idle'), false)
  })

  it('keeps sit rest only for sit and sit_wave fidgets', () => {
    assert.equal(gesturePreservesSitRest('sit'), true)
    assert.equal(gesturePreservesSitRest('sit_wave'), true)
    assert.equal(gesturePreservesSitRest('wave'), false)
    assert.equal(gesturePreservesSitRest('walk'), false)
    assert.equal(gesturePreservesSitRest('idle'), false)
  })
})
