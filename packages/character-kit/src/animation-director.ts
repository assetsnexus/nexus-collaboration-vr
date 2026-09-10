import type { CharacterController } from './controller.js'
import {
  IdlePresenceDirector,
  type IdlePresenceOptions,
} from './idle-presence.js'
import { resolveCharacterToolName, isCharacterSkillTool } from './tools.js'
import type { LookAtTarget, ToolResult } from './types.js'
import { resolveSequenceOp, type SequenceStep } from './sequence.js'
import {
  summarizeSequenceStep,
  summarizeToolCall,
  type CharacterActionEvent,
  type CharacterActionListener,
  type CharacterActionSource,
  type CharacterActionStatus,
} from './action-feed.js'

export type { SequenceStep, SequenceOp } from './sequence.js'
export { resolveSequenceOp } from './sequence.js'

export interface DirectorOptions {
  /** @deprecated use presence — ambient IdlePresenceDirector */
  thinkingEnabled?: boolean
  thinkingMinMs?: number
  thinkingMaxMs?: number
  presence?: IdlePresenceOptions
}

type TrackedAction = {
  id: number
  groupId: number
  generation: number
  status: CharacterActionStatus
  op: string
  label: string
  source: CharacterActionSource
  detail?: string
  at: number
  dtMs: number
  agent?: string
  target?: string
  durationMs?: number
  endedAt?: number
}

/**
 * Queued character performance with soft-cancel for new TTS / new replies.
 * Ambient life is delegated to IdlePresenceDirector (not the LLM).
 */
export class AnimationDirector {
  private generation = 0
  private disposed = false
  private readonly presence: IdlePresenceDirector
  private readonly actionListeners = new Set<CharacterActionListener>()
  private lastActionAt = 0
  private actionSeq = 0
  private groupSeq = 0
  private agentId?: string
  private readonly tracked = new Map<number, TrackedAction>()

  constructor(
    private controller: CharacterController | null,
    opts: DirectorOptions = {},
  ) {
    this.presence = new IdlePresenceDirector(controller, {
      enabled: opts.thinkingEnabled !== false && opts.presence?.enabled !== false,
      ...opts.presence,
      onBeat: (info) => {
        opts.presence?.onBeat?.(info)
        const durationMs = this.clipDurationMs(info.gesture)
        const id = this.openAction({
          op: 'gesture',
          label: info.gesture,
          source: 'routine',
          detail: info.tier,
          status: 'playing',
          groupId: this.nextGroup(),
          durationMs,
        })
        this.scheduleFinish(id, 'done', durationMs ?? 600)
      },
    })
  }

  setController(controller: CharacterController | null): void {
    this.controller = controller
    this.presence.setController(controller)
  }

  setAgentId(agentId?: string): void {
    this.agentId = agentId?.trim() || undefined
  }

  getAgentId(): string | undefined {
    return this.agentId
  }

  /** Subscribe to AI/tag/tool performance events (not ambient idle). */
  onAction(listener: CharacterActionListener): () => void {
    this.actionListeners.add(listener)
    return () => this.actionListeners.delete(listener)
  }

  private nextGroup(): number {
    return ++this.groupSeq
  }

  private emit(ev: CharacterActionEvent): void {
    for (const listener of this.actionListeners) {
      try {
        listener(ev)
      } catch (err) {
        console.error('[animation-director] action listener', err)
      }
    }
  }

  private openAction(opts: {
    op: string
    label: string
    source: CharacterActionSource
    detail?: string
    status?: CharacterActionStatus
    groupId?: number
    generation?: number
    target?: string
    durationMs?: number
  }): number {
    const at = Date.now()
    const dtMs = this.lastActionAt ? at - this.lastActionAt : 0
    this.lastActionAt = at
    const id = ++this.actionSeq
    const groupId = opts.groupId ?? this.nextGroup()
    const status = opts.status ?? 'playing'
    const generation = opts.generation ?? this.generation
    const durationMs =
      opts.durationMs !== undefined && Number.isFinite(opts.durationMs) && opts.durationMs > 0
        ? Math.round(opts.durationMs)
        : undefined
    const tracked: TrackedAction = {
      id,
      groupId,
      generation,
      status,
      op: opts.op,
      label: opts.label,
      source: opts.source,
      detail: opts.detail,
      at,
      dtMs,
      agent: this.agentId,
      target: opts.target,
      durationMs,
    }
    this.tracked.set(id, tracked)
    this.emit(this.toEvent(tracked))
    return id
  }

