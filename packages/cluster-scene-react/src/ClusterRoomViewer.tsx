import { useEffect, useMemo, useState } from 'react'
import type { SceneClient } from '@nexus/scene-client'
import { SceneRoomCanvas } from '@nexus/character-react'
import type { SceneRoom } from '@nexus/character-kit'
import type { SceneRoomOccupant } from './scene-occupant-ref.js'
import { applyRobotJointsFromSceneFrame } from './robots-bridge.js'
import type { SceneGraphRef } from './scene-graph-ref.js'

/** Opaque handle — attach a {@link @nexus/robots-kit#RobotSceneLayer} in the host. */
export type RobotSceneLayerRef = unknown

export type ClusterRoomViewerProps = {
  roomId: string
  sceneClient?: SceneClient | null
  createSceneClient?: () => SceneClient
  occupants: SceneRoomOccupant[]
  gestureManifestUrl?: string
  /** When set with sceneGraph, joint frames update robot entities. */
  robotSceneLayer?: RobotSceneLayerRef | null
  sceneGraph?: SceneGraphRef | null
  /** Smartphone VR glasses mode (default on). */
  phoneVrEnabled?: boolean
  onVrShellRequest?: (action: 'lockLandscape' | 'unlockOrientation') => void
  /**
   * Receives the live {@link SceneRoom} once the 3D stage is ready (and `null` on
   * teardown), so a host can drive per-avatar lip-sync from a voice session.
   */
  onRoomReady?: (room: SceneRoom | null) => void
}

export function ClusterRoomViewer({
  roomId,
  sceneClient: sceneClientProp,
  createSceneClient,
  occupants,
  gestureManifestUrl,
  robotSceneLayer,
  sceneGraph,
  phoneVrEnabled = true,
  onVrShellRequest,
  onRoomReady,
}: ClusterRoomViewerProps) {
  const [client] = useState(() => sceneClientProp ?? createSceneClient?.() ?? null)
  const [jointDebug, setJointDebug] = useState<Record<string, Record<string, number>>>({})
  const [joined, setJoined] = useState(false)

  useEffect(() => {
    if (sceneClientProp) return
    return () => client?.dispose()
  }, [client, sceneClientProp])

  useEffect(() => {
    const c = sceneClientProp ?? client
    if (!c) return
    let cancelled = false
    void c.join([]).then(() => {
      if (!cancelled) setJoined(true)
    })
    return () => {
      cancelled = true
    }
  }, [sceneClientProp, client, roomId])

  useEffect(() => {
    const c = sceneClientProp ?? client
    if (!c) return

    const onJoints = (frame: unknown) => {
      const f = frame as { assetId?: string; joints?: Record<string, number> }
      if (!f?.assetId) return
      const joints = f.joints || {}
      if (robotSceneLayer && sceneGraph) {
        void applyRobotJointsFromSceneFrame(sceneGraph, f.assetId!, joints)
        return
      }
      setJointDebug((prev) => ({ ...prev, [f.assetId!]: joints }))
    }

    c.on('joints', onJoints)
    return () => c.off('joints', onJoints)
  }, [sceneClientProp, client, robotSceneLayer, sceneGraph])

  const debugLines = useMemo(
    () =>
      Object.entries(jointDebug).map(([assetId, joints]) => (
        <pre key={assetId} style={{ fontSize: 11, margin: 0 }}>
          {assetId}: {JSON.stringify(joints)}
        </pre>
      )),
    [jointDebug],
  )

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ fontSize: 13, opacity: 0.85 }}>
        Room {roomId} · scene {joined ? 'joined' : 'connecting…'} · transport{' '}
        {(sceneClientProp ?? client)?.transport ?? '—'}
      </div>
      <SceneRoomCanvas
        occupants={occupants}
        gestureManifestUrl={gestureManifestUrl}
        phoneVrEnabled={phoneVrEnabled}
        phoneVrScopeKey={`cluster:${roomId}`}
        onRoomReady={onRoomReady}
        onVrShellRequest={onVrShellRequest}
      />
      {!robotSceneLayer || !sceneGraph ? (
        <details>
          <summary>Joint debug (skeleton stand-ins)</summary>
          {debugLines.length ? debugLines : <p>No joint frames yet.</p>}
        </details>
      ) : null}
    </div>
  )
}
