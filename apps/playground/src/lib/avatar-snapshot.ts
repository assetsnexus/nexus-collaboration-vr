/** Live 3D snapshot injected into the chat system prompt. */

export interface AvatarSnapshotInput {
  agentName: string
  vrmLabel?: string
  mood: string
  clothesId: string
  clothesIds: string[]
  overlays: string[]
  gesture?: string | null
  idleLoop?: string
  pose?: { x: number; z: number; facing: number; grounded: boolean; moving: boolean }
}

export function formatAvatarSnapshot(input: AvatarSnapshotInput): string {
  const name = input.agentName.trim() || 'Agent'
  const mesh = input.vrmLabel?.trim()
  const clothes =
    input.clothesIds.length > 0 ? input.clothesIds.join(', ') : input.clothesId || 'default'
  const overlays = input.overlays.length ? input.overlays.join(', ') : 'none'
  const pose = input.pose
    ? `x=${input.pose.x.toFixed(2)} z=${input.pose.z.toFixed(2)} facing=${input.pose.facing.toFixed(2)} grounded=${input.pose.grounded} moving=${input.pose.moving}`
    : 'unknown'
  const gesture = input.gesture || input.idleLoop || 'idle'
  const meshLine = mesh && mesh.toLowerCase() !== name.toLowerCase() ? mesh : mesh || 'current VRM'

  return [
    '## Live avatar (ground truth)',
    `A new chat session does not reload the 3D model. You are ${name}. The mesh file is ${meshLine}.`,
    `Mood: ${input.mood}`,
    `Native clothes: ${clothes}`,
    `Overlay pieces: ${overlays}`,
    `Pose: ${pose}`,
    `Gesture/idle: ${gesture}`,
    'Believe this snapshot over prior chat memory. Do not strip clothes, teleport home, or change the VRM unless the user asks.',
    'If the body is broken (T-pose, missing listed clothes, stuck mid-clip), fix it with character_* tools. Otherwise leave the body as-is and greet in the current state.',
  ].join('\n')
}