  private toEvent(tracked: TrackedAction, update?: boolean): CharacterActionEvent {
    return {
      id: tracked.id,
      at: tracked.at,
      dtMs: tracked.dtMs,
      op: tracked.op,
      label: tracked.label,
      source: tracked.source,
      detail: tracked.detail,
      status: tracked.status,
      groupId: tracked.groupId,
      agent: tracked.agent,
      target: tracked.target,
      durationMs: tracked.durationMs,
      endedAt: tracked.endedAt,
      update: update || undefined,
    }
  }

  private clipDurationMs(
    gestureId: string,
    loop?: boolean,
    timeScale?: number,
  ): number | undefined {
    const ms = this.controller?.gesturePlaybackMs(gestureId, { loop, timeScale })
    return ms && ms > 0 ? ms : undefined
  }

  private scheduleFinish(id: number, status: CharacterActionStatus, delayMs: number): void {
    if (!Number.isFinite(delayMs) || delayMs <= 0) {
      this.finishAction(id, status)
      return
    }
    globalThis.setTimeout(() => {
      const t = this.tracked.get(id)
      if (!t || (t.status !== 'playing' && t.status !== 'pending')) return
      this.finishAction(id, status)
    }, delayMs)
  }

  private patchAction(
    id: number,
    patch: Partial<Pick<CharacterActionEvent, 'status' | 'label' | 'detail' | 'op' | 'durationMs'>>,
  ): void {
    const tracked = this.tracked.get(id)
    if (!tracked) return
    if (patch.status) {
      if (patch.status === 'playing' && tracked.status === 'pending') {
        tracked.at = Date.now()
      }
      tracked.status = patch.status
    }
    if (patch.label) tracked.label = patch.label
    if (patch.op) tracked.op = patch.op
    if (patch.detail !== undefined) tracked.detail = patch.detail
    if (patch.durationMs !== undefined && Number.isFinite(patch.durationMs) && patch.durationMs > 0) {
      tracked.durationMs = Math.round(patch.durationMs)
    }
    if (
      tracked.status === 'done' ||
      tracked.status === 'canceled' ||
      tracked.status === 'discarded'
    ) {
      tracked.endedAt = Date.now()
    }
    this.emit(this.toEvent(tracked, true))
    if (
      tracked.status === 'done' ||
      tracked.status === 'canceled' ||
      tracked.status === 'discarded'
    ) {
      this.tracked.delete(id)
    }
  }

  private finishAction(id: number, status: CharacterActionStatus): void {
    this.patchAction(id, { status })
  }

  private cancelOpen(reason: string, generation?: number): void {
    const ids = [...this.tracked.values()]
      .filter((t) =>
        generation === undefined
          ? t.status === 'pending' || t.status === 'playing'
          : t.generation === generation &&
            (t.status === 'pending' || t.status === 'playing'),
      )
      .map((t) => t.id)
    for (const id of ids) {
      const t = this.tracked.get(id)
      if (!t) continue
      this.finishAction(id, t.status === 'pending' ? 'discarded' : 'canceled')
    }
    if (reason) {
      this.openAction({
        op: 'cancel',
        label: reason,
        source: 'cancel',
        status: 'done',
        groupId: this.nextGroup(),
      })
    }
  }

  /** Push an arbitrary action into the live feed (UI, camera, presence, …). */
  pushAction(
    op: string,
    label: string,
    source: CharacterActionSource,
    detail?: string,
    target?: string,
    extra?: { durationMs?: number; loop?: boolean; timeScale?: number },
  ): void {
    const looping = extra?.loop || /(?:^|·\s*)loop\b/i.test(label)
    const durationMs =
      extra?.durationMs ??
      (op === 'gesture' && !looping
        ? this.clipDurationMs(label.split('·')[0]!.trim(), false, extra?.timeScale)
        : undefined)
    const id = this.openAction({
      op,
      label,
      source,
      detail,
      status: 'playing',
      target,
      durationMs,
    })
    const settleMs =
      durationMs ?? (source === 'user' || source === 'cancel' ? 0 : 500)
    this.scheduleFinish(id, 'done', settleMs)
  }

