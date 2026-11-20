import type { ReactNode } from 'react'
import { Text } from '../../../ui'

/* Shared widget section: uppercase label over the rows. Pass `header` to
 * replace the plain label — Files uses it for the collapsible Pinned
 * toggle, which only exists past the pin limit. */
export function WidgetSection({
  label,
  title,
  header,
  children
}: {
  /** Accessible name for the section. */
  label: string
  /** Plain label text (ignored when `header` is given). */
  title: string
  header?: ReactNode
  children: ReactNode
}): React.JSX.Element {
  return (
    <section aria-label={label} className="moki-widget-section">
      {header ?? (
        <Text variant="small" tone="faint" as="div" className="moki-widget-section-label">
          {title}
        </Text>
      )}
      {children}
    </section>
  )
}
