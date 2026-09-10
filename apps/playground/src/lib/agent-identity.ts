/** Map the active agent tab name into the (global) system prompt. */

const AGENT_TOKEN = '{agent}'

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * The playground used to hardcode a mesh name in the system prompt.
 * Agent tabs must follow the tab label, not the VRM filename.
 */
export function applyAgentIdentity(
  basePrompt: string,
  agentName: string,
  vrmLabel?: string,
): string {
  const name = agentName.trim() || 'Agent'
  let body = (basePrompt ?? '').trim()
  if (!body) body = `You are ${AGENT_TOKEN}, a helpful VRM companion.`

  if (body.includes(AGENT_TOKEN)) {
    body = body.split(AGENT_TOKEN).join(name)
  } else {
    body = body.replace(/^You are Xeni\b/i, `You are ${name}`)
    const named = new RegExp(`\\b${escapeRegExp(name)}\\b`, 'i')
    if (!named.test(body)) {
      body = `You are ${name}.\n${body}`
    }
  }

  const mesh = vrmLabel?.trim()
  const meshNote =
    mesh && mesh.toLowerCase() !== name.toLowerCase()
      ? ` The 3D avatar mesh is ${mesh}; that is appearance only — introduce yourself as ${name}, not as the mesh name.`
      : ''

  if (body.toLowerCase().startsWith(`you are ${name.toLowerCase()}`)) {
    if (!meshNote) return body
    const firstNl = body.indexOf('\n')
    if (firstNl === -1) return `${body}${meshNote}`
    return `${body.slice(0, firstNl)}${meshNote}${body.slice(firstNl)}`
  }

  return `You are ${name}.${meshNote}\n\n${body}`
}

export function vrmLabelFromUrl(
  vrmUrl: string | undefined,
  catalog: Array<{ label: string; url: string }>,
): string | undefined {
  if (!vrmUrl) return undefined
  return catalog.find((v) => v.url === vrmUrl)?.label
}
