import { useEffect, useMemo, useState } from 'react'
import { GlassPane, SegmentGroup, type SegmentOption } from '../../ui'
import { ThreadList } from '../mail/ThreadList'
import { useInboxThreads } from '../mail/hooks/useInboxThreads'
import { useSelectedThread } from '../mail/hooks/useSelectedThread'
// Boundary: the thread pane is owned by the mok-ayu.4 worker (thread/**).
import { ThreadPane } from '../mail/thread/index'
import '../mail/InboxLayout.css'

export type BundleTab = 'all' | 'unread'

/* Text tabs (no icons): All vs client-side unread filter. */
const TAB_OPTIONS: SegmentOption[] = [
  { value: 'all', label: 'All' },
  { value: 'unread', label: 'Unread' }
]

export interface BundleLensProps {
  /* Gmail label, e.g. 'psymail/commerce'. The helper maps psymail/<name>
   * to engine tabs; mail.listThreads already takes a label. */
  label: string
  /* Lens title, used for the tab bar's accessible name. */
  title: string
  /* Lens id, used for the pane test ids (`<id>-list-pane`, `<id>-thread-pane`). */
  lensId: string
}

/* Shared Feed / Notifications / Commerce layout: the same inbox interface
 * as Messages (toolbar + thread list beside the read-only thread pane),
 * differing only in label + titles. The Unread tab is a client-side
 * `thread.unread` filter; an empty unread view reuses the list empty state. */
export function BundleLens({ label, title, lensId }: BundleLensProps): React.JSX.Element {
  const [tab, setTab] = useState<BundleTab>('all')
  const inbox = useInboxThreads(label)
  const visible = useMemo(
    () => (tab === 'unread' ? inbox.threads.filter((thread) => thread.unread) : inbox.threads),
    [tab, inbox.threads]
  )
  const { selection, select } = useSelectedThread(visible)

  /* Re-anchor a selection the filter hides: when the selected thread is not
   * among the visible rows, fall back to the first visible thread (or clear
   * the pane when the filter leaves nothing). */
  useEffect(() => {
    if (selection == null) return
    const stillVisible = visible.some(
      (thread) => thread.account === selection.account && thread.id === selection.id
    )
    if (!stillVisible) {
      const first = visible[0]
      select(first === undefined ? null : { account: first.account, id: first.id })
    }
  }, [visible, selection, select])

  /* The Unread filter sees only loaded pages, so an empty visible list with
   * pages still unfetched must not read as "clear": keep advancing while the
   * Unread tab is active until an unread row arrives or pages exhaust. */
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = inbox
  useEffect(() => {
    if (tab === 'unread' && visible.length === 0 && hasNextPage && !isFetchingNextPage) {
      void fetchNextPage()
    }
  }, [tab, visible.length, hasNextPage, isFetchingNextPage, fetchNextPage])

  return (
    <div className="moki-inbox-lens">
      <GlassPane className="moki-inbox-list" data-testid={`${lensId}-list-pane`}>
        <div className="moki-inbox-toolbar">
          <SegmentGroup
            label={`${title} filter`}
            value={tab}
            options={TAB_OPTIONS}
            onChange={(value) => setTab(value as BundleTab)}
          />
        </div>
        <ThreadList
          query={{ ...inbox, threads: visible }}
          selection={selection}
          onSelect={select}
          title={title}
        />
      </GlassPane>
      <GlassPane className="moki-inbox-thread" data-testid={`${lensId}-thread-pane`}>
        <ThreadPane selection={selection} />
      </GlassPane>
    </div>
  )
}
