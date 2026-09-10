import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  PTT_MIN_BYTES,
  PTT_MIN_DURATION_MS,
  pickRecorderMimeType,
  pttResultUsable,
  pttShouldArm,
} from './ptt.ts'

describe('pttShouldArm', () => {
  it('arms only on primary button', () => {
    assert.equal(pttShouldArm(0), true)
    assert.equal(pttShouldArm(1), false)
    assert.equal(pttShouldArm(2), false)
  })
})

describe('pttResultUsable', () => {
  it('rejects cancel and short/empty takes', () => {
    assert.equal(
      pttResultUsable({ reason: 'cancel', durationMs: 1000, byteLength: 4000 }),
      false,
    )
    assert.equal(
      pttResultUsable({
        reason: 'submit',
        durationMs: PTT_MIN_DURATION_MS - 1,
        byteLength: 4000,
      }),
      false,
    )
    assert.equal(
      pttResultUsable({
        reason: 'submit',
        durationMs: 1000,
        byteLength: PTT_MIN_BYTES - 1,
      }),
      false,
    )
  })

  it('accepts a real take', () => {
    assert.equal(
      pttResultUsable({ reason: 'submit', durationMs: 400, byteLength: 2048 }),
      true,
    )
  })
})

describe('pickRecorderMimeType', () => {
  it('picks the first supported candidate', () => {
    assert.equal(
      pickRecorderMimeType((m) => m === 'audio/webm'),
      'audio/webm',
    )
    assert.equal(
      pickRecorderMimeType(() => false),
      undefined,
    )
  })
})
