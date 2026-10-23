import { useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  SceneRoom,
  emptyAvatarAssetLoadProgress,
  type AvatarAssetLoadProgress,
  type CharacterActionEvent,
  type CharacterActionSource,
  type LoadedGestureInfo,
  type SceneRoomOccupant,
  type SceneRoomOptions,
  type ToolResult,
} from '@nexus/character-kit'
import { AvatarLoadProgressBars } from './AvatarLoadProgressBars.js'
import { ensureAvatarAssetCacheBridge } from './ensureAvatarAssetCacheBridge.js'
import type { ParticipantPresenceV1 } from './presence-types.js'

/** Single-occupant id used inside the companion scene room. */
export const COMPANION_SCENE_AVATAR_ID = 'companion'

/**
 * Host handle a companion scene exposes to the chat voice layout / tool pack.
 *
 * It is the single-avatar facade over {@link SceneRoom}: every method fans out to
 * the one occupant, so `VoiceAvatarCanvas`'s host contract and the character
 * tool pack (via `runToolCall`) both work without knowing the room is shared.
 */
export type CompanionSceneHost = {
  kind: 'scene'
  sceneRoom: SceneRoom
  occupantId: string
  runToolCall: (name: string, args?: Record<string, unknown>) => Promise<ToolResult>
  setMood: (mood: string, source?: CharacterActionSource, detail?: string) => boolean
  playGesture: (
    id: string,
    loop?: boolean,
    source?: CharacterActionSource,
    detail?: string,
    timeScale?: number,
    sceneTarget?: string,
  ) => void
  listLoadedGestures: () => LoadedGestureInfo[]
  listGestures: () => string[]
  onAction: (listener: (ev: CharacterActionEvent) => void) => () => void
  pausePresence: (reason?: string) => void
  resumePresence: () => void
  /** OS-global cursor feed: push gaze NDC / route gaze through the external feed. */
  setPointerNdc: (x: number, y: number) => void
  setExternalPointerEnabled: (on: boolean) => void
  speakWithLipSync: (stream: MediaStream, ctx?: AudioContext) => Promise<void>
  stopLipSync: () => void
  ensureLipSync: (ctx?: AudioContext) => Promise<unknown>
  playInlineTags: (
    text: string,
    opts?: { enabled?: boolean; source?: string; locomotionOnly?: boolean },
  ) => Promise<unknown>
}

export type CompanionSceneCanvasProps = {
  presence?: ParticipantPresenceV1 | null
  className?: string
  style?: CSSProperties
  roomOptions?: Omit<SceneRoomOptions, 'logger' | 'onPhoneVrStatus' | 'soloStage'>
  onHostReady?: (host: CompanionSceneHost | null) => void
}

function occupantFromPresence(
  presence: ParticipantPresenceV1 | null | undefined,
): SceneRoomOccupant {
  return {
    id: COMPANION_SCENE_AVATAR_ID,
    label: 'Companion',
    slotIndex: 0,
    vrmUrl: presence?.vrmUrl ?? null,
    validationStatus: presence?.vrmValidationStatus ?? 'verified',
    mood: presence?.defaultMood ?? 'neutral',
    statusColor: 0x6ab0ff,
    present: true,
  }
}

/**
 * Minimal walkable companion stage: a {@link SceneRoom} with one occupant, the
 * ground grid + soft room bounds, and orbit framing. Rendered in place of the
 * flat {@link CompanionCanvas} when locomotion should be visible
 * (`character_walk` / `character_approach` / `character_turn_to`).
 *
 * Nametags and status circles are suppressed (`soloStage`) so the companion does
 * not look like a meeting roster.
 */
