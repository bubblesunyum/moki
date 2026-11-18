import type { CSSProperties, HTMLAttributes, ReactNode } from 'react'
import './Avatar.css'
import { Icon, type FigmaIconName } from './Icon'

/* Number of gradient pairs in the avatar palette (mirrors the
 * --moki-avatar-*-a/b variables in tokens.css). */
export const AVATAR_PALETTE_SIZE = 17

function hashName(name: string): number {
  // FNV-1a over UTF-16 code units; deterministic across sessions.
  let hash = 0x811c9dc5
  for (let i = 0; i < name.length; i += 1) {
    hash ^= name.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

type SegmenterLike = new (
  locales?: string,
  options?: { granularity?: string }
) => { segment(text: string): Iterable<{ segment: string }> }

function graphemes(text: string): string[] {
  const Segmenter = (Intl as unknown as { Segmenter?: SegmenterLike }).Segmenter
  if (typeof Segmenter === 'function') {
    return [...new Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map(
      (part) => part.segment
    )
  }
  return Array.from(text)
}

export function avatarInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return graphemes(parts[0]).slice(0, 2).join('').toUpperCase()
  return (graphemes(parts[0])[0] + graphemes(parts[parts.length - 1])[0]).toUpperCase()
}

export function avatarPaletteIndex(name: string): number {
  return hashName(name) % AVATAR_PALETTE_SIZE
}

/* Row gradient from the brief: 135deg, start at 14%, end at 86%.
 * References the token variables so the hex values live in tokens.css only. */
export function avatarGradient(name: string): string {
  const i = avatarPaletteIndex(name)
  return `linear-gradient(135deg, var(--moki-avatar-${i}-a) 14%, var(--moki-avatar-${i}-b) 86%)`
}

export interface AvatarProps extends HTMLAttributes<HTMLDivElement> {
  name: string
  size?: number
  badge?: ReactNode
}

export function Avatar({
  name,
  size = 32,
  badge,
  className,
  style,
  ...rest
}: AvatarProps): React.JSX.Element {
  const merged: CSSProperties = {
    width: size,
    height: size,
    fontSize: size >= 48 ? 15 : 13,
    background: avatarGradient(name),
    ...style
  }
  return (
    <div
      role="img"
      aria-label={name}
      {...rest}
      className={['moki-avatar', className].filter(Boolean).join(' ')}
      style={merged}
    >
      <span
        className="moki-avatar-initials"
        aria-hidden="true"
        style={{ fontWeight: size >= 48 ? 700 : 500 }}
      >
        {avatarInitials(name)}
      </span>
      {badge ? <span className="moki-avatar-badge">{badge}</span> : null}
    </div>
  )
}

export type AvatarBadgeAccent = 'cyan' | 'violet' | 'mint' | 'amber' | 'coral'

const ACCENT_VAR: Record<AvatarBadgeAccent, string> = {
  cyan: 'var(--moki-accent-cyan)',
  violet: 'var(--moki-accent-violet)',
  mint: 'var(--moki-accent-mint)',
  amber: 'var(--moki-accent-amber)',
  coral: 'var(--moki-accent-coral)'
}

export interface AvatarBadgeProps {
  accent: AvatarBadgeAccent
  icon: FigmaIconName
  label: string
}

export function AvatarBadge({ accent, icon, label }: AvatarBadgeProps): React.JSX.Element {
  return (
    <span
      className="moki-avatar-badge-dot"
      role="img"
      aria-label={label}
      title={label}
      style={{ background: ACCENT_VAR[accent] }}
    >
      <Icon name={icon} size={10} color="var(--moki-badge-ink)" />
    </span>
  )
}
