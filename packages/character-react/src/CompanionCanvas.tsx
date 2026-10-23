import { useEffect, useRef, useState } from 'react'
import {
  CompanionHost,
  emptyAvatarAssetLoadProgress,
  type AvatarAssetLoadProgress,
  type CompanionClothesInput,
  type CompanionHostOptions,
} from '@nexus/character-kit'
import { AvatarLoadProgressBars } from './AvatarLoadProgressBars.js'
import { ensureAvatarAssetCacheBridge } from './ensureAvatarAssetCacheBridge.js'
import type { ParticipantPresenceV1 } from './presence-types.js'

export type CompanionCanvasProps = {
  vrmUrl?: string
  gestureManifestUrl?: string
  mood?: string
  clothes?: CompanionClothesInput
  lipSyncEnabled?: boolean
  /**
   * Plan Part C1: full embodiment profile (routines, face caps, zen, idle
   * mood overrides). When omitted, the host keeps its current behaviour.
   */
  embodiment?: Record<string, unknown> | null
  /** Which face is being embodied: public cap vs owner. Default 'owner'. */
  embodimentFace?: 'public' | 'owner'
  className?: string
  style?: React.CSSProperties
  hostOptions?: Omit<CompanionHostOptions, 'logger'>
  onHostReady?: (host: CompanionHost | null) => void
  /** Catalog gate for `vrmUrl` (owner preview may set previewUnverified via hostOptions path). */
  validationStatus?: string | null
  previewUnverified?: boolean
}

export function CompanionCanvas({
  vrmUrl,
  gestureManifestUrl,
  mood = 'neutral',
  clothes,
  lipSyncEnabled = true,
  embodiment,
  embodimentFace = 'owner',
  className,
  style,
  hostOptions,
  onHostReady,
  validationStatus,
  previewUnverified,
}: CompanionCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const hostRef = useRef<CompanionHost | null>(null)
  const onHostReadyRef = useRef(onHostReady)
  onHostReadyRef.current = onHostReady
  const [hostTick, setHostTick] = useState(0)
  const [loadProgress, setLoadProgress] = useState<AvatarAssetLoadProgress>(
    emptyAvatarAssetLoadProgress(),
  )

  useEffect(() => {
    ensureAvatarAssetCacheBridge()
    const canvas = canvasRef.current
    if (!canvas) return
    const host = new CompanionHost(canvas, {
      orbitControls: true,
      pointerLook: true,
      background: 0x12171c,
      ...hostOptions,
    })
    hostRef.current = host
    setHostTick((n) => n + 1)
    const offProgress = host.onLoadProgress(setLoadProgress)
    onHostReadyRef.current?.(host)
    return () => {
      offProgress()
      host.dispose()
      hostRef.current = null
      onHostReadyRef.current?.(null)
      setLoadProgress(emptyAvatarAssetLoadProgress())
    }
  }, [hostOptions])

  useEffect(() => {
    const host = hostRef.current
    if (!host || !vrmUrl) return
    void host.load({
      vrmUrl,
      gestureManifestUrl,
      mood,
      clothes,
      validationStatus,
      previewUnverified,
    })
  }, [vrmUrl, gestureManifestUrl, mood, clothes, validationStatus, previewUnverified])

  useEffect(() => {
    const host = hostRef.current
    if (!host || !mood) return
    host.setMood(mood, 'user', 'prop')
  }, [mood])

  // Install the embodiment profile after the host exists so a host that is
  // ready before the profile arrives still gets it (and vice versa).
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    host.setEmbodiment(embodiment ?? null, { face: embodimentFace })
  }, [embodiment, embodimentFace, hostTick])

  useEffect(() => {
    if (!lipSyncEnabled) {
      hostRef.current?.stopLipSync()
    }
  }, [lipSyncEnabled])

  // Fill the host pane by default; a caller can still pin a size via `style`
  // (e.g. the collapsed chat header that reserves a small strip).
  const canvasStyle: React.CSSProperties = {
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
      <canvas ref={canvasRef} className={className} style={canvasStyle} aria-label="3D companion" />
      <AvatarLoadProgressBars progress={loadProgress} />
    </div>
  )
}

/** Map ParticipantPresenceV1 into CompanionCanvas props. */
export function presenceToCompanionProps(p: ParticipantPresenceV1): Pick<
  CompanionCanvasProps,
  | 'vrmUrl'
  | 'gestureManifestUrl'
  | 'mood'
  | 'clothes'
  | 'lipSyncEnabled'
  | 'validationStatus'
  | 'embodiment'
> {
  return {
    vrmUrl: p.vrmUrl,
    gestureManifestUrl: p.gestureManifestUrl,
    mood: p.defaultMood ?? 'neutral',
    clothes: p.clothes,
    lipSyncEnabled: p.settings?.lip_sync_enabled !== false,
    validationStatus: p.vrmValidationStatus,
    embodiment: p.embodiment ?? null,
  }
}