export function CompanionSceneCanvas({
  presence,
  className,
  style,
  roomOptions,
  onHostReady,
}: CompanionSceneCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const roomRef = useRef<SceneRoom | null>(null)
  const hostRef = useRef<CompanionSceneHost | null>(null)
  const onHostReadyRef = useRef(onHostReady)
  onHostReadyRef.current = onHostReady
  // Read the manifest once at room construction without re-creating the room on
  // every presence change (an occupant sync below handles avatar swaps).
  const presenceRef = useRef(presence)
  presenceRef.current = presence
  const [loadProgress, setLoadProgress] = useState<AvatarAssetLoadProgress>(
    emptyAvatarAssetLoadProgress(),
  )

  useEffect(() => {
    ensureAvatarAssetCacheBridge()
    const canvas = canvasRef.current
    if (!canvas) return
    const room = new SceneRoom(canvas, {
      orbitControls: true,
      pointerLook: true,
      background: 0x12171c,
      soloStage: true,
      gestureManifestUrl: presenceRef.current?.gestureManifestUrl,
      ...roomOptions,
    })
    roomRef.current = room
    const offProgress = room.onLoadProgress(setLoadProgress)
    const host = createCompanionSceneHost(room)
    hostRef.current = host
    onHostReadyRef.current?.(host)
    return () => {
      offProgress()
      onHostReadyRef.current?.(null)
      hostRef.current = null
      roomRef.current = null
      room.dispose()
      setLoadProgress(emptyAvatarAssetLoadProgress())
    }
    // The room is created once; presence changes sync occupants below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomOptions])

  useEffect(() => {
    const room = roomRef.current
    if (!room) return
    void room.setOccupants([occupantFromPresence(presence)])
  }, [presence])

  const canvasStyle: CSSProperties = {
    width: '100%',
    height: '100%',
    display: 'block',
    ...style,
  }

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight: 0,
        ...(style?.height === undefined ? {} : { height: style.height }),
      }}
    >
      <canvas
        ref={canvasRef}
        className={className}
        style={canvasStyle}
        aria-label="3D companion scene"
      />
      <AvatarLoadProgressBars progress={loadProgress} />
    </div>
  )
}

/**
 * Adapt a {@link SceneRoom} + its single occupant to the flat-host contract the
 * chat surface and tool pack expect. Pure fan-out; no Three.js here.
 */
export function createCompanionSceneHost(
  room: SceneRoom,
  occupantId = COMPANION_SCENE_AVATAR_ID,
): CompanionSceneHost {
  return {
    kind: 'scene',
    sceneRoom: room,
    occupantId,
    runToolCall: (name, args = {}) => room.runToolCall(occupantId, name, args),
    setMood: (mood, source = 'user', detail = 'config') =>
      room.setAvatarMood(occupantId, mood, source, detail),
    playGesture: (id, loop = false, source = 'user', detail = 'config') => {
      void room.playAvatarGesture(occupantId, id, { loop, source })
      room.getAvatar(occupantId)?.director.pushAction('gesture', id, source, detail)
    },
    listLoadedGestures: () => room.listLoadedAvatarGestures(occupantId),
    listGestures: () => room.listAvatarGestures(occupantId),
    onAction: (listener) => room.onAction(listener),
    setPointerNdc: (x, y) => room.setPointerNdc(x, y),
    setExternalPointerEnabled: (on) => room.setExternalPointerEnabled(on),
    pausePresence: (reason = 'agent_status') => {
      room.getAvatar(occupantId)?.director.pausePresence(reason)
    },
    resumePresence: () => {
      room.getAvatar(occupantId)?.director.resumePresence()
    },
    speakWithLipSync: (stream, ctx) => room.speakWithLipSync(occupantId, stream, ctx),
    stopLipSync: () => room.stopLipSync(occupantId),
    ensureLipSync: async (ctx) => {
      const controller = room.getAvatar(occupantId)?.controller
      if (!controller) return undefined
      return controller.ensureLipSync(ctx)
    },
    playInlineTags: (text, opts = {}) =>
      room.playInlineTags(occupantId, text, {
        enabled: opts.enabled,
        source: opts.source as CharacterActionSource | undefined,
        locomotionOnly: opts.locomotionOnly,
      }),
  }
}
