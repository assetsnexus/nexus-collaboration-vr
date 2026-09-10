import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import * as THREE from 'three'
import {
  bonesMissingFromClip,
  captureHumanoidRestQuats,
  filterIdleTracksForOccupancy,
  idleTrackIsOccupied,
  occupancySet,
  padClipWithRestHolds,
  omitNearRestTracks,
  RestPoseReturn,
  restHoldForBone,
  restReturnBones,
  type BoneRestHold,
} from './idle-rest-tracks.ts'

function hold(bone: string, nodeName: string, quat = new THREE.Quaternion()): BoneRestHold {
  return { bone, trackName: `${nodeName}.quaternion`, quat }
}

describe('occupancySet / idleTrackIsOccupied', () => {
  it('treats VRMA Normalized_Head and procedural head as the same bone', () => {
    const occupied = occupancySet(['head.quaternion', 'Normalized_Neck'])
    assert.equal(occupied.has('head'), true)
    assert.equal(occupied.has('neck'), true)
    assert.equal(idleTrackIsOccupied('Normalized_Head.quaternion', occupied), true)
    assert.equal(idleTrackIsOccupied('neck.quaternion', occupied), true)
    assert.equal(idleTrackIsOccupied('Normalized_RightUpperArm.quaternion', occupied), false)
  })
})

describe('bonesMissingFromClip', () => {
  it('lists overlay bones idle does not key', () => {
    const idle = {
      tracks: [
        { name: 'Normalized_Hips.quaternion' },
        { name: 'spine.quaternion' },
      ],
    }
    assert.deepEqual(bonesMissingFromClip(idle, ['head', 'Normalized_Neck', 'spine']), [
      'head',
      'neck',
    ])
  })

  it('is empty when idle already covers the overlay', () => {
    const idle = { tracks: [{ name: 'Normalized_Head.quaternion' }] }
    assert.deepEqual(bonesMissingFromClip(idle, ['head']), [])
  })
})

describe('filterIdleTracksForOccupancy', () => {
  it('strips idle rest holds for overlay-occupied bones so the nod is not 50/50-blended', () => {
    const tracks = [
      { name: 'Normalized_Hips.quaternion' },
      { name: 'Normalized_Head.quaternion' },
      { name: 'neck.quaternion' },
      { name: 'Normalized_LeftUpperArm.quaternion' },
    ]
    const kept = filterIdleTracksForOccupancy(tracks, occupancySet(['head', 'neck']))
    assert.deepEqual(
      kept.map((t) => t.name),
      ['Normalized_Hips.quaternion', 'Normalized_LeftUpperArm.quaternion'],
    )
  })

  it('keeps idle arms when a lower-body walk clip does not key them', () => {
    const tracks = [
      { name: 'Normalized_Hips.quaternion' },
      { name: 'Normalized_LeftUpperLeg.quaternion' },
      { name: 'Normalized_LeftUpperArm.quaternion' },
      { name: 'Normalized_RightUpperArm.quaternion' },
    ]
    const kept = filterIdleTracksForOccupancy(
      tracks,
      occupancySet(['hips', 'leftupperleg', 'rightupperleg']),
    )
    assert.deepEqual(
      kept.map((t) => t.name),
      ['Normalized_LeftUpperArm.quaternion', 'Normalized_RightUpperArm.quaternion'],
    )
  })
})

describe('padClipWithRestHolds', () => {
  it('adds rest quaternion holds for bones idle omits', () => {
    const idle = new THREE.AnimationClip('idle', 2, [
      new THREE.QuaternionKeyframeTrack(
        'Normalized_Hips.quaternion',
        [0, 2],
        [0, 0, 0, 1, 0, 0, 0, 1],
      ),
    ])
    const rest = new THREE.Quaternion(0, 0.2, 0, 0.979795897)
    const { clip, added } = padClipWithRestHolds(idle, [
      hold('hips', 'Normalized_Hips', new THREE.Quaternion()),
      hold('head', 'Normalized_Head', rest),
      hold('neck', 'Normalized_Neck', rest),
    ])
    assert.deepEqual(added.sort(), ['head', 'neck'])
    assert.equal(clip.tracks.length, 3)
    const head = clip.tracks.find((t) => t.name === 'Normalized_Head.quaternion')
    assert.ok(head)
    assert.equal(head.values.length, 8)
    assert.ok(Math.abs(head.values[1]! - rest.y) < 1e-5)
    assert.ok(Math.abs(head.values[3]! - rest.w) < 1e-5)
    assert.deepEqual(bonesMissingFromClip(clip, ['head', 'neck', 'hips']), [])
  })

  it('does not duplicate tracks already keyed under a different VRMA name', () => {
    const idle = new THREE.AnimationClip('idle', 1, [
      new THREE.QuaternionKeyframeTrack('head.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]),
    ])
    const { clip, added } = padClipWithRestHolds(idle, [hold('head', 'Normalized_Head')])
    assert.deepEqual(added, [])
    assert.equal(clip, idle)
  })
})

describe('omitNearRestTracks', () => {
  it('drops bind-hold hips/arms and keeps an animated head', () => {
    const rest = new THREE.Quaternion()
    const nod = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, 0, 0))
    const clip = new THREE.AnimationClip('nod', 0.5, [
      new THREE.QuaternionKeyframeTrack(
        'Normalized_Hips.quaternion',
        [0, 0.5],
        [0, 0, 0, 1, 0, 0, 0, 1],
      ),
      new THREE.QuaternionKeyframeTrack(
        'Normalized_LeftUpperArm.quaternion',
        [0, 0.5],
        [0, 0, 0, 1, 0, 0, 0, 1],
      ),
      new THREE.QuaternionKeyframeTrack(
        'Normalized_Head.quaternion',
        [0, 0.25, 0.5],
        [rest.x, rest.y, rest.z, rest.w, nod.x, nod.y, nod.z, nod.w, rest.x, rest.y, rest.z, rest.w],
      ),
    ])
    const { clip: out, dropped } = omitNearRestTracks(clip, [
      hold('hips', 'Normalized_Hips'),
      hold('leftupperarm', 'Normalized_LeftUpperArm'),
      hold('head', 'Normalized_Head'),
    ])
    assert.deepEqual(dropped.sort(), ['hips', 'leftupperarm'])
    assert.equal(out.tracks.length, 1)
    assert.equal(out.tracks[0]?.name, 'Normalized_Head.quaternion')
  })

  it('drops a static hips.position hold so the clip can stay an overlay', () => {
    const nod = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, 0, 0))
    const rest = new THREE.Quaternion()
    const clip = new THREE.AnimationClip('nod', 0.5, [
      new THREE.VectorKeyframeTrack('Normalized_Hips.position', [0, 0.5], [0, 1, 0, 0, 1, 0]),
      new THREE.QuaternionKeyframeTrack(
        'Normalized_Head.quaternion',
        [0, 0.25, 0.5],
        [rest.x, rest.y, rest.z, rest.w, nod.x, nod.y, nod.z, nod.w, rest.x, rest.y, rest.z, rest.w],
      ),
    ])
    const { clip: out, dropped } = omitNearRestTracks(clip, [hold('head', 'Normalized_Head')])
    assert.ok(dropped.includes('hips'))
    assert.equal(out.tracks.length, 1)
    assert.equal(out.tracks[0]?.name, 'Normalized_Head.quaternion')
  })

  it('keeps a held pose that is not bind', () => {
    const held = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 1.1))
    const clip = new THREE.AnimationClip('wave', 1, [
      new THREE.QuaternionKeyframeTrack(
        'Normalized_RightUpperArm.quaternion',
        [0, 1],
        [held.x, held.y, held.z, held.w, held.x, held.y, held.z, held.w],
      ),
    ])
    const { dropped } = omitNearRestTracks(clip, [hold('rightupperarm', 'Normalized_RightUpperArm')])
    assert.deepEqual(dropped, [])
  })
})

