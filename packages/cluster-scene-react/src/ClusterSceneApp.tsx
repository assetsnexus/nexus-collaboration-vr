import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ClusterList, type ClusterListFilters, type ClusterSummary } from './ClusterList.js'
import { ClusterRoomViewer } from './ClusterRoomViewer.js'
import { AskAgentToJoin, type AskAgentToJoinProps } from './AskAgentToJoin.js'
import type { SceneClient } from '@nexus/scene-client'
import type { SceneRoomOccupant } from './scene-occupant-ref.js'
import type { RobotSceneLayerRef } from './ClusterRoomViewer.js'
import type { SceneGraphRef } from './scene-graph-ref.js'

export type ClusterSceneAppProps = {
  listClusters: (filters: ClusterListFilters) => Promise<{ items: ClusterSummary[] }>
  resolveRoomId?: (cluster: ClusterSummary) => string
  resolveOccupants?: (cluster: ClusterSummary) => SceneRoomOccupant[]
  sceneClient?: SceneClient | null
  createSceneClient?: (roomId: string) => SceneClient
  inviteParticipant: AskAgentToJoinProps['inviteParticipant']
  addRoomParticipant?: AskAgentToJoinProps['addRoomParticipant']
  gestureManifestUrl?: string
  robotSceneLayer?: RobotSceneLayerRef | null
  sceneGraph?: SceneGraphRef | null
  chatWidget?: ReactNode
  listFilters?: ClusterListFilters
  /** Pre-select a cluster (id or roomId) when opening from a deep link / host route. */
  initialClusterId?: string | null
  phoneVrEnabled?: boolean
  onVrShellRequest?: (action: 'lockLandscape' | 'unlockOrientation') => void
}

export function ClusterSceneApp({
  listClusters,
  resolveRoomId,
  resolveOccupants,
  sceneClient,
  createSceneClient,
  inviteParticipant,
  addRoomParticipant,
  gestureManifestUrl,
  robotSceneLayer,
  sceneGraph,
  chatWidget,
  listFilters,
  initialClusterId,
  phoneVrEnabled = true,
  onVrShellRequest,
}: ClusterSceneAppProps) {
  const [selected, setSelected] = useState<ClusterSummary | null>(null)

  useEffect(() => {
    const want = initialClusterId?.trim()
    if (!want || selected) return
    let cancelled = false
    void listClusters({ ...listFilters }).then((res) => {
      if (cancelled) return
      const hit = (res.items ?? []).find(
        (c) => c.id === want || c.roomId === want || String(c.clusterId || '') === want,
      )
      if (hit) setSelected(hit)
    })
    return () => {
      cancelled = true
    }
  }, [initialClusterId, listClusters, listFilters, selected])

  const roomId = useMemo(() => {
    if (!selected) return null
    return resolveRoomId?.(selected) ?? selected.roomId ?? selected.id
  }, [selected, resolveRoomId])

  const occupants = useMemo(() => {
    if (!selected) return []
    return resolveOccupants?.(selected) ?? []
  }, [selected, resolveOccupants])

  const roomClient = useMemo(() => {
    if (!roomId) return null
    if (sceneClient) return sceneClient
    return createSceneClient?.(roomId) ?? null
  }, [roomId, sceneClient, createSceneClient])

  return (
    <div
      className="nexus-cluster-scene-app"
      style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 16, minHeight: 520 }}
    >
      <aside>
        <ClusterList
          listClusters={listClusters}
          onSelect={setSelected}
          selectedId={selected?.id ?? null}
          initialFilters={listFilters}
        />
      </aside>
      <main style={{ position: 'relative' }}>
        {roomId ? (
          <>
            <ClusterRoomViewer
              roomId={roomId}
              sceneClient={roomClient}
              occupants={occupants}
              gestureManifestUrl={gestureManifestUrl}
              robotSceneLayer={robotSceneLayer}
              sceneGraph={sceneGraph}
              phoneVrEnabled={phoneVrEnabled}
              onVrShellRequest={onVrShellRequest}
            />
            <section style={{ marginTop: 16 }}>
              <h3 style={{ margin: '0 0 8px' }}>Invite agent</h3>
              <AskAgentToJoin
                roomId={roomId}
                inviteParticipant={inviteParticipant}
                addRoomParticipant={addRoomParticipant}
              />
            </section>
          </>
        ) : (
          <p>Select a cluster to open the room viewer.</p>
        )}
        {chatWidget ? (
          <div
            style={{
              position: 'absolute',
              right: 12,
              bottom: 12,
              maxWidth: 360,
              zIndex: 2,
            }}
          >
            {chatWidget}
          </div>
        ) : null}
      </main>
    </div>
  )
}