  /** Soft-cancel current timeline; bump generation so in-flight waits abort. */
  softCancel(reason = 'new_beat', opts: { resetIdle?: boolean; stopLoco?: boolean } = {}): number {
    const prevGen = this.generation
    this.generation += 1
    this.presence.pause(reason)
    this.presence.resetClock(reason)
    // Do not yank locomotion on speech_start — the new beat may chain walk/turn.
    // Gestures never call softCancel; explicit cancel / new_beat still stops loco.
    const stopLoco = opts.stopLoco ?? reason !== 'speech_start'
    if (stopLoco) this.controller?.stopLocomotion()
    if (reason !== 'speech_start') {
      this.cancelOpen(reason, prevGen)
    } else {
      this.cancelOpen('', prevGen)
    }
    if (opts.resetIdle !== false) {
      this.presence.applyMoodFace()
      this.controller?.setIdleLoop('idle', { crossFade: 0.35 })
    }
    console.info('[animation-director] softCancel', reason, this.generation)
    return this.generation
  }

  beginSpeechBeat(): number {
    const gen = this.softCancel('speech_start', { resetIdle: false })
    this.presence.pause('speech_start')
    this.controller?.setSaccadesEnabled(false)
    this.controller?.setGazeCameraLock(true)
    return gen
  }

  endSpeechBeat(gen?: number): void {
    if (gen !== undefined && gen !== this.generation) return
    this.controller?.setGazeCameraLock(false)
    this.controller?.setSaccadesEnabled(true)
    this.controller?.setIdleLoop('idle', { crossFade: 0.4 })
    this.presence.resume()
  }

  isCurrent(gen: number): boolean {
    return !this.disposed && gen === this.generation
  }

