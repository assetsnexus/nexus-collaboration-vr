import type { CharacterController } from './controller.js'
import { FACE_FADE_MOOD_MS } from './face-score.js'
import { isSitRestLoopId } from './seat-prop.js'
import {
  listPresenceMoods,
  resolvePresenceMood,
  type PresenceMoodDef,
  type PresenceMoodId,
} from './presence-moods.js'

export type PresenceTier = 'micro' | 'medium' | 'long'

export interface IdlePresenceOptions {
  enabled?: boolean
  /** Override base long-idle threshold (default 10 min). Mood scales this. */
  longIdleMs?: number
  microMinMs?: number
  microMaxMs?: number
  mediumMinMs?: number
  mediumMaxMs?: number
  /** Starting ambient mood */
  mood?: PresenceMoodId | string
  /** Fired when an ambient routine gesture starts. */
  onBeat?: (info: { tier: string; gesture: string; mood: string }) => void
}

interface TierRuntime {
  tier: PresenceTier
  baseMinMs: number
  baseMaxMs: number
  afterSilentBaseMs: number
  loop?: boolean
}

/**
 * Client-only ambient life for secondary-display companions.
 * Gesture pools / tempo / face follow the active mood (LLM can set/list).
 */
export class IdlePresenceDirector {
  private timer: ReturnType<typeof setTimeout> | null = null
  private kickTimer: ReturnType<typeof setTimeout> | null = null
  private silentSince = Date.now()
  private lastGesture: string | null = null
  private longRestActive = false
  private paused = false
  private disposed = false
  private readonly enabled: boolean
  private readonly baseLongMs: number
  private readonly tierBases: TierRuntime[]
  private mood: PresenceMoodDef
  private onBeat: IdlePresenceOptions['onBeat']

  constructor(
    private controller: CharacterController | null,
    opts: IdlePresenceOptions = {},
  ) {
    this.enabled = opts.enabled !== false
    this.baseLongMs = opts.longIdleMs ?? 10 * 60 * 1000
    this.mood = resolvePresenceMood(opts.mood ?? 'neutral') ?? resolvePresenceMood('neutral')!
    this.onBeat = opts.onBeat
    this.tierBases = [
      {
        tier: 'micro',
        afterSilentBaseMs: 8_000,
        baseMinMs: opts.microMinMs ?? 8_000,
        baseMaxMs: opts.microMaxMs ?? 40_000,
      },
      {
        tier: 'medium',
        afterSilentBaseMs: 2 * 60_000,
        baseMinMs: opts.mediumMinMs ?? 2 * 60_000,
        baseMaxMs: opts.mediumMaxMs ?? 5 * 60_000,
      },
      {
        tier: 'long',
        afterSilentBaseMs: this.baseLongMs,
        baseMinMs: this.baseLongMs,
        baseMaxMs: this.baseLongMs + 30_000,
        loop: true,
      },
    ]
  }

  setController(controller: CharacterController | null): void {
    this.controller = controller
    if (controller && this.enabled && !this.paused && !this.disposed) {
      this.applyMoodFace()
      this.applyMoodBody()
      controller.setRestPulseEnabled(true)
      controller.setIdlePulseEnabled(true)
    }
  }

  getMood(): PresenceMoodDef {
    return this.mood
  }

  listMoods(): PresenceMoodDef[] {
    return listPresenceMoods()
  }

  /**
   * Switch ambient mood. Applies face immediately; regenerates routine pools.
   * Returns false if unknown id.
   */
  setMood(id: string, opts: { applyFace?: boolean } = {}): boolean {
    const next = resolvePresenceMood(id)
    if (!next) {
      console.warn('[idle-presence] unknown mood', id)
      return false
    }
    // Same mood: no mixer yank / no action-feed spam.
    if (this.mood.id === next.id) return false
    this.mood = next
    this.longRestActive = false
    this.applyMoodBody()
    if (opts.applyFace !== false) this.applyMoodFace()
    console.info('[idle-presence] mood', next.id)
    if (!this.paused) {
      this.kickMoodFidgetSoon()
      this.scheduleNext()
    }
    return true
  }

  applyMoodFace(): void {
    this.controller?.setRestFace(this.mood.faceEmotion, this.mood.faceIntensity)
    this.controller?.restoreRestFace(FACE_FADE_MOOD_MS)
  }

