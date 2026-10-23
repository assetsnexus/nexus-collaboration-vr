/**
 * `@nexus/character-ui-kit` — reusable debug/config surfaces for a
 * `@nexus/character-kit` companion. Pure logic is framework-free; the React
 * panels are thin over it, so a host can use either layer.
 *
 * Import the stylesheet once in the host app:
 *   `import '@nexus/character-ui-kit/style.css'`
 *
 * @packageDocumentation
 */

export {
  agentKey,
  groupMotionFeedEvents,
  flattenMotionFeedRows,
  type MotionFeedGroup,
  type MotionFeedSeriesRow,
  type MotionFeedEventRow,
  type MotionFeedRow,
} from './motion-feed-rows.js'

export {
  DEFAULT_STATUS_MOTIONS,
  STATUS_MOTION_GESTURE_CHOICES,
  STATUS_MOTION_STATES,
  coalesceAgentStatusPhase,
  defaultMotionsForState,
  formatStatusChip,
  isLiveAgentState,
  motionsForState,
  parseStatusMotions,
  pickStatusGesture,
  serializeStatusMotions,
  statusEmoji,
  statusGesture,
  statusMood,
  type AgentLiveStatus,
  type StatusMotionConfig,
  type StatusMotionMap,
  type StatusMotionState,
} from './agent-status-gestures.js'

export {
  ROUTINE_NAMES,
  allConfiguredGestureIds,
  defaultRoutineConfig,
  moodGesturePool,
  parseGestureRoutineConfig,
  serializeGestureRoutineConfig,
  withStatusMotion,
  type GestureRoutineConfig,
  type RoutineName,
  type RoutineStep,
} from './gesture-routines.js'

export {
  ACTION_FEED_MAX,
  MotionFeedProvider,
  useCharacterHost,
  useMotionFeed,
  type MotionFeedApi,
  type MotionFeedHost,
} from './MotionFeedProvider.js'

export { MotionFeedPanel, type MotionFeedPanelProps } from './MotionFeedPanel.js'
export { GestureTestPanel, type GestureTestPanelProps } from './GestureTestPanel.js'
export { StatusMotionsConfig, type StatusMotionsConfigProps } from './StatusMotionsConfig.js'
export {
  useAgentStatusMotions,
  type UseAgentStatusMotionsArgs,
  type StatusMotionPlayableHost,
} from './useAgentStatusMotions.js'