  async runToolCall(
    name: string,
    args: Record<string, unknown>,
    gen?: number,
    source: CharacterActionSource = 'agent',
    groupId?: number,
  ): Promise<ToolResult> {
    const g = gen ?? this.generation
    const resolved = resolveCharacterToolName(name)
    if (!this.isCurrent(g)) {
      return { ok: false, name: resolved, message: 'cancelled' }
    }
    if (!this.controller) {
      return { ok: false, name: resolved, message: 'no controller' }
    }

    const gid = groupId ?? this.nextGroup()
    const summary = summarizeToolCall(resolved, args)
    let actionId: number | null = null
    if (summary) {
      actionId = this.openAction({
        op: summary.op,
        label: summary.label,
        source,
        detail: summary.detail,
        status: 'playing',
        groupId: gid,
        generation: g,
        target: toolTargetFromArgs(args),
      })
    }

    try {
      switch (resolved) {
        case 'character_list_moods': {
          const moods = this.presence.listMoods().map((m) => ({
            id: m.id,
            description: m.description,
            faceEmotion: m.faceEmotion,
            routines: {
              micro: m.microGestures,
              medium: m.mediumGestures,
              long: m.longGestures,
            },
          }))
          const current = this.presence.describeMoodState()
          if (actionId) this.finishAction(actionId, 'done')
          return {
            ok: true,
            name: resolved,
            message: `current=${current.mood}; moods=${moods.map((m) => m.id).join(',')}`,
            data: { current, moods },
          }
        }
        case 'character_set_mood': {
          const mood = String(args.mood ?? '')
          const ok = this.presence.setMood(mood)
          if (!ok) {
            if (actionId) this.finishAction(actionId, 'canceled')
            return {
              ok: false,
              name: resolved,
              message: `unknown mood: ${mood}`,
              data: { available: this.presence.listMoods().map((m) => m.id) },
            }
          }
          if (actionId) this.finishAction(actionId, 'done')
          return {
            ok: true,
            name: resolved,
            message: `mood=${mood}`,
            data: this.presence.describeMoodState(),
          }
        }
        case 'character_list_clothes': {
          const res = this.controller.applyToolCall(resolved, args)
          if (actionId) this.finishAction(actionId, 'done')
          return res
        }
        case 'character_set_clothes': {
          const ids = Array.isArray(args.ids) ? args.ids.map((x) => String(x)) : undefined
          const id =
            args.id !== undefined && args.id !== null
              ? String(args.id)
              : args.clothes !== undefined && args.clothes !== null
                ? String(args.clothes)
                : undefined
          const url =
            args.url === undefined || args.url === null ? undefined : String(args.url)
          const ok = await this.controller.setClothes({ id, ids, url: url ?? null })
          if (!ok) {
            if (actionId) this.finishAction(actionId, 'canceled')
            return { ok: false, name: resolved, message: `invalid clothes: ${id ?? ids?.join('+')}` }
          }
          if (actionId) this.finishAction(actionId, 'done')
          return {
            ok: true,
            name: resolved,
            message: `clothes=${this.controller.getClothesId()}`,
            data: this.controller.describeClothes(),
          }
        }
        case 'character_wait': {
          this.presence.pause('tool')
          const ms = Math.max(0, Number(args.ms ?? 0))
          if (actionId && ms > 0) this.patchAction(actionId, { durationMs: ms })
          const waited = await this.wait(ms, g)
          if (actionId) this.finishAction(actionId, waited ? 'done' : 'canceled')
          return { ok: true, name: resolved, message: `waited ${ms}ms` }
        }
        case 'character_cancel': {
          this.softCancel(String(args.reason ?? 'tool'))
          this.presence.resume()
          return { ok: true, name: resolved, message: 'cancelled' }
        }
        case 'character_run_sequence': {
          this.presence.pause('tool')
          const steps = (args.steps ?? []) as SequenceStep[]
          await this.runSequence(steps, g, source, gid)
          return {
            ok: true,
            name: resolved,
            message: `sequence ${steps.length} steps`,
            data: { count: steps.length },
          }
        }
        case 'character_list_gestures':
        case 'character_list_expressions': {
          const res = this.controller.applyToolCall(resolved, args)
          if (actionId) this.finishAction(actionId, 'done')
          return res
        }
        case 'character_walk':
        case 'character_walk_to':
        case 'character_approach': {
          this.presence.pause('locomotion')
          const res = this.controller.applyToolCall(
            resolved === 'character_walk_to' ? 'character_walk' : resolved,
            args,
          )
          if (res.ok) {
            try {
              await this.controller.waitUntilIdle(20_000)
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err)
              if (actionId) this.finishAction(actionId, 'canceled')
              return { ok: false, name: resolved, message }
            }
          }
          if (!this.controller.isLocomoting()) this.presence.resume()
          if (actionId) this.finishAction(actionId, this.isCurrent(g) ? 'done' : 'canceled')
          return {
            ...res,
            data: {
              ...(res.data ?? {}),
              ...this.controller.getPoseFeedback(),
            },
          }
        }
        case 'character_turn':
        case 'character_turn_to': {
          this.presence.pause('locomotion')
          const res = this.controller.applyToolCall(resolved, args)
          if (res.ok) {
            try {
              await this.controller.waitUntilIdle(20_000)
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err)
              if (actionId) this.finishAction(actionId, 'canceled')
              return { ok: false, name: resolved, message }
            }
          }
          if (!this.controller.isLocomoting()) this.presence.resume()
          if (actionId) this.finishAction(actionId, this.isCurrent(g) ? 'done' : 'canceled')
          return {
            ...res,
            data: {
              ...(res.data ?? {}),
              ...this.controller.getPoseFeedback(),
            },
          }
        }
        case 'character_stop':
        case 'character_jump':
        case 'character_teleport':
        case 'scene_list_objects':
        case 'scene_get_object':
        case 'scene_overview':
        case 'scene_move_object':
        case 'scene_glow_object': {
          const res = this.controller.applyToolCall(resolved, args)
          if (actionId) this.finishAction(actionId, 'done')
          return res
        }
        default: {
          this.presence.pause('tool')
          const res = this.controller.applyToolCall(resolved, args)
          if (actionId) {
            if (resolved === 'character_play_gesture') {
              const loop = Boolean(args.loop)
              const durationMs = this.clipDurationMs(
                String(args.id ?? ''),
                loop,
                args.timeScale !== undefined ? Number(args.timeScale) : undefined,
              )
              if (durationMs) this.patchAction(actionId, { durationMs })
              if (res.ok && durationMs && this.isCurrent(g)) {
                this.scheduleFinish(actionId, 'done', durationMs)
              } else {
                this.finishAction(
                  actionId,
                  this.isCurrent(g) && res.ok ? 'done' : 'canceled',
                )
              }
            } else {
              this.finishAction(actionId, this.isCurrent(g) ? 'done' : 'canceled')
            }
          }
          return res
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (actionId) this.finishAction(actionId, 'canceled')
      return { ok: false, name: resolved, message }
    }
  }