  /** Standing rest loop + energy (timeScale) + idle breath pulse. */
  applyMoodBody(): void {
    this.controller?.setIdleLoop('idle', {
      crossFade: 0.4,
      timeScale: this.mood.idleTimeScale,
    })
    this.controller?.setIdlePulseEnabled(!this.paused && this.enabled)
  }

  /** Sit rest loop + seat cube. Playground debug / long-idle tier. */
  enterLongRest(): void {
    if (this.disposed || this.paused) return
    this.longRestActive = true
    this.controller?.setIdleLoop('sit', {
      crossFade: 0.5,
      timeScale: this.mood.idleTimeScale,
    })
    this.controller?.setIdlePulseEnabled(true)
    this.applyMoodFace()
    this.lastGesture = 'sit'
    console.info('[idle-presence] beat', {
      tier: 'long',
      gesture: 'sit',
      mood: this.mood.id,
    })
    this.scheduleNext()
  }

  /** Describe routines for tool results / prompts. */
  describeMoodState(): {
    mood: string
    description: string
    faceEmotion: string
    idleTimeScale: number
    routines: {
      micro: string[]
      medium: string[]
      long: string[]
      sitFidgets: string[]
      longIdleMs: number
    }
  } {
    return {
      mood: this.mood.id,
      description: this.mood.description,
      faceEmotion: this.mood.faceEmotion,
      idleTimeScale: this.mood.idleTimeScale,
      routines: {
        micro: this.mood.microGestures,
        medium: this.mood.mediumGestures,
        long: this.mood.longGestures,
        sitFidgets: this.mood.sitFidgets,
        longIdleMs: Math.round(this.baseLongMs * this.mood.longIdleScale),
      },
    }
  }

  pause(reason = 'speech'): void {
    this.paused = true
    this.clearTimer()
    this.clearKickTimer()
    this.controller?.setRestPulseEnabled(false)
    this.controller?.setIdlePulseEnabled(false)
    const seated = isSitRestLoopId(this.controller?.getIdleLoopId())
    if (this.longRestActive || seated) {
      this.longRestActive = false
      if (reason === 'locomotion') {
        this.controller?.clearSitRest()
      } else {
        this.controller?.setIdleLoop('idle', { crossFade: 0.4 })
      }
    }
    console.info('[idle-presence] pause', reason)
  }

  resume(): void {
    this.paused = false
    this.silentSince = Date.now()
    this.applyMoodFace()
    this.applyMoodBody()
    this.controller?.setRestPulseEnabled(true)
    this.scheduleNext()
  }

  resetClock(reason = 'interaction'): void {
    this.silentSince = Date.now()
    if (this.longRestActive || isSitRestLoopId(this.controller?.getIdleLoopId())) {
      this.longRestActive = false
      this.controller?.setIdleLoop('idle', { crossFade: 0.35 })
    }
    console.info('[idle-presence] resetClock', reason)
    if (!this.paused) this.scheduleNext()
  }

  start(): void {
    if (!this.enabled || this.disposed) return
    this.silentSince = Date.now()
    this.applyMoodFace()
    this.applyMoodBody()
    this.controller?.setRestPulseEnabled(true)
    this.scheduleNext()
  }

  stop(): void {
    this.controller?.setRestPulseEnabled(false)
    this.controller?.setIdlePulseEnabled(false)
    this.clearTimer()
    this.clearKickTimer()
  }

  dispose(): void {
    this.disposed = true
    this.controller?.setRestPulseEnabled(false)
    this.controller?.setIdlePulseEnabled(false)
    this.clearTimer()
    this.clearKickTimer()
  }

  private scaledTiers(): Array<{
    tier: PresenceTier
    afterSilentMs: number
    minMs: number
    maxMs: number
    gestures: string[]
    loop?: boolean
  }> {
    const tempo = this.mood.tempo
    const longScale = this.mood.longIdleScale
    return this.tierBases.map((t) => {
      if (t.tier === 'long') {
        const longMs = this.baseLongMs * longScale
        return {
          tier: t.tier,
          afterSilentMs: longMs,
          minMs: longMs,
          maxMs: longMs + 30_000,
          gestures: this.mood.longGestures,
          loop: true,
        }
      }
      const pool =
        t.tier === 'micro' ? this.mood.microGestures : this.mood.mediumGestures
      return {
        tier: t.tier,
        afterSilentMs: t.afterSilentBaseMs * tempo,
        minMs: t.baseMinMs * tempo,
        maxMs: t.baseMaxMs * tempo,
        gestures: pool,
        loop: t.loop,
      }
    })
  }

