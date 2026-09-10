import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import * as THREE from 'three'
import {
  V_SIGN_LOWER_START_S,
  V_SIGN_RAISE_END_S,
  V_SIGN_SHORT_ID,
  V_SIGN_SHORT_LENGTH_RATIO,
  compressClipHold,
  shortenVSignClip,
  timeRemapClip,
} from './clip-time-remap.ts'

function quatTrack(times: number[], values: number[]): THREE.QuaternionKeyframeTrack {
  return new THREE.QuaternionKeyframeTrack('Normalized_RightUpperArm.quaternion', times, values)
}

function identityQuatTrack(times: number[]): THREE.QuaternionKeyframeTrack {
  const values: number[] = []
  for (let i = 0; i < times.length; i++) values.push(0, 0, 0, 1)
  return quatTrack(times, values)
}

describe('timeRemapClip', () => {
  it('scales key times and duration', () => {
    const clip = new THREE.AnimationClip('src', 4, [identityQuatTrack([0, 2, 4])])
    const out = timeRemapClip(clip, (t) => t * 0.5, 'half')
    assert.equal(out.name, 'half')
    assert.equal(out.duration, 2)
    assert.deepEqual([...out.tracks[0]!.times], [0, 1, 2])
    assert.equal(clip.duration, 4)
  })
})

describe('compressClipHold', () => {
  it('keeps raise and lower duration, squashes the hold', () => {
    const clip = new THREE.AnimationClip('v_sign', 12, [identityQuatTrack([0, 1.3, 10.2, 12])])
    const out = compressClipHold(clip, {
      raiseEnd: 1.3,
      lowerStart: 10.2,
      holdDuration: 1,
      name: 'short',
    })
    assert.equal(out.name, 'short')
    assert.ok(Math.abs(out.duration - 4.1) < 1e-6)
    const times = [...out.tracks[0]!.times]
    assert.equal(times[0], 0)
    assert.ok(Math.abs(times[1]! - 1.3) < 1e-6)
    assert.ok(Math.abs(times[2]! - 2.3) < 1e-6)
    assert.ok(Math.abs(times[3]! - 4.1) < 1e-6)
  })
})

describe('shortenVSignClip', () => {
  it('lands near one-third of the hikari v_sign length', () => {
    const duration = 11.683567
    const clip = new THREE.AnimationClip('v_sign', duration, [
      identityQuatTrack([0, V_SIGN_RAISE_END_S, V_SIGN_LOWER_START_S, duration]),
    ])
    const out = shortenVSignClip(clip)
    assert.equal(out.name, V_SIGN_SHORT_ID)
    const expected = duration * V_SIGN_SHORT_LENGTH_RATIO
    assert.ok(Math.abs(out.duration - expected) < 0.05, `duration ${out.duration} vs ${expected}`)
    assert.ok(out.duration < duration / 2)
  })
})