  async runSequence(
    steps: SequenceStep[],
    gen?: number,
    source: CharacterActionSource = 'agent',
    groupId?: number,
  ): Promise<void> {
    const g = gen ?? this.generation
    const gid = groupId ?? this.nextGroup()
    const planned: Array<{ step: SequenceStep; id: number | null }> = steps.map((step) => {
      const summary = summarizeSequenceStep(step)
      if (!summary) return { step, id: null }
      const waitMs = resolveSequenceOp(String(step.op)) === 'wait' ? Number(step.ms ?? 0) : 0
      const id = this.openAction({
        op: summary.op,
        label: summary.label,
        source,
        detail: summary.detail,
        status: 'pending',
        groupId: gid,
        generation: g,
        target: step.sceneTarget,
        durationMs: waitMs > 0 ? waitMs : undefined,
      })
      return { step, id }
    })

    for (let i = 0; i < planned.length; i++) {
      const { step, id } = planned[i]!
      if (!this.isCurrent(g) || !this.controller) {
        for (let j = i; j < planned.length; j++) {
          const rest = planned[j]!
          if (!rest.id) continue
          const t = this.tracked.get(rest.id)
          if (t && (t.status === 'pending' || t.status === 'playing')) {
            this.finishAction(rest.id, t.status === 'pending' ? 'discarded' : 'canceled')
          }
        }
        return
      }
      if (id) this.patchAction(id, { status: 'playing' })
      const op = resolveSequenceOp(String(step.op))
      try {
        switch (op) {
          case 'wait': {
            const waited = await this.wait(Number(step.ms ?? 0), g)
            if (id) this.finishAction(id, waited ? 'done' : 'canceled')
            break
          }
          case 'play_gesture': {
            this.controller.applyFaceCue({
              emotion: step.emotion,
              intensity: step.intensity,
              faces: step.faces,
              fadeMs: step.fadeMs,
            })
            const played = this.controller.playGesture(
              String(step.id),
              Boolean(step.loop),
              Number(step.crossFade ?? 0.25),
              undefined,
              source,
              step.sceneTarget,
            )
            const durationMs = this.clipDurationMs(String(step.id), Boolean(step.loop))
            if (id && durationMs) this.patchAction(id, { durationMs })
            if (id) {
              if (played === 'skipped') {
                this.finishAction(id, 'discarded')
              } else if (durationMs) {
                this.scheduleFinish(id, 'done', durationMs)
              } else {
                this.finishAction(id, 'done')
              }
            }
            break
          }
          case 'set_emotion':
            this.controller.applyFaceCue({
              emotion: String(step.emotion ?? 'neutral'),
              intensity: step.intensity,
              faces: step.faces,
              fadeMs: step.fadeMs,
              holdMs: step.holdMs,
            })
            if (id) this.finishAction(id, 'done')
            break
          case 'set_expression':
            this.controller.setExpression(
              String(step.name),
              Number(step.weight ?? 1),
              step.fadeMs,
            )
            if (id) this.finishAction(id, 'done')
            break
          case 'set_mood': {
            this.presence.setMood(String(step.mood ?? step.id ?? ''))
            if (id) this.finishAction(id, 'done')
            break
          }
          case 'set_clothes': {
            await this.controller.setClothes({
              id: String(step.clothesId ?? step.id ?? ''),
              ids: step.clothesIds,
              url: step.clothesUrl ?? null,
            })
            if (id) this.finishAction(id, this.isCurrent(g) ? 'done' : 'canceled')
            break
          }
          case 'look_at':
            this.controller.lookAt((step.target ?? 'camera') as LookAtTarget, {
              turn: step.turn,
              holdMs: step.holdMs,
              lock: (step.target ?? 'camera') === 'camera',
            })
            if (id) this.finishAction(id, 'done')
            break
          case 'walk': {
            const walkRes = this.controller.applyToolCall(
              'character_walk',
              step.walkArgs ?? {},
            )
            if (!walkRes.ok) {
              console.warn('[animation-director] walk failed', walkRes.message, step.walkArgs)
              if (id) this.finishAction(id, 'canceled')
              break
            }
            try {
              await this.controller.waitUntilIdle(20_000)
              if (id) this.finishAction(id, this.isCurrent(g) ? 'done' : 'canceled')
            } catch {
              if (id) this.finishAction(id, 'canceled')
            }
            break
          }
          case 'turn':
            this.controller.applyToolCall('character_turn', {
              degrees: step.degrees ?? 0,
              speed: step.speed,
            })
            try {
              await this.controller.waitUntilIdle(20_000)
              if (id) this.finishAction(id, this.isCurrent(g) ? 'done' : 'canceled')
            } catch {
              if (id) this.finishAction(id, 'canceled')
            }
            break
          case 'jump':
            this.controller.applyToolCall('character_jump', {})
            if (id) this.finishAction(id, 'done')
            break
          case 'teleport':
            this.controller.applyToolCall(
              'character_teleport',
              step.walkArgs ?? { objectId: step.objectId },
            )
            if (id) this.finishAction(id, 'done')
            break
          case 'approach': {
            const res = this.controller.applyToolCall('character_approach', {
              target: step.sceneTarget ?? step.objectId ?? step.target,
              from: step.approachFrom,
              ...(step.walkArgs ?? {}),
            })
            if (!res.ok) {
              if (id) this.finishAction(id, 'canceled')
              break
            }
            try {
              await this.controller.waitUntilIdle(20_000)
              if (id) this.finishAction(id, this.isCurrent(g) ? 'done' : 'canceled')
            } catch {
              if (id) this.finishAction(id, 'canceled')
            }
            break
          }
          case 'turn_to': {
            const res = this.controller.applyToolCall('character_turn_to', {
              target: step.sceneTarget ?? step.objectId ?? step.target,
              speed: step.speed,
            })
            if (!res.ok) {
              if (id) this.finishAction(id, 'canceled')
              break
            }
            try {
              await this.controller.waitUntilIdle(20_000)
              if (id) this.finishAction(id, this.isCurrent(g) ? 'done' : 'canceled')
            } catch {
              if (id) this.finishAction(id, 'canceled')
            }
            break
          }
          default:
            console.warn('[animation-director] unknown sequence op', step.op)
            if (id) this.finishAction(id, 'discarded')
            break
        }
      } catch {
        if (id) this.finishAction(id, 'canceled')
      }
    }
  }

