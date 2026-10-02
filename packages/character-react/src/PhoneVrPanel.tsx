import { useCallback, useEffect, useState } from 'react'
import type { PhoneVrStatus, PhoneVrSettingsV1, SceneRoom } from '@nexus/character-kit'
import {
  VIEWER_PROFILES,
  IPD_MIN_M,
  IPD_MAX_M,
  readPhoneVrSettings,
  writePhoneVrSettings,
  normalizePhoneVrSettings,
} from '@nexus/character-kit'

export type PhoneVrPanelProps = {
  room: SceneRoom | null
  /** Persist key; defaults to "default". */
  scopeKey?: string
  /** Ask native shell to lock landscape / unlock. */
  onShellRequest?: (action: 'lockLandscape' | 'unlockOrientation') => void
  className?: string
  style?: React.CSSProperties
}

const panelStyle: React.CSSProperties = {
  display: 'grid',
  gap: 8,
  padding: 10,
  fontSize: 13,
  background: 'rgba(18, 23, 28, 0.92)',
  color: '#e8eef4',
  borderRadius: 8,
  maxWidth: 360,
}

const btnStyle: React.CSSProperties = {
  padding: '8px 12px',
  borderRadius: 6,
  border: '1px solid #3a4654',
  background: '#1c2430',
  color: '#e8eef4',
  cursor: 'pointer',
}

/**
 * Smartphone VR glasses controls for SceneRoom (Cardboard-class viewers).
 * Enter → landscape stereo + head tracking; config persists in localStorage.
 */
