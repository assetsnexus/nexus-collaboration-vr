/**
 * Motion-feed provider: subscribes to a `CompanionHost`'s action feed and keeps a
 * bounded ring buffer that the debug panels render.
 *
 * @module motion-feed-provider
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { ACTION_FEED_MAX, type CharacterActionEvent } from '@nexus/character-kit'

export { ACTION_FEED_MAX }

export type MotionFeedApi = {
  host: MotionFeedHost | null
  events: CharacterActionEvent[]
  clear: () => void
}

/**
 * Minimal host the provider needs: anything exposing the action feed. Both the
 * flat `CompanionHost` and the single-avatar scene host satisfy this, so the
 * provider works on either stage. `onAction` is optional so a host-shaped
 * façade (e.g. the chat surface's `VoiceAvatarHost`) still fits.
 */
export type MotionFeedHost = {
  onAction?: (listener: (ev: unknown) => void) => () => void
}

const MotionFeedContext = createContext<MotionFeedApi | null>(null)

export function MotionFeedProvider({
  host,
  children,
}: {
  host: MotionFeedHost | null
  children: ReactNode
}) {
  const [events, setEvents] = useState<CharacterActionEvent[]>([])

  useEffect(() => {
    setEvents([])
    if (!host?.onAction) return
    const unsubscribe = host.onAction((event) => {
      setEvents((prev) => [event as CharacterActionEvent, ...prev].slice(0, ACTION_FEED_MAX))
    })
    return unsubscribe
  }, [host])

  // `host` is stable for a given mount, so recreating the API only on host /
  // events change is fine and keeps consumers from re-rendering spuriously.
  const api = useMemo<MotionFeedApi>(
    () => ({ host, events, clear: () => setEvents([]) }),
    [host, events],
  )

  return <MotionFeedContext.Provider value={api}>{children}</MotionFeedContext.Provider>
}

export function useMotionFeed(): MotionFeedApi {
  const ctx = useContext(MotionFeedContext)
  if (!ctx) throw new Error('useMotionFeed must be used inside <MotionFeedProvider>')
  return ctx
}

/** Host handle only — for panels that don't need the event buffer. */
export function useCharacterHost(): MotionFeedHost | null {
  return useContext(MotionFeedContext)?.host ?? null
}