  async applyToolCalls(
    toolCalls: Array<{
      id?: string
      function?: { name?: string; arguments?: string }
    }>,
    gen?: number,
  ): Promise<ToolResult[]> {
    const g = gen ?? this.generation
    const gid = this.nextGroup()
    const results: ToolResult[] = []

    for (const call of toolCalls) {
      if (!this.isCurrent(g)) break
      const rawName = call.function?.name
      if (!rawName) continue
      const name = resolveCharacterToolName(rawName)
      if (!isCharacterSkillTool(name) && name === rawName) {
        continue
      }
      let args: Record<string, unknown> = {}
      try {
        args = JSON.parse(call.function?.arguments || '{}') as Record<string, unknown>
      } catch {
        results.push({ ok: false, name, message: 'invalid JSON arguments' })
        continue
      }
      results.push(await this.runToolCall(name, args, g, 'agent', gid))
    }
    return results
  }

  /** Start ambient presence (replaces old scheduleThinking). */
  scheduleThinking(): void {
    this.presence.start()
  }

  stopThinking(): void {
    this.presence.pause('stop')
  }

  pausePresence(reason = 'locomotion'): void {
    this.presence.pause(reason)
  }

  resumePresence(): void {
    this.presence.resume()
  }

  /** Expose for playground debug (force long-idle clock reset). */
  getPresence(): IdlePresenceDirector {
    return this.presence
  }

  /** @returns true if wait completed without cancel */
  private wait(ms: number, gen: number): Promise<boolean> {
    return new Promise((resolve) => {
      const t = setTimeout(() => {
        clearInterval(iv)
        resolve(this.isCurrent(gen))
      }, ms)
      const iv = setInterval(() => {
        if (!this.isCurrent(gen)) {
          clearTimeout(t)
          clearInterval(iv)
          resolve(false)
        }
      }, 40)
    })
  }

  dispose(): void {
    this.disposed = true
    this.actionListeners.clear()
    this.tracked.clear()
    this.presence.dispose()
    this.generation += 1
  }
}

function toolTargetFromArgs(args: Record<string, unknown>): string | undefined {
  const t = args.target ?? args.objectId ?? args.participant ?? args.id
  if (t == null || t === '') return undefined
  if (typeof t === 'string') return t
  if (typeof t === 'object') {
    const rec = t as Record<string, unknown>
    const id = rec.participant ?? rec.slug ?? rec.objectId ?? rec.id
    if (id != null) return String(id)
  }
  return undefined
}
