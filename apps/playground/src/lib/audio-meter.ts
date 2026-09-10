/** RMS of byte time-domain data (128 = silence). */
export function rmsFromTimeDomain(data: ArrayLike<number>): number {
  const n = data.length
  if (!n) return 0
  let sum = 0
  for (let i = 0; i < n; i++) {
    const v = (data[i]! - 128) / 128
    sum += v * v
  }
  return Math.sqrt(sum / n)
}

/** RMS of float PCM in [-1, 1]. */
export function rmsFromFloat32(data: ArrayLike<number>): number {
  const n = data.length
  if (!n) return 0
  let sum = 0
  for (let i = 0; i < n; i++) {
    const s = data[i]!
    sum += s * s
  }
  return Math.sqrt(sum / n)
}

/**
 * Map RMS + optional speech probability into 0..1 display energy.
 * Speech probability (Silero) keeps idle noise from filling the wave.
 */
export function speechEnergy(rms: number, speechProb = 1): number {
  const raw = Math.min(1, Math.max(0, rms) * 8)
  const gated = raw * Math.max(0.04, Math.min(1, speechProb))
  return Math.min(1, gated)
}

/** Per-bar heights for a compact soundwave. `phase` is radians (rAF time). */
export function waveBarHeights(
  energy: number,
  count: number,
  phase = 0,
): number[] {
  const n = Math.max(1, Math.floor(count))
  const e = Math.min(1, Math.max(0, energy))
  const out = new Array<number>(n)
  for (let i = 0; i < n; i++) {
    const center = (n - 1) / 2
    const dist = Math.abs(i - center) / Math.max(1, center)
    const wobble = 0.55 + 0.45 * Math.sin(phase + i * 0.85)
    const h = 0.16 + e * (0.22 + 0.62 * wobble) * (1 - dist * 0.35)
    out[i] = Math.min(1, Math.max(0.16, h))
  }
  return out
}

export function readAnalyserRms(analyser: AnalyserNode, buf: Uint8Array): number {
  analyser.getByteTimeDomainData(buf as unknown as Uint8Array<ArrayBuffer>)
  return rmsFromTimeDomain(buf)
}
