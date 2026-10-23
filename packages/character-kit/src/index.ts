export { CharacterController } from './controller.js'
export type { LoadGesturePackOptions, LoadGesturePackResult } from './controller.js'
export { DEFAULT_SAMPLE_VRM } from './default-sample-vrm.js'
export {
  mayAutoDownloadAvatarAsset,
  isPlatformDefaultGestureAsset,
  isPlatformDefaultAvatarAsset,
} from './avatar-asset-gate.js'
export type {
  AvatarAssetDescriptor,
  AvatarAssetValidationStatus,
  AutoDownloadDecision,
} from './avatar-asset-gate.js'
export { SceneRoom } from './scene-room.js'
export type {
  SceneRoomAvatarConfig,
  SceneRoomAvatarHandle,
  SceneRoomOccupant,
  SceneRoomOptions,
  SceneOccupantPose,
} from './scene-room.js'
export {
  occupantPresentUrl,
  occupantRosterKey,
  occupantWorldPose,
  resolveOccupantSpawnPose,
  isStaleOccupantLoad,
  isOccupantLoadCancelled,
  normalizeOccupants,
  OCCUPANT_LOAD_CANCELLED,
} from './scene-occupants.js'
export { layoutSpawnSlots, facingYawRad } from './spawn-slots.js'
export type { SpawnSlot } from './spawn-slots.js'
export {
  cameraPoseFacingAvatar,
  cameraYawTowardTarget,
  DEFAULT_FRAME_DISTANCE_M,
  DEFAULT_FRAME_HEAD_Y,
} from './scene-camera.js'
export { CompanionHost, fetchRewrittenManifest } from './companion-host.js'
export type { FetchRewrittenManifestOptions } from './companion-host.js'
export { StandInMarker } from './stand-in.js'
export {
  preloadCharacterAssets,
  fetchCachedArrayBuffer,
  fetchCachedPictureObjectUrl,
  loadCachedGltf,
  setAvatarAssetCacheBackend,
  avatarAssetCacheKey,
  shouldStoreAvatarAsset,
  shouldPersistAssetUrl,
  isAvatarAssetCacheEntryFresh,
  canonicalizePublicAssetUrl,
  CHARACTER_ASSET_CACHE,
  DEFAULT_ASSET_TTL_MS,
} from './asset-cache.js'
export type {
  AvatarAssetCacheBackend,
  AvatarAssetCacheKeyInput,
  AvatarAssetCacheStored,
  FetchCachedOptions,
} from './asset-cache.js'
export {
  emptyAvatarAssetLoadProgress,
  type AvatarAssetLoadProgress,
  type AvatarAssetLoadProgressListener,
} from './load-progress.js'
export {
  createNativeAvatarCacheBackend,
  installNativeAvatarCacheFallback,
  type NativeAvatarCacheRequest,
  type NativeAvatarCacheResult,
  type NativeAvatarCacheTransport,
} from './native-avatar-cache.js'
export {
  InteractionAck,
  ACK_IGNORE_SELECTOR,
  ACK_GESTURE_FALLBACK,
  DEFAULT_INTERACTION_ACK,
  DEFAULT_CLICK_ACK_GESTURE,
  DEFAULT_ZOOM_IN_GESTURE,
  DEFAULT_ZOOM_OUT_GESTURE,
  ZOOM_ACK_DELTA_THRESHOLD,
  ZOOM_ACK_COOLDOWN_MS,
  CLICK_ACK_COOLDOWN_MS,
  isInteractiveAckTarget,
  normalizeWheelDeltaY,
  zoomAckDirection,
  normalizeClickAckSpeed,
  normalizeInteractionAck,
  mergeAckGestureOptions,
} from './interaction-ack.js'
export type {
  InteractionAckOptions,
  InteractionAckPlay,
  InteractionAckReason,
} from './interaction-ack.js'
export type {
  CompanionClothesInput,
  CompanionHostOptions,
  CompanionLoadOptions,
  GesturePackStatus,
} from './companion-host.js'
export { AnimationDirector } from './animation-director.js'
export type { SequenceStep, SequenceOp, DirectorOptions } from './animation-director.js'
export { resolveSequenceOp } from './sequence.js'
export {
  ACTION_FEED_MAX,
  formatActionDelta,
  formatActionSource,
  formatActionStatus,
  upsertActionEvent,
  actionEventKey,
  summarizeSequenceStep,
  summarizeToolCall,
} from './action-feed.js'
export { actionTimedProgress } from './action-progress.js'
export type { ActionTimedProgress } from './action-progress.js'
export type {
  CharacterActionEvent,
  CharacterActionListener,
  CharacterActionSource,
  CharacterActionStatus,
} from './action-feed.js'
export { IdlePresenceDirector } from './idle-presence.js'
export type { IdlePresenceOptions, PresenceTier } from './idle-presence.js'
export {
  PRESENCE_MOODS,
  listPresenceMoods,
  resolvePresenceMood,
  coercePresenceMoodId,
} from './presence-moods.js'
export type { PresenceMoodId, PresenceMoodDef } from './presence-moods.js'
export {
  GESTURE_VARIANT_GROUPS,
  resolveGestureVariant,
  listLogicalGestureIds,
  DEFAULT_NOD_TIME_SCALE,
  defaultGestureTimeScale,
  clipPlaybackDurationMs,
  formatClipDuration,
} from './gesture-variants.js'
export {
  V_SIGN_SHORT_ID,
  V_SIGN_RAISE_END_S,
  V_SIGN_LOWER_START_S,
  V_SIGN_SHORT_LENGTH_RATIO,
  timeRemapClip,
  compressClipHold,
  shortenVSignClip,
} from './clip-time-remap.js'
export {
  decideGestureOverlap,
  logicalGestureId,
  clipIsOverlay,
  trackOccupancy,
  MAX_GESTURE_QUEUE,
} from './gesture-overlap.js'
export {
  captureHumanoidRestQuats,
  omitNearRestTracks,
  padClipWithRestHolds,
  bonesMissingFromClip,
  occupancySet,
  filterIdleTracksForOccupancy,
  idleTrackIsOccupied,
  restHoldForBone,
  restReturnBones,
  RestPoseReturn,
  HEAD_REST_BONES,
} from './idle-rest-tracks.js'
export type { BoneRestHold } from './idle-rest-tracks.js'
export type {
  GestureOverlapKind,
  GesturePlayResult,
  PlayingGestureSpec,
} from './gesture-overlap.js'
export {
  applyRelaxedRestPose,
  buildProceduralGestureClips,
  proceduralFramesAreOverlay,
  proceduralIdleBones,
} from './procedural-gestures.js'
export { reAnchorRootPositionTrack } from './reanchor.js'
export { BlinkController, IdleEyeSaccades } from './blink-saccades.js'
export {
  CharacterGaze,
  parseLookAtTarget,
  pointerLookPoint,
  yawTowardXZ,
  wrapPi,
  locoRigYaw,
  desiredIdleBodyYaw,
  expSmooth,
  clampGazeLimits,
  DEFAULT_GAZE_LIMITS,
  GAZE_EYE_IDLE_MS,
  faceFrontLookSpace,
  spineLookDeltaQuat,
} from './gaze.js'
export type { GazeLookOptions, GazeLimits, Xyz } from './gaze.js'
export {
  EMOTION_ALIASES,
  classifyExpressionName,
  resolveEmotionExpression,
  groupExpressionNames,
} from './expressions.js'
export type { ExpressionInfo, ExpressionKind } from './expressions.js'
export {
  FACE_NAME_ALIASES,
  parseFaceScore,
  parseFaceLayers,
  parseGestureFaceToken,
  normalizeFaceWeight,
  aliasFaceName,
  FACE_FADE_IN_MS,
  FACE_FADE_REST_MS,
  FACE_FADE_MOOD_MS,
} from './face-score.js'
export type { FaceLayer, GestureFaceToken } from './face-score.js'
export { FaceBlendController } from './face-blend.js'
export {
  FACE_PULSE_FADE_MS,
  createMoodFacePulse,
  stepMoodFacePulse,
} from './face-pulse.js'
export {
  createIdleScalePulse,
  stepIdleTimeScalePulse,
} from './idle-pulse.js'
export {
  isSitGestureId,
  isSitRestLoopId,
  gesturePreservesSitRest,
  createSeatMesh,
  placeSeatUnderHips,
  SEAT_CUBE_SIZE,
} from './seat-prop.js'
export {
  CHARACTER_TOOL_DEFINITIONS,
  CHARACTER_LOCOMOTION_TOOL_DEFINITIONS,
  SCENE_TOOL_DEFINITIONS,
  CHARACTER_TOOL_ALIASES,
  CHARACTER_IMMEDIATE_TOOLS,
  CHARACTER_DEFERRED_TOOLS,
  resolveCharacterToolName,
  isCharacterSkillTool,
  isImmediateCharacterTool,
  isDeferredCharacterTool,
} from './tools.js'
export {
  CHARACTER_SKILL,
  CHARACTER_SKILL_ID,
  CHARACTER_SKILL_PREFIX,
  characterToolName,
  buildCharacterSkillPrompt,
} from './skill.js'
export type { CharacterSkillCatalog } from './skill.js'
export {
  parseInlineTags,
  parseWalkTagValue,
  defaultInlineCatalog,
  FISH_TTS_TAGS,
  GESTURE_TOKEN_ALIASES,
  isFishAnnotation,
} from './inline-tags.js'
export type {
  InlineTagCatalog,
  InlineTagBadge,
  InlineSequenceStep,
  ParsedInlineTags,
  TimedInlineCue,
} from './inline-tags.js'
export {
  parseEmbodimentProfile,
  seedPresenceMoodOverrides,
  resolveEmbodimentFace,
  resolveEmbodimentRoutine,
  resolveEmbodimentMood,
  applyEmbodimentToSteps,
  applyGestureAliasesToText,
  snapshotPresenceMoods,
  restorePresenceMoods,
  HAS_EMBODIMENT_ROUTINES,
} from './embodiment-profile.js'
export type {
  EmbodimentProfileV1,
  EmbodimentFace,
  EmbodimentFaceProfileV1,
  EmbodimentRoutinesV1,
  EmbodimentRoutineStep,
  EmbodimentRoutineName,
  EmbodimentSpeakingV1,
  EmbodimentIdleV1,
  ResolvedEmbodimentFace,
} from './embodiment-profile.js'
export {
  CLOTHES_NONE_ID,
  CLOTHES_DEFAULT_ID,
  CLOTHES_CATEGORY_ORDER,
  CLOTHES_CATEGORY_LABEL,
  parseClothesMaterialName,
  parseClothesIdList,
  normalizeClothesId,
  resolveClothesSelection,
  summarizeClothesSelection,
  groupClothesByCategory,
  isClothesItemSelected,
  listClothesItems,
  collectClothesSlots,
  captureClothesBindPose,
  applyClothesPieceTransform,
  finalizeClothesSkinBind,
  refreshClothesSkinBind,
} from './clothes.js'
export type {
  ClothesItem,
  ClothesSpec,
  ClothesCategory,
  ClothesGroup,
  ClothesSelection,
  ClothesSelectMode,
} from './clothes.js'
export {
  defaultClothesTransform,
  normalizeClothesTransform,
  isIdentityClothesTransform,
  isOddAxisMirror,
  clothesOverlayKey,
  compactClothesTransform,
} from './clothes-transform.js'
export type { ClothesPieceTransform, ClothesOverlayPiece } from './clothes-transform.js'
export {
  listClothesFromGltfJson,
  listClothesFromVrmBuffer,
  readGlbJson,
} from './clothes-glb.js'
export type {
  CharacterOptions,
  CharacterEmbedHost,
  CharacterEvent,
  CharacterEventType,
  ChatCompletionTool,
  EmotionId,
  GestureManifest,
  GestureManifestEntry,
  LoadedGestureInfo,
  LookAtTarget,
  ToolResult,
  WalkOptions,
  WalkTarget,
} from './types.js'
export {
  LocomotionState,
  clampMoveInput,
  clampSpeed,
  relativeOffset,
  capRelativeMeters,
  parseWalkArgs,
  parseFaceArg,
  relativeToWorld,
  LOCO_WALK_SPEED,
  LOCO_RUN_SPEED,
  LOCO_SPEED_MIN,
  LOCO_SPEED_MAX,
  LOCO_AUTO_RUN_SEC,
  LOCO_GAIT_IDS,
  LOCO_GAIT_SPEED,
  LOCO_GAIT_DEFAULT_CLIP,
  parseGaitArg,
  gaitFromSpeed,
  speedForGait,
  resolveLocomotionClipId,
  applyAutoRun,
  parseLocomotionOverrides,
  gaitAnimTimeScale,
} from './locomotion.js'
export type {
  MoveInput,
  SeekTarget,
  LocomotionSnapshot,
  LocoFaceMode,
  ParsedWalkArgs,
  LocoGaitId,
  LocomotionClipOverrides,
} from './locomotion.js'
export {
  SceneRegistry,
  standBeside,
  createBuiltinSceneObjects,
  normalizeSceneObject,
  parseTeleportArgs,
  parseStandOpts,
} from './scene-registry.js'
export type {
  SceneObject,
  SceneObjectFilter,
  SceneObjectKind,
  StandBesideOpts,
  StandSide,
  StandPose,
  ParsedTeleportArgs,
} from './scene-registry.js'
export {
  parseSceneRef,
  sceneRefLabel,
  sceneRefKey,
  splitTrailingSceneTarget,
} from './scene-ref.js'
export type { SceneRef } from './scene-ref.js'
export { SceneEventLog, formatSceneDigest, isNoisySceneOp } from './scene-events.js'
export type { CompactSceneEvent, SceneEventKind } from './scene-events.js'
export { SceneObjectLayer } from './scene-fx.js'
export type { SceneGlowOpts, SceneMoveOpts } from './scene-fx.js'
export {
  WalkTrail,
  DEFAULT_WALK_TRAIL,
  normalizeWalkTrailOptions,
  parseWalkTrailColor,
} from './walk-trail.js'
export type { WalkTrailOptions } from './walk-trail.js'
export {
  VIEWER_PROFILES,
  findViewerProfile,
  clampIpdM,
  clampDistortionScale,
  IPD_MIN_M,
  IPD_MAX_M,
  IPD_DEFAULT_M,
  PHONE_VR_STORAGE_KEY,
  defaultPhoneVrSettings,
  normalizePhoneVrSettings,
  readPhoneVrSettings,
  writePhoneVrSettings,
  resolveActiveViewer,
} from './viewer-profiles.js'
export type { ViewerProfile, ViewerDistortion, PhoneVrSettingsV1 } from './viewer-profiles.js'
export {
  eyeOffsetLocalX,
  eyeWorldPosition,
  barrelScale,
  undistortRadius,
  distortSampleUv,
  recenterYaw,
  applyYawRecenter,
  orientationEulerRad,
  isOrientationStalled,
  orientationDeltaSignificant,
} from './phone-vr-math.js'
export type { EyeId, Vec3, YawRecenterState } from './phone-vr-math.js'
export {
  canStartImmersiveVr,
  immersiveVrSessionInit,
  normalizeVrReferenceSpace,
  startImmersiveVrSession,
  stopImmersiveVrSession,
  vrSupportMessage,
  phoneVrErrorMessage,
} from './webxr-session.js'
export type {
  VrReferenceSpaceId,
  ImmersiveVrSessionInit,
  VrSupportStatus,
  PhoneVrErrorCode,
  XrSessionLike,
  XrRendererLike,
} from './webxr-session.js'
export { PhoneVrStereoRenderer } from './phone-vr-stereo.js'
export { PhoneVrController } from './phone-vr-controller.js'
export type { PhoneVrMode, PhoneVrStatus, PhoneVrHost } from './phone-vr-controller.js'
