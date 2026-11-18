import type { ButtonHTMLAttributes } from 'react'
import './QuietButton.css'

export interface QuietButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {}

/* Shared quiet retry button: 13/500 ink on the quiet fill (brief "States").
 * Used by ThreadList, InfiniteList and ThreadPane so every retry looks the
 * same. */
export function QuietButton({
  type = 'button',
  className,
  children = 'Retry',
  ...rest
}: QuietButtonProps): React.JSX.Element {
  return (
    <button
      type={type}
      {...rest}
      className={['moki-quiet-button', className].filter(Boolean).join(' ')}
    >
      {children}
    </button>
  )
}
