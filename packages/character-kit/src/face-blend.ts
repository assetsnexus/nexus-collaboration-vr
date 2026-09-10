import { MathUtils } from 'three'
import type { VRM } from '@pixiv/three-vrm'
import type { ExpressionInfo, ExpressionKind } from './expressions.js'
import { FACE_FADE_IN_MS, FACE_FADE_REST_MS, type FaceLayer } from './face-score.js'
import {
  FACE_PULSE_FADE_MS,
  FACE_PULSE_SETTLE_MS,
  createMoodFacePulse,
  stepMoodFacePulse,
  type MoodFacePulseState,
} from './face-pulse.js'

interface Channel {
  current: number
  target: number
  tau: number
  binary: boolean
}

function tauFromMs(fadeMs: number): number {
  return Math.max(0.04, fadeMs / 1000 / 3)
}

/**
 * Smooth emotion / custom blendshape weights. Never writes visemes or blink
 * (lip-sync and BlinkController own those every frame).
 */
export class FaceBlendController {
  private restEmotion = 'neutral'
  private restIntensity = 0.35
  private channels = new Map<string, Channel>()
  private holdTimer: ReturnType<typeof setTimeout> | null = null
  private kinds = new Map<string, ExpressionKind>()
  private binary = new Set<string>()
  /** Non-emotion channels this blender drove (eased back to 0 on restore). */
  private extras = new Set<string>()
  private sampler: ((name: string) => number) | null = null
  /** Last applyRest / no active cue — idle pulse may run. */
  private restLive = false
  private restAppliedName: string | null = null
  /** Presence idle only; off during speech / tools. */
  private pulseEnabled = false
  private pulse: MoodFacePulseState = createMoodFacePulse()

  bindSampler(fn: ((name: string) => number) | null): void {
    this.sampler = fn
  }

  syncMeta(infos: readonly ExpressionInfo[]): void {
    this.kinds.clear()
    this.binary.clear()
    for (const info of infos) {
      this.kinds.set(info.name, info.kind)
      if (info.binary) this.binary.add(info.name)
    }
  }

  reset(): void {
    this.clearHold()
    this.channels.clear()
    this.extras.clear()
    this.restLive = false
    this.restAppliedName = null
    this.pulse = createMoodFacePulse()
  }

  setRest(emotion: string, intensity: number): void {
    this.restEmotion = emotion
    this.restIntensity = MathUtils.clamp(intensity, 0, 1)
    if (this.pulseEnabled) this.pulse = createMoodFacePulse()
  }

  /** Idle presence only. No-ops while a performance face cue owns the face. */
  setPulseEnabled(on: boolean): void {
    if (this.pulseEnabled === on) return
    this.pulseEnabled = on
    if (on) this.pulse = createMoodFacePulse()
    else this.settlePulseToRest()
    console.info('[face-blend] rest pulse', on ? 'on' : 'off', {
      emotion: this.restEmotion,
      intensity: this.restIntensity,
    })
  }

  isRestLive(): boolean {
    return this.restLive
  }

  getRest(): { emotion: string; intensity: number } {
    return { emotion: this.restEmotion, intensity: this.restIntensity }
  }

  clearHold(): void {
    if (this.holdTimer) {
      clearTimeout(this.holdTimer)
      this.holdTimer = null
    }
  }

  /**
   * Drive listed emotion layers; other emotion channels ease to 0.
   * Custom extras in `layers` fade too. Viseme/blink names are ignored.
   */
  applyLayers(
    layers: FaceLayer[],
    resolvedByRequested: Map<string, string>,
    fadeMs = FACE_FADE_IN_MS,
  ): void {
    this.clearHold()
    const tau = tauFromMs(Math.max(0, fadeMs))
    const next = new Map<string, number>()
    for (const [name, kind] of this.kinds) {
      if (kind === 'emotion') next.set(name, 0)
    }
    for (const extra of this.extras) {
      if (!next.has(extra)) next.set(extra, 0)
    }
    const nextExtras = new Set<string>()
    for (const layer of layers) {
      const resolved = resolvedByRequested.get(layer.name) ?? layer.name
      const kind = this.kinds.get(resolved)
      if (kind === 'viseme' || kind === 'blink') continue
      next.set(resolved, MathUtils.clamp(layer.weight, 0, 1))
      if (kind !== 'emotion') nextExtras.add(resolved)
    }
    this.extras = nextExtras
    this.restLive = false
    this.commit(next, tau, fadeMs <= 0)
  }

