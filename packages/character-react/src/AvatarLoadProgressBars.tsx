import type { CSSProperties } from 'react'
import type { AvatarAssetLoadProgress } from '@nexus/character-kit'

const trackStyle: CSSProperties = {
  height: 3,
  borderRadius: 2,
  background: 'rgba(0, 0, 0, 0.45)',
  overflow: 'hidden',
  position: 'relative',
}

const fillBase: CSSProperties = {
  height: '100%',
  borderRadius: 2,
  background: 'rgba(158, 208, 255, 0.95)',
  transformOrigin: 'left center',
}

export type AvatarLoadProgressBarsProps = {
  progress: AvatarAssetLoadProgress
  className?: string
  style?: CSSProperties
}

function Bar({ ratio, label }: { ratio: number; label: string }) {
  const indeterminate = ratio < 0
  const widthPct = indeterminate ? 28 : Math.max(2, Math.min(100, ratio * 100))
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : Math.round(Math.max(0, Math.min(1, ratio)) * 100)}
      aria-valuetext={indeterminate ? 'loading' : undefined}
      style={trackStyle}
    >
      <div
        style={{
          ...fillBase,
          width: `${widthPct}%`,
          ...(indeterminate
            ? {
                animation: 'nexus-avatar-load-indeterminate 1.1s ease-in-out infinite',
                position: 'absolute',
                left: 0,
                top: 0,
              }
            : null),
        }}
      />
    </div>
  )
}

/**
 * Thin top-of-view progress: model bar always while loading; gestures bar only when motions load.
 */
export function AvatarLoadProgressBars({ progress, className, style }: AvatarLoadProgressBarsProps) {
  const showModel = progress.model != null
  const showGestures = progress.gestures != null
  if (!showModel && !showGestures) return null

  return (
    <div
      className={className}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 4,
        pointerEvents: 'none',
        padding: '8px 10px 0',
        display: 'grid',
        gap: 4,
        ...style,
      }}
    >
      <style>{`@keyframes nexus-avatar-load-indeterminate{0%{left:0}50%{left:72%}100%{left:0}}`}</style>
      {showModel ? <Bar ratio={progress.model as number} label="Model" /> : null}
      {showGestures ? <Bar ratio={progress.gestures as number} label="Motions" /> : null}
    </div>
  )
}
