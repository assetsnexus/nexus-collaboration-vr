import { useCallback, useEffect, useRef, useState } from 'react'
import {
  SceneRoom,
  emptyAvatarAssetLoadProgress,
  type AvatarAssetLoadProgress,
  type SceneRoomOccupant,
  type SceneRoomOptions,
  type PhoneVrStatus,
} from '@nexus/character-kit'
import { AvatarLoadProgressBars } from './AvatarLoadProgressBars.js'
import { ensureAvatarAssetCacheBridge } from './ensureAvatarAssetCacheBridge.js'
import { PhoneVrPanel } from './PhoneVrPanel.js'

export type SceneRoomCanvasProps = {
  occupants: SceneRoomOccupant[]
  gestureManifestUrl?: string
  className?: string
  style?: React.CSSProperties
  roomOptions?: Omit<SceneRoomOptions, 'logger' | 'onPhoneVrStatus'>
  onRoomReady?: (room: SceneRoom | null) => void
  /** Show smartphone VR glasses controls (default true). */
  phoneVrEnabled?: boolean
  phoneVrScopeKey?: string
  onPhoneVrStatus?: (status: PhoneVrStatus) => void
  onVrShellRequest?: (action: 'lockLandscape' | 'unlockOrientation') => void
}

export function SceneRoomCanvas({
  occupants,
  gestureManifestUrl,
  className,
  style,
  roomOptions,
  onRoomReady,
  phoneVrEnabled = true,
  phoneVrScopeKey = 'default',
  onPhoneVrStatus,
  onVrShellRequest,
}: SceneRoomCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const roomRef = useRef<SceneRoom | null>(null)
  const [room, setRoom] = useState<SceneRoom | null>(null)
  const [loadProgress, setLoadProgress] = useState<AvatarAssetLoadProgress>(
    emptyAvatarAssetLoadProgress(),
  )
  const onPhoneVrStatusRef = useRef(onPhoneVrStatus)
  onPhoneVrStatusRef.current = onPhoneVrStatus
  // Held in a ref, not an effect dep: callers pass inline arrows
  // (`onRoomReady={(r) => setRoomHost(...)}`), and depending on their identity
  // would tear down and rebuild the whole SceneRoom on every render.
  const onRoomReadyRef = useRef(onRoomReady)
  onRoomReadyRef.current = onRoomReady

  useEffect(() => {
    ensureAvatarAssetCacheBridge()
    const canvas = canvasRef.current
    if (!canvas) return
    const next = new SceneRoom(canvas, {
      orbitControls: true,
      pointerLook: true,
      background: 0x12171c,
      gestureManifestUrl,
      onPhoneVrStatus: (status) => onPhoneVrStatusRef.current?.(status),
      ...roomOptions,
    })
    roomRef.current = next
    setRoom(next)
    const offProgress = next.onLoadProgress(setLoadProgress)
    onRoomReadyRef.current?.(next)
    return () => {
      offProgress()
      next.dispose()
      roomRef.current = null
      setRoom(null)
      setLoadProgress(emptyAvatarAssetLoadProgress())
      onRoomReadyRef.current?.(null)
    }
  }, [gestureManifestUrl, roomOptions])

  useEffect(() => {
    const r = roomRef.current
    if (!r) return
    void r.setOccupants(occupants)
  }, [occupants])

  const shellRequest = useCallback(
    (action: 'lockLandscape' | 'unlockOrientation') => {
      onVrShellRequest?.(action)
    },
    [onVrShellRequest],
  )

  // Fill the host pane by default; callers that need a fixed slab pass `style`.
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
      <canvas ref={canvasRef} className={className} style={canvasStyle} aria-label="3D scene room" />
      <AvatarLoadProgressBars progress={loadProgress} />
      {phoneVrEnabled ? (
        <div style={{ position: 'absolute', left: 8, top: 36, zIndex: 3 }}>
          <PhoneVrPanel
            room={room}
            scopeKey={phoneVrScopeKey}
            onShellRequest={shellRequest}
          />
        </div>
      ) : null}
    </div>
  )
}
