export { CompanionCanvas, presenceToCompanionProps, type CompanionCanvasProps } from './CompanionCanvas.js'
export { SceneRoomCanvas, type SceneRoomCanvasProps } from './SceneRoomCanvas.js'
export { AvatarLoadProgressBars, type AvatarLoadProgressBarsProps } from './AvatarLoadProgressBars.js'
export { CachedAvatarImage, type CachedAvatarImageProps } from './CachedAvatarImage.js'
export { ensureAvatarAssetCacheBridge } from './ensureAvatarAssetCacheBridge.js'
export { PhoneVrPanel, type PhoneVrPanelProps } from './PhoneVrPanel.js'
export { AvatarStudio, type AvatarStudioProps, type AvatarStudioUploadResult } from './AvatarStudio.js'
export { useLipSyncPlayback } from './useLipSyncPlayback.js'
export type { ParticipantPresenceV1 } from './presence-types.js'
export { emptyPresence } from './presence-types.js'
export {
  readLocalPresenceDraft,
  writeLocalPresenceDraft,
  readPresenceFromProfile,
  writePresenceIntoProfilePatch,
} from './presencePersistence.js'
