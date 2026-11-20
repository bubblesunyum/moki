import { useEffect, useMemo, useState } from 'react'
import type { DocItem, DocSource } from '../../../../../../../packages/protocol/src/index'
import { GlassPane, Icon, QuietState, Text } from '../../ui'
import { formatListDate } from '../mail/formatListDate'
import { DocPreview } from './DocPreview'
import { DOC_SOURCES, DOC_SOURCE_LABEL } from './fixtures'
import { useDocsRecents, type DocsRecents } from './useDocsRecents'
import { getBridge } from '../../rpc/bridge'
import { ZenImportControl } from './ZenImportControl'
import { NotionSignOutButton, NotionTokenForm } from './NotionAuth'
import '../mail/InboxLayout.css'
import './DocsLens.css'

function queryParam(name: string): string | undefined {
  const raw = new URLSearchParams(window.location.search).get(name)?.trim()
  return raw === null || raw === undefined || raw === '' ? undefined : raw
}

/* Capture override (dev only, via ?mokiDoc= on the startup URL): preselects
 * the fixture row with that id once sections arrive, so screenshots can pin
 * a preview. Unknown ids fall back to the first row. */
function preferredDocId(): string | undefined {
  try {
    return queryParam('mokiDoc')
  } catch {
    return undefined
  }
}

function DocRow({
  doc,
  selected,
  onSelect
}: {
  doc: DocItem
  selected: boolean
  onSelect: (doc: DocItem) => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={selected ? 'moki-docs-row selected-lit' : 'moki-docs-row'}
      data-testid={`docs-row-${doc.id}`}
      aria-current={selected}
      onClick={() => onSelect(doc)}
    >
      <Text variant="body" className="moki-docs-row-title">
        {doc.title}
      </Text>
      <Text variant="small" className="moki-docs-row-meta" tone="muted">
        {formatListDate(doc.updatedAt)}
      </Text>
    </button>
  )
}

/* One-line failure notice under a section's rows: the app's established
 * list-failure banner shape (cf ThreadList), adapted per section. */
function SectionNotice({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="moki-thread-list-banner" role="status">
      <Icon name="notifications" size={16} />
      <Text variant="small">{text}</Text>
    </div>
  )
}

function DocSection({
  source,
  query,
  selectedId,
  onSelect
}: {
  source: DocSource
  query: DocsRecents
  selectedId: string | null
  onSelect: (doc: DocItem) => void
}): React.JSX.Element {
  /* Notion carries its own auth affordances: the token form in the
   * signed-out state, a sign-out button beside the title once signed in.
   * Both need the bridge; fixture mode (plain browser, captures) stays
   * clean without them. */
  const hasBridge = getBridge() !== null
  const showSignOut =
    source === 'notion' && hasBridge && query.status !== 'loading' && query.status !== 'signed-out'
  if (query.status === 'loading') {
    return (
      <section className="moki-docs-section" data-testid={`docs-section-${source}`} aria-label={DOC_SOURCE_LABEL[source]}>
        <div className="moki-docs-section-head">
          <Text variant="small" className="moki-docs-section-title" tone="muted">
            {DOC_SOURCE_LABEL[source]}
          </Text>
        </div>
        <div className="moki-docs-skeletons" role="status" aria-label={`Loading ${DOC_SOURCE_LABEL[source]}`}>
          {Array.from({ length: 3 }, (_, index) => (
            <span key={index} className="moki-docs-skeleton" aria-hidden="true" />
          ))}
        </div>
      </section>
    )
  }
  if (query.status === 'signed-out') {
    return (
      <section className="moki-docs-section" data-testid={`docs-section-${source}`} aria-label={DOC_SOURCE_LABEL[source]}>
        <div className="moki-docs-section-head">
          <Text variant="small" className="moki-docs-section-title" tone="muted">
            {DOC_SOURCE_LABEL[source]}
          </Text>
        </div>
        <div className="moki-docs-section-state">
          <QuietState
            icon="notes"
            text={`Sign in to ${DOC_SOURCE_LABEL[source]}`}
            label={`${DOC_SOURCE_LABEL[source]} needs sign-in`}
          />
          {source === 'notion' && (
            <div className="moki-docs-auth">
              <NotionTokenForm />
            </div>
          )}
        </div>
      </section>
    )
  }
  const notice =
    query.status === 'partial'
      ? "Couldn't refresh — showing saved list"
      : query.status === 'unreachable'
        ? `${DOC_SOURCE_LABEL[source]} is unreachable`
        : null
  return (
    <section className="moki-docs-section" data-testid={`docs-section-${source}`} aria-label={DOC_SOURCE_LABEL[source]}>
      <div className="moki-docs-section-head">
        <Text variant="small" className="moki-docs-section-title" tone="muted">
          {DOC_SOURCE_LABEL[source]}
        </Text>
        {showSignOut && <NotionSignOutButton />}
      </div>
      {query.items.map((doc) => (
        <DocRow key={doc.id} doc={doc} selected={doc.id === selectedId} onSelect={onSelect} />
      ))}
      {notice !== null && <SectionNotice text={notice} />}
    </section>
  )
}

/* Docs lens: three stacked sections (Drive, Notion, Craft) beside the
 * preview pane, mirroring the Messages 2-up. One selection across all
 * sections replaces the right pane per click; fixtures carry the UX until
 * the helper lands live listing (mok-8uu.3/4/6). */
export function DocsLens(): React.JSX.Element {
  const drive = useDocsRecents('drive')
  const notion = useDocsRecents('notion')
  const craft = useDocsRecents('craft')
  const [preference] = useState(preferredDocId)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  /* Whether the user has picked a row this mount. Gates the initial
   * auto-select: once a pick exists, a stale id clears to the empty state
   * instead of silently reassigning to another doc. */
  const [hasPicked, setHasPicked] = useState(false)

  const sections = useMemo(() => {
    const bySource: Record<DocSource, DocsRecents> = { drive, notion, craft }
    return DOC_SOURCES.map((source) => ({ source, query: bySource[source] }))
  }, [drive, notion, craft])
  const all = useMemo(() => sections.flatMap(({ query }) => query.items), [sections])

  /* A picked row that vanishes (signed-out, refetch) clears the selection —
   * the preview goes empty rather than swapping unprompted. */
  useEffect(() => {
    if (hasPicked && selectedId !== null && !all.some((doc) => doc.id === selectedId)) {
      setSelectedId(null)
    }
  }, [all, hasPicked, selectedId])

  const selected: DocItem | null = useMemo(() => {
    if (selectedId !== null) return all.find((doc) => doc.id === selectedId) ?? null
    if (hasPicked) return null
    if (all.length === 0) return null
    if (preference !== undefined) return all.find((doc) => doc.id === preference) ?? all[0]
    return all[0]
  }, [all, selectedId, preference, hasPicked])

  return (
    <div className="moki-inbox-lens">
      <GlassPane className="moki-inbox-list moki-docs-list" data-testid="docs-list-pane">
        <ZenImportControl />
        {sections.map(({ source, query }) => (
          <DocSection
            key={source}
            source={source}
            query={query}
            selectedId={selected?.id ?? null}
            onSelect={(doc) => {
              setSelectedId(doc.id)
              setHasPicked(true)
            }}
          />
        ))}
      </GlassPane>
      <GlassPane className="moki-inbox-thread" data-testid="docs-preview-pane">
        <DocPreview key={selected?.id ?? 'none'} doc={selected} />
      </GlassPane>
    </div>
  )
}
