import { useCallback, useMemo, useState } from 'react'
import { PRESENCE_MOODS, type PresenceMoodDef } from '@nexus/character-kit'
import type { ParticipantPresenceV1 } from './presence-types.js'
import { emptyPresence } from './presence-types.js'

export type AvatarStudioUploadResult = {
  /** Catalog serve URL — never a blob: URL. */
  url: string
  assetId?: string
  validationStatus?: ParticipantPresenceV1['vrmValidationStatus']
}

export type AvatarStudioProps = {
  value?: ParticipantPresenceV1
  onChange: (presence: ParticipantPresenceV1) => void
  /** Called when user clicks routine preview — host should call host.playGesture(id). */
  onPreviewGesture?: (gestureId: string) => void
  /**
   * Host uploads the file via `anx.inference.avatar-assets.upload` (ClamAV)
   * and returns the catalog URL. Studio never creates blob: URLs.
   */
  onUploadVrm?: (file: File) => Promise<AvatarStudioUploadResult | string | null | undefined>
  scopeKey?: string
}

export function AvatarStudio({
  value,
  onChange,
  onPreviewGesture,
  onUploadVrm,
}: AvatarStudioProps) {
  const merged = useMemo(() => ({ ...emptyPresence(), ...value }), [value])
  const [clothesText, setClothesText] = useState(() =>
    merged.clothes ? JSON.stringify(merged.clothes, null, 2) : '',
  )
  const [statusMotionsText, setStatusMotionsText] = useState(() =>
    merged.settings?.status_motions
      ? JSON.stringify(merged.settings.status_motions, null, 2)
      : '{}',
  )
  const [previewGestureId, setPreviewGestureId] = useState('wave')
  const [uploadBusy, setUploadBusy] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const patch = useCallback(
    (partial: Partial<ParticipantPresenceV1>) => {
      onChange({ ...merged, ...partial, v: 1 })
    },
    [merged, onChange],
  )

  const patchSettings = useCallback(
    (partial: NonNullable<ParticipantPresenceV1['settings']>) => {
      onChange({
        ...merged,
        v: 1,
        settings: { ...merged.settings, ...partial },
      })
    },
    [merged, onChange],
  )

  const onVrmFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return
      setUploadError(null)
      if (!onUploadVrm) {
        setUploadError('Upload requires a catalog handler (blob: previews are disabled).')
        return
      }
      setUploadBusy(true)
      try {
        const result = await onUploadVrm(file)
        const url =
          typeof result === 'string'
            ? result
            : result && typeof result.url === 'string'
              ? result.url
              : null
        if (!url || url.startsWith('blob:')) {
          setUploadError('Upload did not return a catalog URL.')
          return
        }
        const validationStatus =
          typeof result === 'object' && result && 'validationStatus' in result
            ? result.validationStatus
            : 'pending_admin'
        const assetId =
          typeof result === 'object' && result && typeof result.assetId === 'string'
            ? result.assetId
            : undefined
        patch({
          vrmUrl: url,
          vrmAssetId: assetId,
          vrmValidationStatus:
            validationStatus === 'verified' ||
            validationStatus === 'rejected' ||
            validationStatus === 'pending_admin'
              ? validationStatus
              : 'pending_admin',
        })
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : String(err))
      } finally {
        setUploadBusy(false)
      }
    },
    [onUploadVrm, patch],
  )

  return (
    <div className="nexus-avatar-studio" style={{ display: 'grid', gap: 12, maxWidth: 520 }}>
      <label style={{ display: 'grid', gap: 4 }}>
        <span>VRM URL</span>
        <input
          type="url"
          value={merged.vrmUrl ?? ''}
          onChange={(e) => {
            const next = e.target.value || undefined
            if (next?.startsWith('blob:')) {
              setUploadError('blob: URLs are not allowed — upload via the catalog.')
              return
            }
            patch({ vrmUrl: next, vrmValidationStatus: undefined, vrmAssetId: undefined })
          }}
          placeholder="https://…/avatar.vrm or catalog /api/inference/avatar-assets/…"
        />
        <input
          type="file"
          accept=".vrm,model/gltf-binary,application/octet-stream"
          disabled={uploadBusy || !onUploadVrm}
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            void onVrmFile(file)
          }}
        />
        {!onUploadVrm ? (
          <span style={{ fontSize: 12, opacity: 0.75 }}>
            File upload disabled until the host provides onUploadVrm (catalog + ClamAV).
          </span>
        ) : null}
        {uploadBusy ? <span style={{ fontSize: 12 }}>Uploading…</span> : null}
        {uploadError ? (
          <span style={{ fontSize: 12, color: '#b00020' }} role="alert">
            {uploadError}
          </span>
        ) : null}
        {merged.vrmValidationStatus ? (
          <span style={{ fontSize: 12, opacity: 0.8 }}>
            Validation: {merged.vrmValidationStatus}
          </span>
        ) : null}
      </label>

      <label style={{ display: 'grid', gap: 4 }}>
        <span>Default mood</span>
        <select
          value={merged.defaultMood ?? 'neutral'}
          onChange={(e) => patch({ defaultMood: e.target.value })}
        >
          {(Object.values(PRESENCE_MOODS) as PresenceMoodDef[]).map((m) => (
            <option key={m.id} value={m.id}>
              {m.description ? `${m.id} — ${m.description.slice(0, 48)}` : m.id}
            </option>
          ))}
        </select>
      </label>

      <label style={{ display: 'grid', gap: 4 }}>
        <span>Gesture manifest URL</span>
        <input
          type="url"
          value={merged.gestureManifestUrl ?? ''}
          onChange={(e) => {
            const next = e.target.value || undefined
            if (next?.startsWith('blob:')) {
              setUploadError('blob: URLs are not allowed.')
              return
            }
            patch({
              gestureManifestUrl: next,
              gestureManifestValidationStatus: undefined,
              gestureManifestAssetId: undefined,
            })
          }}
        />
      </label>

      <label style={{ display: 'grid', gap: 4 }}>
        <span>Clothes (JSON)</span>
        <textarea
          rows={4}
          value={clothesText}
          onChange={(e) => {
            setClothesText(e.target.value)
            try {
              const parsed = JSON.parse(e.target.value || '{}') as ParticipantPresenceV1['clothes']
              patch({ clothes: parsed })
            } catch {
              /* wait for valid JSON */
            }
          }}
        />
      </label>

      <label style={{ display: 'grid', gap: 4 }}>
        <span>Status motions (JSON map)</span>
        <textarea
          rows={3}
          value={statusMotionsText}
          onChange={(e) => {
            setStatusMotionsText(e.target.value)
            try {
              const parsed = JSON.parse(e.target.value || '{}') as Record<string, string>
              patchSettings({ status_motions: parsed })
            } catch {
              /* invalid */
            }
          }}
        />
      </label>

      <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          type="checkbox"
          checked={merged.settings?.lip_sync_enabled !== false}
          onChange={(e) => patchSettings({ lip_sync_enabled: e.target.checked })}
        />
        <span>Lip-sync enabled</span>
      </label>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          value={previewGestureId}
          onChange={(e) => setPreviewGestureId(e.target.value)}
          placeholder="gesture id"
          aria-label="Preview gesture id"
        />
        <button
          type="button"
          onClick={() => onPreviewGesture?.(previewGestureId)}
        >
          Preview routine / gesture
        </button>
      </div>
    </div>
  )
}
