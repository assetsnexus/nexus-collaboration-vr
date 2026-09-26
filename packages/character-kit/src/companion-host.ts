import type { CharacterController } from './controller.js'
import { CharacterController as CharacterControllerImpl } from './controller.js'
import { AnimationDirector, type DirectorOptions } from './animation-director.js'
import type { CharacterActionEvent, CharacterActionSource } from './action-feed.js'
import type { ClothesSpec } from './clothes.js'
import type { ClothesOverlayPiece } from './clothes-transform.js'
import type { CharacterOptions, GestureManifest, LoadedGestureInfo } from './types.js'
import type { PresenceMoodId } from './presence-moods.js'
import { listPresenceMoods } from './presence-moods.js'
import { listLogicalGestureIds } from './gesture-variants.js'
import {
  defaultInlineCatalog,
  parseInlineTags,
  type InlineTagCatalog,
  type ParsedInlineTags,
} from './inline-tags.js'
import { DEFAULT_GAZE_LIMITS, type GazeLimits } from './gaze.js'
import type { MoveInput } from './locomotion.js'
import type { WalkTrailOptions } from './walk-trail.js'
import {
  InteractionAck,
  type InteractionAckOptions,
} from './interaction-ack.js'
import { StandInMarker } from './stand-in.js'
import { fetchCachedArrayBuffer, preloadCharacterAssets } from './asset-cache.js'

export type CompanionClothesInput = {
  id?: string
  ids?: string[]
  overlayPieces?: ClothesOverlayPiece[]
}

export type CompanionLoadOptions = {
  vrmUrl: string
  /** Absolute URL to gesture manifest (JSON). Gesture entry URLs are rewritten relative to its directory. */
  gestureManifestUrl?: string
  mood?: string
  clothes?: CompanionClothesInput
  pointerLook?: boolean
  bodyFollowCamera?: boolean
  gazeLimits?: Partial<GazeLimits>
  presence?: DirectorOptions['presence']
}

export type CompanionHostOptions = CharacterOptions & {
  logger?: Pick<Console, 'info' | 'warn' | 'error'>
  agentId?: string
}

/**
 * Framework-agnostic companion session: CharacterController + AnimationDirector
 * with the same boot sequence as the playground (VRM → gesture pack → idle → presence).
 * Use from Vue, React, or tests — do not clone playground UI into apps.
 */
export class CompanionHost {
  readonly controller: CharacterController
  readonly director: AnimationDirector
  private readonly logger: Pick<Console, 'info' | 'warn' | 'error'>
  private disposed = false
  private loadedUrl: string | null = null
  private unsubLoco: (() => void) | null = null
  private unsubUser: (() => void) | null = null
  private readonly interactionAck: InteractionAck
  private readonly standIn: StandInMarker
  private lastUserLogAt: Record<string, number> = {}

  constructor(canvas: HTMLCanvasElement, options: CompanionHostOptions = {}) {
    this.logger = options.logger ?? console
    this.controller = new CharacterControllerImpl(canvas, {
      background: options.background ?? 0x12171c,
      orbitControls: options.orbitControls !== false,
      pointerLook: options.pointerLook !== false,
      bodyFollowCamera: options.bodyFollowCamera === true,
      maxPixelRatio: options.maxPixelRatio,
      embed: options.embed,
      agentId: options.agentId,
    })
    this.director = new AnimationDirector(this.controller, {
      presence: { enabled: true, mood: 'neutral' },
    })
    if (options.agentId) this.director.setAgentId(options.agentId)
    this.unsubLoco = this.controller.onLocomoting((moving) => {
      if (moving) {
        this.director.pausePresence('locomotion')
        this.logUserThrottled('walk', 'walk', 'start', 800)
      } else this.director.resumePresence()
    })
    this.unsubUser = this.bindUserFeed(canvas)
    this.standIn = new StandInMarker(0x7eb8ff)
    this.controller.attachHelper(this.standIn.root)
    this.controller.getRig().visible = false
    this.interactionAck = new InteractionAck(canvas, (id, meta) => {
      this.playAckGesture(id, meta.reason, meta.timeScale)
    })
  }

  getPresence() {
    return this.director.getPresence()
  }

  onAction(listener: (ev: CharacterActionEvent) => void): () => void {
    return this.director.onAction(listener)
  }

