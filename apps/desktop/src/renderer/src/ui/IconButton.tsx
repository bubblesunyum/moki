import type { ButtonHTMLAttributes } from 'react'
import './IconButton.css'
import { Icon, type FigmaIconName } from './Icon'

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: FigmaIconName
  label: string
  iconSize?: number
  /** 'md' is 36px, 'sm' is 32px (panel toggles, collapsed-rail icons). */
  size?: 'md' | 'sm'
}

/* 36px icon button (window chrome, search, mic, toggles). Glyph defaults to
 * 20px; radius follows the row token (8px) like the window-chrome buttons.
 * Pass size="sm" for 32px panel toggles and collapsed-rail icons instead of
 * overriding width/height in screen CSS. */
export function IconButton({
  icon,
  label,
  iconSize = 20,
  size = 'md',
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
      className={['moki-icon-button', size === 'sm' ? 'moki-icon-button--sm' : null, className]
        .filter(Boolean)
        .join(' ')}
    >
      <Icon name={icon} size={iconSize} />
    </button>
  )
}
