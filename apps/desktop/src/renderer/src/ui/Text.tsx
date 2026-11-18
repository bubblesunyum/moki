import type { HTMLAttributes } from 'react'

export type TextVariant = 'text' | 'control' | 'control-selected' | 'small' | 'title' | 'body'
export type TextTone = 'ink' | 'muted' | 'faint' | 'white' | 'inherit'

export interface TextProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: TextVariant
  /* Overrides the variant's default color. Defaults to the brief's color for
   * the variant (text/control -> muted, control-selected/body -> white,
   * small -> faint, title -> ink). */
  tone?: TextTone
  as?: 'span' | 'p' | 'div'
}

const VARIANT_CLASS: Record<TextVariant, string> = {
  text: 'lens-text',
  control: 'lens-control',
  'control-selected': 'lens-control-selected',
  small: 'lens-small',
  title: 'lens-title',
  body: 'lens-body'
}

export function Text({
  variant = 'text',
  tone,
  as = 'span',
  className,
  ...rest
}: TextProps): React.JSX.Element {
  const cls = [VARIANT_CLASS[variant], tone ? `tone-${tone}` : null, className]
    .filter(Boolean)
    .join(' ')
  if (as === 'p') {
    return <p {...rest} className={cls} />
  }
  if (as === 'div') {
    return <div {...rest} className={cls} />
  }
  return <span {...rest} className={cls} />
}
