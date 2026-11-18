import type { HTMLAttributes, ReactNode } from 'react'
import './Row.css'
import { Text } from './Text'

export interface RowProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
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
  leading,
  title,
  meta,
  preview,
  trailing,
  selected = false,
  className,
  ...rest
}: RowProps): React.JSX.Element {
  return (
    <div
      {...rest}
      className={['moki-row', selected ? 'selected-lit' : null, className]
        .filter(Boolean)
        .join(' ')}
    >
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
    </div>
  )
}
