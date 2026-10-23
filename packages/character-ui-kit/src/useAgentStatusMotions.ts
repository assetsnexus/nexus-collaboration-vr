import { useEffect, useRef } from 'react'
import {
  coalesceAgentStatusPhase,
  isLiveAgentState,
  motionsForState,
  pickStatusGesture,
  statusMood,
  type AgentLiveStatus,
  type StatusMotionMap,
} from './agent-status-gestures.js'

/**
 * Minimal playable host: the flat `CompanionHost` and the single-avatar scene
 * host both satisfy this, so the hook works on either stage without importing
 * a concrete host class.
 */
export type StatusMotionPlayableHost = {
  playGesture: (id: string, loop?: boolean, source?: string, detail?: string) => unknown
  setMood: (mood: string, source?: string, detail?: string) => boolean
  pausePresence?: (reason?: string) => void
  resumePresence?: () => void
}

/**
 * A host that may expose only part of the playable surface. Passing a loose
 * stage host (e.g. the chat façade) is safe: every optional method is guarded
 * before use, so an unsupported host is simply a no-op rather than a crash.
 */
type PlayableHost = Partial<StatusMotionPlayableHost>

export type UseAgentStatusMotionsArgs = {
  host: PlayableHost | null
  agentStatus?: AgentLiveStatus | null
  motions: StatusMotionMap
  enabled?: boolean
  focusedSlug?: string
  onMood?: (mood: string) => void
}

/** Min gap between status gesture plays (avoids storm when WS status flips). */
const STATUS_GESTURE_COOLDOWN_MS = 2800

/**
 * While the agent is thinking/writing, pause idle presence and cycle the
 * configured gestures. Coalesces planning/reading/running into one phase so
 * high-churn tool-progress events do not restart the loop every tick.
 *
 * Ported from the reference `useAgentStatusMotions` hook.
 */
export function useAgentStatusMotions({
  host,
  agentStatus,
  motions,
  enabled = true,
  focusedSlug,
  onMood,
}: UseAgentStatusMotionsArgs): void {
  const lastGestureRef = useRef<string | null>(null)
  const lastMoodRef = useRef<string | null>(null)
  const lastPlayAtRef = useRef(0)
  const pausedRef = useRef(false)
  const phaseRef = useRef<string | null>(null)

  useEffect(() => {
    if (!enabled || !host || !agentStatus?.state) return
    const slug = agentStatus.authorSlug
    if (slug && focusedSlug && slug !== focusedSlug) return

    const phase = coalesceAgentStatusPhase(agentStatus.state)
    const live = isLiveAgentState(phase)
    const nextMood = statusMood(phase)

    if (lastMoodRef.current !== nextMood) {
      const applied = host.setMood ? host.setMood(nextMood, 'agent', 'status') : false
      if (applied) {
        lastMoodRef.current = nextMood
        onMood?.(nextMood)
      }
    }

    if (!live) {
      if (pausedRef.current) {
        host.resumePresence?.()
        pausedRef.current = false
      }
      lastGestureRef.current = null
      phaseRef.current = phase
      return
    }

    const cfg = motionsForState(phase, motions)
    if (!cfg.gestures.length) return
    if (!host.playGesture) return

    const phaseChanged = phaseRef.current !== phase
    phaseRef.current = phase

    host.pausePresence?.('agent_status')
    pausedRef.current = true

    const playNext = (force: boolean) => {
      const now = Date.now()
      if (!force && now - lastPlayAtRef.current < STATUS_GESTURE_COOLDOWN_MS) return
      const id = pickStatusGesture(cfg.gestures, lastGestureRef.current)
      if (!id) return
      // Same clip still "playing" in the pool — skip rather than re-fire.
      if (!force && id === lastGestureRef.current && now - lastPlayAtRef.current < cfg.intervalMs) {
        return
      }
      lastGestureRef.current = id
      lastPlayAtRef.current = now
      host.playGesture?.(id, false, 'agent', 'status')
    }

    // Only fire immediately when entering a new live phase (or first mount).
    if (phaseChanged) playNext(true)

    const timer = window.setInterval(
      () => playNext(false),
      Math.max(cfg.intervalMs, STATUS_GESTURE_COOLDOWN_MS),
    )
    return () => {
      window.clearInterval(timer)
      // Keep presence paused across same-agent phase transitions; resume only
      // when leaving live work (handled above) or unmounting the host later.
    }
  }, [agentStatus?.authorSlug, agentStatus?.state, enabled, focusedSlug, host, motions, onMood])

  useEffect(() => {
    return () => {
      if (pausedRef.current && host) {
        host.resumePresence?.()
        pausedRef.current = false
      }
    }
  }, [host])
}
