export { CompanionCanvas, presenceToCompanionProps, type CompanionCanvasProps } from './CompanionCanvas.js'
export { SceneRoomCanvas, type SceneRoomCanvasProps } from './SceneRoomCanvas.js'
export {
  CompanionSceneCanvas,
  createCompanionSceneHost,
  COMPANION_SCENE_AVATAR_ID,
  type CompanionSceneCanvasProps,
  type CompanionSceneHost,
} from './CompanionSceneCanvas.js'
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

// Motion-feed / gesture-config debug surfaces live in `@nexus/character-ui-kit`;
// re-exported here as thin aliases so hosts already depending on
// `@nexus/character-react` get them without a new dependency. Those hosts must
// also `import '@nexus/character-ui-kit/style.css'` for the panel styling.
export {
  MotionFeedProvider,
  MotionFeedPanel,
  GestureTestPanel,
  StatusMotionsConfig,
  useMotionFeed,
  useCharacterHost,
  useAgentStatusMotions,
  groupMotionFeedEvents,
  flattenMotionFeedRows,
  parseStatusMotions,
  serializeStatusMotions,
  parseGestureRoutineConfig,
  serializeGestureRoutineConfig,
  allConfiguredGestureIds,
  DEFAULT_STATUS_MOTIONS,
  STATUS_MOTION_STATES,
  STATUS_MOTION_GESTURE_CHOICES,
  type MotionFeedApi,
  type MotionFeedHost,
  type MotionFeedPanelProps,
  type StatusMotionPlayableHost,  type GestureTestPanelProps,
  type StatusMotionsConfigProps,
  type GestureRoutineConfig,
  type StatusMotionMap,
  type StatusMotionState,
  type AgentLiveStatus,
  type UseAgentStatusMotionsArgs,
} from '@nexus/character-ui-kit'