  pushAction(
    op: string,
    label: string,
    source: CharacterActionSource,
    detail?: string,
  ): void {
    this.director.pushAction(op, label, source, detail)
  }

  private logUserThrottled(key: string, op: string, label: string, minMs: number): void {
    const now = Date.now()
    if ((this.lastUserLogAt[key] ?? 0) + minMs > now) return
    this.lastUserLogAt[key] = now
    this.director.pushAction(op, label, 'user', key)
  }

  private bindUserFeed(canvas: HTMLCanvasElement): () => void {
    const onPointerDown = (e: PointerEvent) => {
      if (e.button === 0) this.logUserThrottled('click', 'camera', 'pointer', 400)
      else if (e.button === 2) this.logUserThrottled('orbit', 'camera', 'orbit', 400)
      else if (e.button === 1) this.logUserThrottled('pan', 'camera', 'pan', 400)
    }
    const onWheel = () => {
      this.logUserThrottled('zoom', 'camera', 'zoom', 350)
    }
    const onPointerMove = (e: PointerEvent) => {
      if (e.buttons & 1 || e.buttons & 2) {
        this.logUserThrottled('orbit', 'camera', 'drag', 700)
      }
    }
    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('wheel', onWheel, { passive: true })
    canvas.addEventListener('pointermove', onPointerMove, { passive: true })
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('pointermove', onPointerMove)
    }
  }

  /**
   * Load (or reload) avatar + gestures + clothes, then start ambient presence.
   */
  async load(opts: CompanionLoadOptions): Promise<void> {
    if (this.disposed) throw new Error('CompanionHost disposed')
    this.interactionAck.setReady(false)
    this.standIn.setLoadFailed(false)
    this.standIn.setVisible(true)
    this.standIn.setLoadProgress(0)
    this.controller.getRig().visible = false
    const mood = (opts.mood || 'neutral') as PresenceMoodId

    this.controller.setPointerLookEnabled(opts.pointerLook !== false)
    this.controller.setBodyFollowCamera(opts.bodyFollowCamera === true)
    if (opts.gazeLimits) {
      this.controller.setGazeLimits({ ...DEFAULT_GAZE_LIMITS, ...opts.gazeLimits })
    }

    await this.controller.setClothes(toClothesSpec(opts.clothes))
    if (this.disposed) throw new Error('CompanionHost disposed')
    try {
      await this.controller.loadVRM(opts.vrmUrl, (ratio) => this.standIn.setLoadProgress(ratio))
    } catch (err) {
      this.standIn.setLoadProgress(null)
      this.standIn.setLoadFailed(true)
      throw err
    }
    if (this.disposed) throw new Error('CompanionHost disposed')
    this.loadedUrl = opts.vrmUrl
    this.controller.getRig().visible = true
    this.standIn.setLoadProgress(null)
    this.standIn.setVisible(false)

    this.controller.setSaccadesEnabled(true)
    this.director.setController(this.controller)
    this.getPresence().setMood(mood)
    this.director.scheduleThinking()
    this.interactionAck.setReady(true)
    if (!this.controller.isIdlePlaying()) {
      this.controller.setIdleLoop('idle', { crossFade: 0 })
    }
    this.logger.info?.('[character-kit] CompanionHost ready', {
      vrmUrl: opts.vrmUrl,
      mood,
    })

    if (opts.gestureManifestUrl) {
      const packUrl = opts.gestureManifestUrl
      void (async () => {
        try {
          const manifest = await fetchRewrittenManifest(packUrl)
          if (this.disposed) return
          await this.controller.loadGesturePack(manifest)
          if (this.disposed) return
          if (!this.controller.isIdlePlaying()) {
            this.controller.setIdleLoop('idle', { crossFade: 0 })
          }
        } catch (err) {
          if (this.disposed) return
          this.logger.warn?.('[character-kit] CompanionHost gesture pack failed', err)
        }
      })()
    }
  }

  async setClothes(clothes?: CompanionClothesInput): Promise<void> {
    await this.controller.setClothes(toClothesSpec(clothes))
  }

  setMood(mood: string, source: CharacterActionSource = 'user', detail = 'config'): boolean {
    const ok = this.getPresence().setMood(mood)
    if (ok) this.director.pushAction('mood', mood, source, detail)
    return ok
  }

  playGesture(
    id: string,
    loop = false,
    source: CharacterActionSource = 'user',
    detail = 'config',
    timeScale?: number,
    sceneTarget?: string,
  ): void {
    if (this.disposed || !this.loadedUrl) {
      this.logger.info?.('[character-kit] gesture skipped (not loaded)', { id, source, detail })
      return
    }
    try {
      const result = this.controller.playGesture(id, loop, 0.25, timeScale, source, sceneTarget)
      if (result === 'skipped') {
        this.logger.info?.('[character-kit] gesture skipped', { id, source, detail })
        return
      }
      this.director.pushAction('gesture', loop ? `${id} · loop` : id, source, detail, sceneTarget, {
        durationMs: this.controller.gesturePlaybackMs(id, { loop, timeScale }) ?? undefined,
        loop,
        timeScale,
      })
    } catch (err) {
      this.logger.warn?.('[character-kit] playGesture failed', id, err)
    }
  }

  setAgentId(agentId?: string): void {
    this.director.setAgentId(agentId)
  }

  setInteractionAck(partial: Partial<InteractionAckOptions>): void {
    this.interactionAck.setOptions(partial)
  }

  getInteractionAck(): InteractionAckOptions {
    return this.interactionAck.getOptions()
  }

  setInteractionAckActive(active: boolean): void {
    this.interactionAck.setActive(active)
  }

  private playAckGesture(
    id: string,
    reason: 'click' | 'zoom',
    timeScale?: number,
  ): void {
    if (this.disposed || !this.loadedUrl) return
    const gid = id.trim()
    if (!gid) return
    try {
      const result = this.controller.playGesture(gid, false, 0.12, timeScale, 'user')
      if (result === 'skipped') {
        this.logger.info?.('[character-kit] interaction ack skipped', gid, reason)
        return
      }
      this.director.pushAction('gesture', gid, 'user', reason, undefined, {
        durationMs: this.controller.gesturePlaybackMs(gid, { timeScale }) ?? undefined,
        timeScale,
      })
    } catch (err) {
      this.logger.warn?.('[character-kit] interaction ack failed', gid, err)
    }
  }

  /** Build catalog from the loaded VRM + gesture pack (falls back to defaults). */
  inlineTagCatalog(): InlineTagCatalog {
    const base = defaultInlineCatalog()
    try {
      const exprs = this.controller.listExpressions()
      const emotionNames = exprs.filter((e) => e.kind === 'emotion').map((e) => e.name)
      return {
        gestures: [
          ...new Set([
            ...this.controller.listGestures(),
            ...listLogicalGestureIds(),
            ...base.gestures,
          ]),
        ],
        moods: listPresenceMoods().map((m) => m.id),
        emotions: emotionNames.length ? emotionNames : base.emotions,
        expressions: exprs.length ? exprs.map((e) => e.name) : base.expressions,
        clothes: ['none', 'default', ...this.controller.listClothes().map((c) => c.id)],
      }
    } catch {
      return base
    }
  }

  /**
   * Parse compact `[walk:…]` / `[mood:…]` cues from assistant text and run them
   * on the AnimationDirector (same path as the playground chat performance).
   */
  async playInlineTags(
    text: string,
    opts: { enabled?: boolean; source?: CharacterActionSource; locomotionOnly?: boolean } = {},
  ): Promise<ParsedInlineTags> {
    const enabled = opts.enabled !== false
    const source = opts.source ?? 'tag'
    const parsed = parseInlineTags(text, this.inlineTagCatalog(), { enabled })
    if (!enabled) return parsed

    const locomotionOps = new Set(['walk', 'approach', 'teleport', 'turn', 'jump', 'turn_to'])
    const withSpeech = opts.locomotionOnly
      ? parsed.withSpeech.filter((s) => locomotionOps.has(s.op))
      : parsed.withSpeech
    const afterTts = opts.locomotionOnly ? [] : parsed.afterTts

    if (!withSpeech.length && !afterTts.length) {
      return parsed
    }
    const gen = this.director.beginSpeechBeat()
    try {
      if (withSpeech.length) {
        await this.director.runSequence(withSpeech, gen, source)
      }
      if (afterTts.length && this.director.isCurrent(gen)) {
        await this.director.runSequence(afterTts, gen, source)
      }
    } finally {
      this.director.endSpeechBeat(gen)
    }
    return parsed
  }

  /** Fire a short face/gesture beat timed to TTS (does not await afterTts). */
  async playTimedSteps(
    steps: import('./inline-tags.js').InlineSequenceStep[],
    opts: { source?: CharacterActionSource } = {},
  ): Promise<void> {
    if (!steps.length) return
    const source = opts.source ?? 'tag'
    const gen = this.director.beginSpeechBeat()
    try {
      await this.director.runSequence(steps, gen, source)
    } finally {
      this.director.endSpeechBeat(gen)
    }
  }

  pausePresence(reason = 'agent_status'): void {
    this.director.pausePresence(reason)
  }

  resumePresence(): void {
    this.director.resumePresence()
  }

  setWalkTrailOptions(opts: Partial<WalkTrailOptions>): void {
    this.controller.setWalkTrailOptions(opts)
  }

  getWalkTrailOptions(): WalkTrailOptions {
    return this.controller.getWalkTrailOptions()
  }

  clearWalkTrail(): void {
    this.controller.clearWalkTrail()
  }

  setLocoNearbyRadius(meters: number): void {
    this.controller.setLocoNearbyRadius(meters)
  }

  getLocoNearbyRadius(): number {
    return this.controller.getLocoNearbyRadius()
  }

  getPoseFeedback(nearbyRadiusM?: number): Record<string, unknown> {
    return this.controller.getPoseFeedback(nearbyRadiusM)
  }

  listGestures(): string[] {
    return this.controller.listGestures()
  }

  listLoadedGestures(): LoadedGestureInfo[] {
    return this.controller.listLoadedGestures()
  }

  setMoveInput(input: MoveInput): void {
    this.controller.setMoveInput(input)
  }

  setAnalogSpeed(speed: number): void {
    this.controller.setAnalogSpeed(speed)
  }

  setPointerLookEnabled(on: boolean): void {
    this.controller.setPointerLookEnabled(on)
  }

  setBodyFollowCamera(on: boolean): void {
    this.controller.setBodyFollowCamera(on)
  }

  setGazeLimits(limits: Partial<GazeLimits>): GazeLimits {
    return this.controller.setGazeLimits({ ...DEFAULT_GAZE_LIMITS, ...limits })
  }

  resize(): void {
    this.controller.resize()
  }

  getLoadedUrl(): string | null {
    return this.loadedUrl
  }

  async ensureLipSync(audioContext?: AudioContext) {
    return this.controller.ensureLipSync(audioContext)
  }

  /** Drive visemes from a TTS MediaStream (same AudioContext as playback). */
  async speakWithLipSync(mediaStream: MediaStream, audioContext?: AudioContext): Promise<void> {
    if (this.disposed || !this.loadedUrl) return
    await this.controller.speakWithLipSync(mediaStream, audioContext)
    this.logger.info?.('[character-kit] CompanionHost lip-sync attached')
  }

  stopLipSync(): void {
    this.controller.stopLipSync()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.standIn.dispose()
    this.interactionAck.dispose()
    this.unsubUser?.()
    this.unsubUser = null
    this.unsubLoco?.()
    this.unsubLoco = null
    this.director.dispose()
    this.controller.dispose()
  }
}

function toClothesSpec(clothes?: CompanionClothesInput): ClothesSpec {
  return {
    id: clothes?.id ?? 'default',
    ids: clothes?.ids,
    url: null,
    overlayPieces: clothes?.overlayPieces,
  }
}

/** Fetch manifest and rewrite `/assets/vrma/...` (or relative) URLs to sit beside the manifest. */
export async function fetchRewrittenManifest(manifestUrl: string): Promise<GestureManifest> {
  const buf = await fetchCachedArrayBuffer(manifestUrl)
  const data = JSON.parse(new TextDecoder().decode(buf)) as GestureManifest
  const base = manifestUrl.replace(/\/[^/]*$/, '')
  const rewritten: GestureManifest = {
    ...data,
    gestures: (data.gestures || []).map((g) => {
      const raw = g.url || ''
      if (/^https?:\/\//i.test(raw)) return g
      const file = raw.replace(/^\/assets\/vrma\//, '').replace(/^\.\//, '')
      return { ...g, url: `${base}/${file}` }
    }),
  }
  void preloadCharacterAssets(rewritten.gestures.map((g) => g.url).filter(Boolean))
  return rewritten
}
