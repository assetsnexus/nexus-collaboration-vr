import { formatEntityRow } from './browse.ts'
import { xzDistance } from './frame.ts'
import type { CompactSceneEvent, SceneEntity, SceneEntityDigest } from './types.ts'

const MAX_DIGEST_LINES = 16
const MAX_EVENT_LINES = 4

export type OccupantPose = {
  slug: string
  x: number
  z: number
  facing: number
  present: boolean
}

/**
 * Compact system-prompt fragment when the 3D viewport is open.
 * Keep short: nearby entities + a few recent events. Full catalog via tools.
 */
export function formatSceneGraphPrompt(opts: {
  selfSlug: string
  entities: SceneEntity[] | SceneEntityDigest[]
  events?: CompactSceneEvent[]
  selfPose?: { x: number; z: number; yaw?: number }
}): string {
  const self = opts.selfSlug.trim().toLowerCase()
  const from = opts.selfPose || { x: 0, z: 0 }
  const lines: string[] = [
    'Viewport: live shared 3D scene graph is open.',
    'Prefer scene_overview / object_spawn over inventing coordinates. Units are meters.',
  ]

  const scored = opts.entities
    .map((e) => {
      const id = 'id' in e ? e.id : ''
      const kind = 'kind' in e ? e.kind : 'object'
      const label = 'label' in e ? e.label : id
      const x = 'pose' in e ? e.pose.x : e.x
      const y = 'pose' in e ? e.pose.y : e.y
      const z = 'pose' in e ? e.pose.z : e.z
      const yaw = 'pose' in e ? e.pose.yaw : e.yaw
      return {
        id,
        kind,
        label,
        x,
        y,
        z,
        yaw,
        dist: xzDistance({ x, z }, from),
      }
    })
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 12)

  if (scored.length) {
    lines.push('Nearby scene entities:')
    for (const row of scored) {
      const you = row.id.toLowerCase() === self || row.label.toLowerCase() === self ? ' (you)' : ''
      lines.push(
        `- ${row.id}${you} [${row.kind}] "${row.label}" x=${row.x.toFixed(1)} z=${row.z.toFixed(1)} dist=${row.dist.toFixed(1)}m`,
      )
    }
  } else {
    lines.push('No props/robots yet — spawn with object_spawn (default: in front of you).')
  }

  const events = (opts.events || []).slice(-MAX_EVENT_LINES)
  if (events.length) {
    lines.push('Recent scene events:')
    for (const ev of events) {
      lines.push(
        `- ${ev.kind}${ev.entityId ? ` ${ev.entityId}` : ''}${ev.op ? ` (${ev.op})` : ''}${
          ev.label ? `: ${ev.label}` : ''
        }`,
      )
    }
  }

  return lines.slice(0, MAX_DIGEST_LINES).join('\n')
}

/** Diff helper: entities added/moved/removed since last rev digest. */
export function formatSceneDiffPrompt(opts: {
  prev: SceneEntityDigest[]
  next: SceneEntityDigest[]
  events?: CompactSceneEvent[]
}): string | null {
  const prevMap = new Map(opts.prev.map((e) => [e.id, e]))
  const nextMap = new Map(opts.next.map((e) => [e.id, e]))
  const lines: string[] = []
  for (const e of opts.next) {
    const old = prevMap.get(e.id)
    if (!old) {
      lines.push(`+ ${e.id} [${e.kind}] at x=${e.x.toFixed(1)} z=${e.z.toFixed(1)}`)
      continue
    }
    if (
      Math.abs(old.x - e.x) > 0.15 ||
      Math.abs(old.z - e.z) > 0.15 ||
      Math.abs(old.yaw - e.yaw) > 0.2
    ) {
      lines.push(`~ ${e.id} moved → x=${e.x.toFixed(1)} z=${e.z.toFixed(1)}`)
    }
  }
  for (const e of opts.prev) {
    if (!nextMap.has(e.id)) lines.push(`- ${e.id} removed`)
  }
  for (const ev of (opts.events || []).slice(-MAX_EVENT_LINES)) {
    lines.push(`! ${ev.kind} ${ev.entityId || ev.label || ''}`)
  }
  if (!lines.length) return null
  return ['Scene changes since last turn:', ...lines].slice(0, MAX_DIGEST_LINES).join('\n')
}

export function entitiesToPromptRows(entities: SceneEntity[], from?: { x: number; z: number }): string {
  return entities.map((e) => formatEntityRow(e, from)).join('\n')
}
