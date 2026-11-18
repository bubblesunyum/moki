import type { CSSProperties, HTMLAttributes } from 'react'
import './GlassPane.css'

export interface GlassPaneProps extends HTMLAttributes<HTMLDivElement> {
  radius?: string
  padding?: string | number
}

/* Rounded pane with the glass fill/blur/edge/shadow from the brief.
 * Sidebar and inspector sit directly on the backdrop (no surface of their own);
 * Messages/Thread panes are glass cards (radius 12). */
export function GlassPane({
  radius = 'var(--moki-radius-card)',
  padding,
  className,
  style,
  ...rest
}: GlassPaneProps): React.JSX.Element {
  const merged: CSSProperties = { borderRadius: radius, ...(padding !== undefined ? { padding } : null), ...style }
  return (
    <div
      {...rest}
      className={['moki-glass-pane', className].filter(Boolean).join(' ')}
      style={merged}
    />
  )
}