  applyRest(resolvedRestName: string | null, fadeMs = FACE_FADE_REST_MS): void {
    this.clearHold()
    const tau = tauFromMs(Math.max(0, fadeMs))
    const next = new Map<string, number>()
    for (const [name, kind] of this.kinds) {
      if (kind === 'emotion') next.set(name, 0)
    }
    for (const extra of this.extras) next.set(extra, 0)
    this.extras.clear()
    this.restAppliedName = resolvedRestName
    this.restLive = true
    if (resolvedRestName) next.set(resolvedRestName, this.restIntensity)
    this.commit(next, tau, fadeMs <= 0)
  }

  /** Fade a single non-viseme channel (raw set_expression). */
  applyChannel(name: string, weight: number, fadeMs = FACE_FADE_IN_MS): void {
    const kind = this.kinds.get(name)
    if (kind === 'viseme' || kind === 'blink') return
    const tau = tauFromMs(Math.max(0, fadeMs))
    const ch = this.ensure(name, weight)
    ch.target = MathUtils.clamp(weight, 0, 1)
    ch.tau = tau
    ch.binary = this.binary.has(name)
    if (kind !== 'emotion') this.extras.add(name)
    this.restLive = false
    if (fadeMs <= 0) ch.current = ch.target
  }

  scheduleRestore(delayMs: number, onFire: () => void): void {
    this.clearHold()
    if (delayMs <= 0) {
      onFire()
      return
    }
    this.holdTimer = setTimeout(() => {
      this.holdTimer = null
      onFire()
    }, delayMs)
  }

  update(vrm: VRM | null, delta: number): void {
    const mgr = vrm?.expressionManager
    if (!mgr) return
    const dt = Math.min(0.08, Math.max(0, delta))
    this.tickRestPulse(dt)
    if (this.channels.size === 0) return
    for (const [name, ch] of this.channels) {
      if (this.kinds.get(name) === 'viseme' || this.kinds.get(name) === 'blink') continue
      let cur = ch.current
      if (ch.binary) {
        cur += (ch.target - cur) * (1 - Math.exp(-dt / ch.tau))
        ch.current = cur
        mgr.setValue(name, cur >= 0.5 ? 1 : 0)
        continue
      }
      cur += (ch.target - cur) * (1 - Math.exp(-dt / ch.tau))
      if (Math.abs(ch.target - cur) < 0.003) cur = ch.target
      ch.current = cur
      mgr.setValue(name, cur)
    }
  }

  dispose(): void {
    this.clearHold()
    this.channels.clear()
    this.extras.clear()
    this.restLive = false
    this.pulseEnabled = false
    this.sampler = null
  }

  private tickRestPulse(dt: number): void {
    if (!this.pulseEnabled || !this.restLive || !this.restAppliedName) return
    if (this.holdTimer) return
    const target = stepMoodFacePulse(this.pulse, dt, this.restIntensity)
    const ch = this.ensure(this.restAppliedName, this.restIntensity)
    ch.target = target
    ch.tau = tauFromMs(FACE_PULSE_FADE_MS)
    ch.binary = this.binary.has(this.restAppliedName)
  }

  private settlePulseToRest(): void {
    if (!this.restLive || !this.restAppliedName) return
    const ch = this.channels.get(this.restAppliedName)
    if (!ch) return
    ch.target = this.restIntensity
    ch.tau = tauFromMs(FACE_PULSE_SETTLE_MS)
  }

  private commit(next: Map<string, number>, tau: number, snap: boolean): void {
    for (const [name, target] of next) {
      const ch = this.ensure(name, target)
      ch.target = target
      ch.tau = tau
      ch.binary = this.binary.has(name)
      if (snap) ch.current = target
    }
    for (const [name, ch] of this.channels) {
      if (next.has(name)) continue
      if (this.kinds.get(name) !== 'emotion') continue
      ch.target = 0
      ch.tau = tau
      if (snap) ch.current = 0
    }
  }

  private ensure(name: string, seed: number): Channel {
    let ch = this.channels.get(name)
    if (!ch) {
      const sampled = this.sampler?.(name)
      const current = sampled === undefined ? seed : sampled
      ch = {
        current,
        target: seed,
        tau: tauFromMs(FACE_FADE_IN_MS),
        binary: this.binary.has(name),
      }
      this.channels.set(name, ch)
    }
    return ch
  }
}
