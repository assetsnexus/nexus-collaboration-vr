import type { AnimationClip } from 'three'
import { Vector3, VectorKeyframeTrack } from 'three'
import type { VRM } from '@pixiv/three-vrm'

/**
 * Re-anchor hips position tracks so crossfading Mixamo/VRMA clips does not
 * sink the avatar (AIRI reAnchorRootPositionTrack / three-vrm#1643).
 */
export function reAnchorRootPositionTrack(clip: AnimationClip, vrm: VRM): void {
  const hipNode = vrm.humanoid?.getNormalizedBoneNode('hips')
  if (!hipNode) {
    console.warn('[character-kit] reAnchor: no hips node')
    return
  }
  hipNode.updateMatrixWorld(true)
  const defaultHipPos = new Vector3()
  hipNode.getWorldPosition(defaultHipPos)

  const hipsTrack = clip.tracks.find(
    (track) =>
      track instanceof VectorKeyframeTrack && track.name === `${hipNode.name}.position`,
  )
  if (!(hipsTrack instanceof VectorKeyframeTrack)) {
    return
  }

  const animeHipPos = new Vector3(hipsTrack.values[0], hipsTrack.values[1], hipsTrack.values[2])
  const animeDelta = new Vector3().subVectors(animeHipPos, defaultHipPos)

  for (const track of clip.tracks) {
    if (track.name.endsWith('.position') && track instanceof VectorKeyframeTrack) {
      for (let i = 0; i < track.values.length; i += 3) {
        track.values[i]! -= animeDelta.x
        track.values[i + 1]! -= animeDelta.y
        track.values[i + 2]! -= animeDelta.z
      }
    }
  }
}
