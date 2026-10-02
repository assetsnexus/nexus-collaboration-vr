import { useCallback, useRef } from 'react'
import type { CompanionHost, SceneRoom } from '@nexus/character-kit'

type LipSyncHost =
  | CompanionHost
  | SceneRoom
  | null
  | undefined

function resolveSpeakTarget(
  host: LipSyncHost,
  avatarId?: string,
): {
  speakWithLipSync: (stream: MediaStream, ctx?: AudioContext) => Promise<void>
  stopLipSync: () => void
} | null {
  if (!host) return null
  if ('speakWithLipSync' in host && typeof host.speakWithLipSync === 'function') {
    return host as CompanionHost
  }
  if ('getAvatar' in host && typeof (host as SceneRoom).getAvatar === 'function' && avatarId) {
    const handle = (host as SceneRoom).getAvatar(avatarId)
    if (handle?.controller) {
      const ctrl = handle.controller
      return {
        speakWithLipSync: (stream, ctx) => ctrl.speakWithLipSync(stream, ctx),
        stopLipSync: () => ctrl.stopLipSync(),
      }
    }
  }
  return null
}

export function useLipSyncPlayback(hostOrRoom: LipSyncHost, avatarId?: string) {
  const audioContextRef = useRef<AudioContext | null>(null)

  const speakWithLipSync = useCallback(
    async (mediaStream: MediaStream, audioContext?: AudioContext) => {
      const target = resolveSpeakTarget(hostOrRoom, avatarId)
      if (!target) return
      const ctx = audioContext ?? audioContextRef.current ?? new AudioContext()
      audioContextRef.current = ctx
      await target.speakWithLipSync(mediaStream, ctx)
    },
    [hostOrRoom, avatarId],
  )

  const stopLipSync = useCallback(() => {
    resolveSpeakTarget(hostOrRoom, avatarId)?.stopLipSync()
  }, [hostOrRoom, avatarId])

  return { speakWithLipSync, stopLipSync, audioContextRef }
}