describe('captureHumanoidRestQuats', () => {
  it('records node.quaternion clones for normalized bones', () => {
    const headQ = new THREE.Quaternion(0, 0.1, 0, 1).normalize()
    const vrm = {
      humanoid: {
        getNormalizedBoneNode(name: string) {
          if (name !== 'head') return null
          return { name: 'Normalized_Head', quaternion: headQ }
        },
      },
    }
    const holds = captureHumanoidRestQuats(vrm)
    assert.equal(holds.length, 1)
    assert.equal(holds[0]?.trackName, 'Normalized_Head.quaternion')
    assert.equal(holds[0]?.quat.y, headQ.y)
    holds[0]!.quat.y = 0
    assert.notEqual(headQ.y, 0)
  })
})

describe('restReturnBones', () => {
  it('returns every occupied bone when idle is missing', () => {
    assert.deepEqual(restReturnBones(['head', 'Normalized_Neck'], null).sort(), ['head', 'neck'])
  })

  it('does not slerp overlay bones idle already keys (avoids T-pose flash)', () => {
    const idle = {
      tracks: [
        { name: 'Normalized_Head.quaternion' },
        { name: 'Normalized_Neck.quaternion' },
        { name: 'Normalized_LeftUpperArm.quaternion' },
      ],
    }
    assert.deepEqual(restReturnBones(['head', 'neck', 'leftupperarm'], idle), [])
  })

  it('returns only bones idle does not cover', () => {
    const idle = { tracks: [{ name: 'Normalized_LeftUpperArm.quaternion' }] }
    assert.deepEqual(restReturnBones(['head', 'leftupperarm'], idle), ['head'])
  })
})

describe('restHoldForBone', () => {
  it('matches VRMA and procedural occupancy names', () => {
    const holds = [hold('head', 'Normalized_Head')]
    assert.equal(restHoldForBone(holds, 'head')?.bone, 'head')
    assert.equal(restHoldForBone(holds, 'Normalized_Head.quaternion')?.bone, 'head')
    assert.equal(restHoldForBone(holds, 'neck'), undefined)
  })
})

describe('RestPoseReturn', () => {
  it('slerps a leftover overlay pose back to rest without overshoot', () => {
    const rest = new THREE.Quaternion()
    const leftover = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.6, -0.5, 0.1))
    const node = { quaternion: leftover.clone() }
    const ret = new RestPoseReturn()
    ret.begin([{ node, rest }], 0.2)
    assert.equal(ret.active, true)
    ret.update(0.1)
    assert.ok(node.quaternion.angleTo(leftover) > 0.05)
    assert.ok(node.quaternion.angleTo(rest) < leftover.angleTo(rest))
    ret.update(0.2)
    assert.equal(ret.active, false)
    assert.ok(node.quaternion.angleTo(rest) < 1e-5)
  })

  it('replaces only overlapping bones when a new overlay starts', () => {
    const rest = new THREE.Quaternion()
    const head = { quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, 0, 0)) }
    const arm = { quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0.4)) }
    const ret = new RestPoseReturn()
    ret.begin(
      [
        { node: head, rest },
        { node: arm, rest },
      ],
      0.3,
    )
    ret.drop([head])
    ret.update(0.3)
    assert.ok(head.quaternion.angleTo(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, 0, 0))) < 1e-5)
    assert.ok(arm.quaternion.angleTo(rest) < 1e-5)
  })
})
