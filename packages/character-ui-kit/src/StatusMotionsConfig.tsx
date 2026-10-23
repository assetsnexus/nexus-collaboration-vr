import {
  STATUS_MOTION_GESTURE_CHOICES,
  STATUS_MOTION_STATES,
  motionsForState,
  type StatusMotionMap,
  type StatusMotionState,
} from './agent-status-gestures.js'

export type StatusMotionsConfigProps = {
  motions: StatusMotionMap
  onChange: (next: StatusMotionMap) => void
}

/**
 * Status-motions editor: which clips rotate while the agent is thinking /
 * writing / etc. Ported from the reference `StatusMotionsConfig`.
 */
export function StatusMotionsConfig({ motions, onChange }: StatusMotionsConfigProps) {
  function patch(state: StatusMotionState, next: Partial<{ gestures: string[]; intervalMs: number }>) {
    const current = motionsForState(state, motions)
    onChange({
      ...motions,
      [state]: {
        gestures: next.gestures ?? current.gestures,
        intervalMs: next.intervalMs ?? current.intervalMs,
      },
    })
  }

  function toggleGesture(state: StatusMotionState, id: string, checked: boolean) {
    const current = motionsForState(state, motions).gestures
    const gestures = checked ? [...new Set([...current, id])] : current.filter((g) => g !== id)
    patch(state, { gestures: gestures.length ? gestures : current.slice(0, 1) })
  }

  return (
    <div className="status-motions-config">
      <strong className="muted">Status motions</strong>
      <p className="muted status-motions-hint">
        Played while the agent is thinking or writing. Several clips rotate at random if the wait is
        long.
      </p>
      {STATUS_MOTION_STATES.map((state) => {
        const cfg = motionsForState(state, motions)
        return (
          <fieldset key={state} className="status-motions-state">
            <legend>{state}</legend>
            <div className="status-motions-chips">
              {STATUS_MOTION_GESTURE_CHOICES.map((id) => (
                <label key={id} className="chat-avatar-toggle">
                  <input
                    type="checkbox"
                    checked={cfg.gestures.includes(id)}
                    onChange={(e) => toggleGesture(state, id, e.target.checked)}
                  />
                  {id}
                </label>
              ))}
            </div>
            <label>
              Rotate every (ms)
              <input
                type="number"
                min={1200}
                max={20000}
                step={100}
                value={cfg.intervalMs}
                onChange={(e) =>
                  patch(state, { intervalMs: Number(e.target.value) || cfg.intervalMs })
                }
              />
            </label>
          </fieldset>
        )
      })}
    </div>
  )
}
