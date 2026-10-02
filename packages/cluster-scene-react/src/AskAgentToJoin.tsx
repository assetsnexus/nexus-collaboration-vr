import { useState } from 'react'

export type AskAgentToJoinProps = {
  roomId: string
  /** Host wires anx room invite / add participant. */
  inviteParticipant: (args: {
    roomId: string
    participantKind: 'agent' | 'user'
    agentId?: string
    email?: string
  }) => Promise<void>
  addRoomParticipant?: (args: { roomId: string; userId?: string; agentId?: string }) => Promise<void>
}

export function AskAgentToJoin({
  roomId,
  inviteParticipant,
  addRoomParticipant,
}: AskAgentToJoinProps) {
  const [agentId, setAgentId] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!agentId.trim()) return
    setBusy(true)
    setMessage(null)
    try {
      if (addRoomParticipant) {
        await addRoomParticipant({ roomId, agentId: agentId.trim() })
      } else {
        await inviteParticipant({
          roomId,
          participantKind: 'agent',
          agentId: agentId.trim(),
        })
      }
      setMessage('Invite sent.')
      setAgentId('')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 8 }}>
      <label style={{ display: 'grid', gap: 4 }}>
        <span>Agent id</span>
        <input value={agentId} onChange={(e) => setAgentId(e.target.value)} placeholder="agent-uuid" />
      </label>
      <button type="submit" disabled={busy || !agentId.trim()}>
        {busy ? 'Inviting…' : 'Ask agent to join room'}
      </button>
      {message ? <p>{message}</p> : null}
    </form>
  )
}
