import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react'
import './Row.css'
import { Text } from './Text'

export interface RowProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /* Render as a native <button> for fully clickable rows (MessageRow), so
   * keyboard activation comes free without manual Enter/Space handling. */
  as?: 'div' | 'button'
  type?: ButtonHTMLAttributes<HTMLButtonElement>['type']
  leading?: ReactNode
  title: ReactNode
  /* Top-right slot, e.g. a timestamp. */
  meta?: ReactNode
  preview?: ReactNode
  trailing?: ReactNode
  selected?: boolean
}

/* Generic list row: leading/trailing slots around a title + preview column.
 * Selected rows use the shared .selected-lit style. */
export function Row({
  as = 'div',
  type = 'button',
  leading,
  title,
  meta,
  preview,
  trailing,
  selected = false,
  className,
  ...rest
}: RowProps): React.JSX.Element {
  const classes = ['moki-row', selected ? 'selected-lit' : null, className]
    .filter(Boolean)
    .join(' ')
  const body = (
    <>
      {leading}
      <div className="moki-row-body">
        <div className="moki-row-top">
          <Text variant="control" tone={selected ? 'white' : 'ink'} className="moki-row-title">
            {title}
          </Text>
          {meta ? (
            <Text variant="small" className="moki-row-meta">
              {meta}
            </Text>
          ) : null}
        </div>
        {preview ? (
          <Text variant="text" className="moki-row-preview">
            {preview}
          </Text>
        ) : null}
      </div>
      {trailing ? <span className="moki-row-trailing">{trailing}</span> : null}
    </>
  )
  if (as === 'button') {
    return (
      <button type={type} {...(rest as ButtonHTMLAttributes<HTMLButtonElement>)} className={classes}>
        {body}
      </button>
    )
  }
  return (
    <div {...rest} className={classes}>
      {body}
    </div>
  )
}