export function PhoneVrPanel({
  room,
  scopeKey = 'default',
  onShellRequest,
  className,
  style,
}: PhoneVrPanelProps) {
  const [status, setStatus] = useState<PhoneVrStatus | null>(null)
  const [settings, setSettings] = useState<PhoneVrSettingsV1>(() => readPhoneVrSettings(scopeKey))
  const [busy, setBusy] = useState(false)
  const [configOpen, setConfigOpen] = useState(false)
  const [holdExitMs, setHoldExitMs] = useState(0)
  const [holdingExit, setHoldingExit] = useState(false)

  useEffect(() => {
    if (!room) return
    const vr = room.getPhoneVr()
    vr.updateSettings(settings)
    vr.setShellHooks({
      lockLandscape: () => {
        try {
          const o = screen.orientation as ScreenOrientation & {
            lock?: (mode: string) => Promise<void>
          }
          void o.lock?.('landscape')?.catch(() => undefined)
        } catch {
          /* ignore */
        }
        onShellRequest?.('lockLandscape')
      },
      unlockOrientation: () => {
        try {
          screen.orientation?.unlock?.()
        } catch {
          /* ignore */
        }
        onShellRequest?.('unlockOrientation')
      },
    })
    void vr.probeSupport().then(setStatus)
    const id = window.setInterval(() => setStatus(vr.getStatus()), 500)
    return () => window.clearInterval(id)
  }, [room, scopeKey, onShellRequest, settings])

  const persist = useCallback(
    (next: PhoneVrSettingsV1) => {
      const normalized = normalizePhoneVrSettings(next)
      setSettings(normalized)
      writePhoneVrSettings(scopeKey, normalized)
      room?.getPhoneVr().updateSettings(normalized)
    },
    [room, scopeKey],
  )

  const enter = useCallback(async () => {
    if (!room || busy) return
    setBusy(true)
    try {
      const s = await room.enterPhoneVr()
      setStatus(s)
    } finally {
      setBusy(false)
    }
  }, [room, busy])

  const exit = useCallback(async () => {
    if (!room || busy) return
    setBusy(true)
    try {
      const s = await room.exitPhoneVr()
      setStatus(s)
      setHoldExitMs(0)
      setHoldingExit(false)
    } finally {
      setBusy(false)
    }
  }, [room, busy])

  // Hold corner ~1.2s to exit when HUD is hard to see in the viewer.
  useEffect(() => {
    if (!holdingExit) return
    const id = window.setInterval(() => {
      setHoldExitMs((t) => {
        const next = t + 100
        if (next >= 1200) {
          void exit()
          return 0
        }
        return next
      })
    }, 100)
    return () => window.clearInterval(id)
  }, [holdingExit, exit])

  const active = !!status?.active
  const err = status?.errorMessage

  return (
    <div className={className} style={{ ...panelStyle, ...style }} data-phone-vr-panel>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {!active ? (
          <button type="button" style={btnStyle} disabled={!room || busy} onClick={() => void enter()}>
            {busy ? 'Starting…' : 'Enter VR'}
          </button>
        ) : (
          <button
            type="button"
            style={{ ...btnStyle, background: '#3a1f1f' }}
            disabled={busy}
            onClick={() => void exit()}
          >
            Exit VR
          </button>
        )}
        <button type="button" style={btnStyle} onClick={() => setConfigOpen((v) => !v)}>
          {configOpen ? 'Hide setup' : 'Viewer setup'}
        </button>
        {active ? (
          <button type="button" style={btnStyle} onClick={() => room?.getPhoneVr().recenterView()}>
            Reset view
          </button>
        ) : null}
      </div>

      {status ? (
        <p style={{ margin: 0, opacity: 0.9 }} role="status">
          {status.message}
          {status.mode !== 'flat' ? ` · mode ${status.mode}` : ''}
        </p>
      ) : null}
      {err ? (
        <p style={{ margin: 0, color: '#ffb4a8' }} role="alert">
          {err}
        </p>
      ) : null}
      {status?.trackingStalled ? (
        <p style={{ margin: 0, color: '#ffd48a' }} role="alert">
          Tracking stalled — move the phone or re-grant motion access.
        </p>
      ) : null}

      {configOpen ? (
        <div style={{ display: 'grid', gap: 8, borderTop: '1px solid #2a333d', paddingTop: 8 }}>
          <label style={{ display: 'grid', gap: 4 }}>
            Viewer preset
            <select
              value={settings.profileId}
              onChange={(e) => persist({ ...settings, profileId: e.target.value })}
              style={{ ...btnStyle, cursor: 'default' }}
            >
              {VIEWER_PROFILES.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            IPD {(settings.ipdM * 1000).toFixed(0)} mm
            <input
              type="range"
              min={IPD_MIN_M * 1000}
              max={IPD_MAX_M * 1000}
              step={1}
              value={Math.round(settings.ipdM * 1000)}
              onChange={(e) => persist({ ...settings, ipdM: Number(e.target.value) / 1000 })}
            />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            Distortion {(settings.distortionScale * 100).toFixed(0)}%
            <input
              type="range"
              min={0}
              max={150}
              step={5}
              value={Math.round(settings.distortionScale * 100)}
              onChange={(e) =>
                persist({ ...settings, distortionScale: Number(e.target.value) / 100 })
              }
            />
          </label>
          <p style={{ margin: 0, opacity: 0.7, fontSize: 12 }}>
            Drop the phone into Cardboard / Merge / DESTEK / BOBOVR Z-style glasses. There is no
            glasses API — head look uses the phone IMU (or WebXR on Android Chrome when available).
          </p>
        </div>
      ) : null}

      {active ? (
        <button
          type="button"
          aria-label="Hold to exit VR"
          style={{
            position: 'fixed',
            left: 8,
            bottom: 8,
            zIndex: 40,
            width: 72,
            height: 72,
            borderRadius: 12,
            border: '2px solid #fff',
            background: holdExitMs > 0 ? 'rgba(180,40,40,0.85)' : 'rgba(0,0,0,0.45)',
            color: '#fff',
            fontSize: 11,
            cursor: 'pointer',
          }}
          onPointerDown={() => {
            setHoldExitMs(1)
            setHoldingExit(true)
          }}
          onPointerUp={() => {
            setHoldExitMs(0)
            setHoldingExit(false)
          }}
          onPointerLeave={() => {
            setHoldExitMs(0)
            setHoldingExit(false)
          }}
          onPointerCancel={() => {
            setHoldExitMs(0)
            setHoldingExit(false)
          }}
        >
          Hold exit
        </button>
      ) : null}
    </div>
  )
}
