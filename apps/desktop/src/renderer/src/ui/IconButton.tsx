import type { ButtonHTMLAttributes } from 'react'
import './IconButton.css'
import { Icon, type FigmaIconName } from './Icon'

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: FigmaIconName
  label: string
  iconSize?: number
}

/* 36px icon button (window chrome, search, mic, toggles). Glyph defaults to
 * 20px; radius follows the row token (8px) like the window-chrome buttons. */
export function IconButton({
  icon,
  label,
  iconSize = 20,
  className,
  type = 'button',
  ...rest
}: IconButtonProps): React.JSX.Element {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      {...rest}
      className={['moki-icon-button', className].filter(Boolean).join(' ')}
    >
      <Icon name={icon} size={iconSize} />
    </button>
  )
}