  private scheduleNext(): void {
    if (!this.enabled || this.disposed || this.paused) return
    this.clearTimer()

    if (this.longRestActive) {
      const min = 12_000 * this.mood.tempo
      const max = 28_000 * this.mood.tempo
      const wait = min + Math.random() * Math.max(0, max - min)
      this.timer = setTimeout(() => {
        this.timer = null
        this.tickSitFidget()
      }, wait)
      return
    }

    const tiers = this.scaledTiers()
    const silentMs = Date.now() - this.silentSince
    let chosen = tiers[0]!
    for (const t of tiers) {
      if (silentMs >= t.afterSilentMs) chosen = t
    }

    const delay =
      chosen.minMs + Math.random() * Math.max(0, chosen.maxMs - chosen.minMs)
    const wait = Math.min(delay, 45_000)

    this.timer = setTimeout(() => {
      this.timer = null
      this.tickPresence()
    }, wait)
  }

  private tickPresence(): void {
    if (this.disposed || this.paused || !this.controller) {
      this.scheduleNext()
      return
    }

    const tiers = this.scaledTiers()
    const silentMs = Date.now() - this.silentSince
    let tier = null as (typeof tiers)[number] | null
    for (const t of [...tiers].reverse()) {
      if (silentMs >= t.afterSilentMs) {
        tier = t
        break
      }
    }
    if (!tier) {
      this.scheduleNext()
      return
    }

    if (tier.tier === 'long') {
      if (!this.longRestActive) this.enterLongRest()
      else this.scheduleNext()
      return
    }

    const id = this.pickGesture(tier.gestures)
    const available = this.controller.listGestures()
    if (!available.includes(id)) {
      console.warn('[idle-presence] missing gesture', id, 'mood', this.mood.id)
      this.scheduleNext()
      return
    }
    const result = this.controller.playGesture(id, Boolean(tier.loop), 0.35, undefined, 'routine')
    if (result === 'skipped') {
      this.scheduleNext()
      return
    }
    this.lastGesture = id
    this.onBeat?.({ tier: tier.tier, gesture: id, mood: this.mood.id })
    console.info('[idle-presence] beat', {
      tier: tier.tier,
      gesture: id,
      silentMs,
      mood: this.mood.id,
      overlap: result,
    })
    this.scheduleNext()
  }

  private tickSitFidget(): void {
    if (this.disposed || this.paused || !this.controller || !this.longRestActive) {
      this.scheduleNext()
      return
    }
    const id = this.pickGesture(this.mood.sitFidgets)
    if (id && id !== 'sit') {
      const result = this.controller.playGesture(id, false, 0.3, undefined, 'routine')
      if (result !== 'skipped') {
        this.lastGesture = id
        this.onBeat?.({ tier: 'sit_fidget', gesture: id, mood: this.mood.id })
        console.info('[idle-presence] beat', {
          tier: 'sit_fidget',
          gesture: id,
          mood: this.mood.id,
          overlap: result,
        })
      }
    }
    this.scheduleNext()
  }

  private kickMoodFidgetSoon(): void {
    this.clearKickTimer()
    this.kickTimer = setTimeout(() => {
      this.kickTimer = null
      if (this.disposed || this.paused || this.longRestActive || !this.controller) return
      const id = this.pickGesture(this.mood.microGestures)
      if (!id) return
      const result = this.controller.playGesture(id, false, 0.35, undefined, 'routine')
      if (result === 'skipped') return
      this.lastGesture = id
      console.info('[idle-presence] beat', {
        tier: 'mood_kick',
        gesture: id,
        mood: this.mood.id,
        overlap: result,
      })
    }, 500 + Math.random() * 700)
  }

  private pickGesture(pool: string[]): string {
    const available = this.controller?.listGestures() ?? []
    const filtered = pool.filter((g) => available.includes(g) && g !== this.lastGesture)
    const use = filtered.length ? filtered : pool.filter((g) => available.includes(g))
    if (!use.length) return pool[0]!
    return use[Math.floor(Math.random() * use.length)]!
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  private clearKickTimer(): void {
    if (this.kickTimer) {
      clearTimeout(this.kickTimer)
      this.kickTimer = null
    }
  }
}
