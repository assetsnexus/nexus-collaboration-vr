import * as THREE from 'three'

/**
 * hikari-archive `v_sign.vrma` (~11.7s): raise finishes ~1.3s, hold until ~10.2s,
 * then the hand comes down. Used to clone a short variant without a second VRMA.
 */
export const V_SIGN_RAISE_END_S = 1.3
export const V_SIGN_LOWER_START_S = 10.2
export const V_SIGN_SHORT_LENGTH_RATIO = 1 / 3
export const V_SIGN_SHORT_ID = 'v_sign_short'

export type TimeMap = (t: number) => number

/** Clone a clip with remapped key times. Duration is `mapTime(clip.duration)`. */
export function timeRemapClip(
  clip: THREE.AnimationClip,
  mapTime: TimeMap,
  name?: string,
): THREE.AnimationClip {
  const tracks = clip.tracks.map((track) => {
    const next = track.clone()
    const times = next.times
    for (let i = 0; i < times.length; i++) times[i] = mapTime(times[i]!)
    return next
  })
  const duration = Math.max(0, mapTime(clip.duration))
  const out = new THREE.AnimationClip(name ?? clip.name, duration, tracks)
  out.blendMode = clip.blendMode
  return out
}

/**
 * Keep raise and lower at original speed; squash the middle hold to `holdDuration`.
 */
export function compressClipHold(
  clip: THREE.AnimationClip,
  opts: { raiseEnd: number; lowerStart: number; holdDuration: number; name?: string },
): THREE.AnimationClip {
  const raiseEnd = Math.max(0, opts.raiseEnd)
  const lowerStart = Math.max(raiseEnd, opts.lowerStart)
  const holdDuration = Math.max(0, opts.holdDuration)
  const holdSpan = Math.max(1e-4, lowerStart - raiseEnd)
  const mapTime: TimeMap = (t) => {
    if (t <= raiseEnd) return t
    if (t <= lowerStart) return raiseEnd + ((t - raiseEnd) / holdSpan) * holdDuration
    return raiseEnd + holdDuration + (t - lowerStart)
  }
  return timeRemapClip(clip, mapTime, opts.name)
}

/** ~⅓ wall-clock length: same raise, ~1s hold, original lower. */
export function shortenVSignClip(clip: THREE.AnimationClip): THREE.AnimationClip {
  const duration = clip.duration
  const raiseEnd = Math.min(V_SIGN_RAISE_END_S, duration)
  const lowerStart = Math.min(Math.max(V_SIGN_LOWER_START_S, raiseEnd), duration)
  const lowerDur = Math.max(0, duration - lowerStart)
  const target = duration * V_SIGN_SHORT_LENGTH_RATIO
  const holdDuration = Math.max(0.25, target - raiseEnd - lowerDur)
  return compressClipHold(clip, {
    raiseEnd,
    lowerStart,
    holdDuration,
    name: V_SIGN_SHORT_ID,
  })
}
