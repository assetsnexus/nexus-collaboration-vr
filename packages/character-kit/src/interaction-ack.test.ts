import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ACK_IGNORE_SELECTOR,
  DEFAULT_INTERACTION_ACK,
  DEFAULT_ZOOM_IN_GESTURE,
  DEFAULT_ZOOM_OUT_GESTURE,
  isInteractiveAckTarget,
  mergeAckGestureOptions,
  normalizeClickAckSpeed,
  normalizeInteractionAck,
  normalizeWheelDeltaY,
  zoomAckDirection,
} from '../dist/interaction-ack.js'
import { DEFAULT_NOD_TIME_SCALE } from './gesture-variants.ts'

describe('isInteractiveAckTarget', () => {
  it('is false for null and non-elements', () => {
    assert.equal(isInteractiveAckTarget(null), false)
    assert.equal(isInteractiveAckTarget({} as EventTarget), false)
  })

  it('blocks when closest matches the ignore selector', () => {
    let seen = ''
    const hit = {
      closest(sel: string) {
        seen = sel
        return sel === ACK_IGNORE_SELECTOR ? this : null
      },
    }
    assert.equal(isInteractiveAckTarget(hit as unknown as EventTarget), true)
    assert.equal(seen, ACK_IGNORE_SELECTOR)
  })

  it('allows clicks when closest finds nothing', () => {
    const miss = { closest: () => null }
    assert.equal(isInteractiveAckTarget(miss as unknown as EventTarget), false)
  })

  it('covers dialogs and buttons used by motion debug', () => {
    assert.match(ACK_IGNORE_SELECTOR, /\[role="dialog"\]/)
    assert.match(ACK_IGNORE_SELECTOR, /button/)
    assert.match(ACK_IGNORE_SELECTOR, /\[data-ack-ignore\]/)
  })
})

describe('normalizeWheelDeltaY', () => {
  it('passes through pixel deltas', () => {
    assert.equal(normalizeWheelDeltaY({ deltaY: 100, deltaMode: 0 }), 100)
  })

  it('scales line and page modes to pixels', () => {
    assert.equal(normalizeWheelDeltaY({ deltaY: 3, deltaMode: 1 }), 48)
    assert.equal(normalizeWheelDeltaY({ deltaY: 1, deltaMode: 2 }), 80)
  })
})

describe('zoomAckDirection', () => {
  it('needs a real zoom tick before firing', () => {
    assert.equal(zoomAckDirection(0), null)
    assert.equal(zoomAckDirection(39), null)
    assert.equal(zoomAckDirection(-39), null)
  })

  it('treats positive deltaY as zoom out (OrbitControls dollyOut)', () => {
    assert.equal(zoomAckDirection(40), 'out')
    assert.equal(zoomAckDirection(120), 'out')
  })

  it('treats negative deltaY as zoom in', () => {
    assert.equal(zoomAckDirection(-40), 'in')
    assert.equal(zoomAckDirection(-80), 'in')
  })
})

describe('normalizeInteractionAck', () => {
  it('defaults to nod on click and v_sign/wave on zoom', () => {
    const opts = normalizeInteractionAck()
    assert.deepEqual(opts, DEFAULT_INTERACTION_ACK)
    assert.equal(opts.clickGesture, 'nod')
    assert.equal(opts.zoomInGesture, DEFAULT_ZOOM_IN_GESTURE)
    assert.equal(opts.zoomOutGesture, DEFAULT_ZOOM_OUT_GESTURE)
    assert.equal(opts.clickSpeed, DEFAULT_NOD_TIME_SCALE)
  })

  it('treats missing flags as enabled', () => {
    const opts = normalizeInteractionAck({ clickGesture: 'think' })
    assert.equal(opts.clickEnabled, true)
    assert.equal(opts.zoomEnabled, true)
    assert.equal(opts.clickGesture, 'think')
  })

  it('clamps ack speed', () => {
    assert.equal(normalizeClickAckSpeed(0.01), 0.35)
    assert.equal(normalizeClickAckSpeed(9), 3)
    assert.equal(normalizeClickAckSpeed('nope'), DEFAULT_NOD_TIME_SCALE)
  })
})

describe('mergeAckGestureOptions', () => {
  it('keeps current ids even if they are not in the pack yet', () => {
    const ids = mergeAckGestureOptions(['wave', 'nod'], ['custom_bow'])
    assert.equal(ids[0], 'custom_bow')
    assert.ok(ids.includes('nod'))
    assert.ok(ids.includes('wave'))
  })
})
