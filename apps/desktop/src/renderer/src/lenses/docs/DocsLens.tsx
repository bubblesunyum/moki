import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { DocItem, DocSource } from '../../../../../../../packages/protocol/src/index'
import { GlassPane, Icon, QuietButton, QuietState, Text } from '../../ui'
import { formatListDate } from '../mail/formatListDate'
import { DocPreview } from './DocPreview'
import { DOC_SOURCES, DOC_SOURCE_LABEL, isPreviewable } from './fixtures'
import { useDocsRecents, type DocsRecents } from './useDocsRecents'
import { callBridge, getBridge } from '../../rpc/bridge'
import { ZenImportControl } from './ZenImportControl'
import { NotionSignedOutExplainer } from './NotionAuth'
import { GoogleSignInControl } from './GoogleAuth'
import { CraftConnectForm } from './CraftAuth'
import '../mail/InboxLayout.css'
import './DocsLens.css'

function queryParam(name: string): string | undefined {
  const raw = new URLSearchParams(window.location.search).get(name)?.trim()
  return raw === null || raw === undefined || raw === '' ? undefined : raw
}

/* Synthetic Craft home selection (mok-8uu.11/8uu.6): empty-unreachable
 * Craft (no credential to fix) offers Open Craft, which selects this doc
 * and loads the Craft home page in the preview pane for browsing.
 * Presentation, not contract data — it lives here, not in fixtures.ts,
 * and never appears in any section's items (resolved by id outside
 * `all`). Signed-out Craft instead shows the connect form; live Craft
 * rows carry deepLinks and open externally, never in the preview. */
const CRAFT_HOME_DOC: DocItem = {
  id: 'craft-home',
  title: 'Craft',
  source: 'craft',
  updatedAt: new Date(0).toISOString(),
  openUrl: 'https://www.craft.do'
}

function OpenCraftAction({ onSelect }: { onSelect: (doc: DocItem) => void }): React.JSX.Element {
  return (
    <QuietButton type="button" onClick={() => onSelect(CRAFT_HOME_DOC)}>
      Open Craft
    </QuietButton>
  )
}

/* Shared sign-out affordance for the signed-in notion/craft sections: one
 * button, one optimistic empty-section flip, one failure one-liner. The
 * two sources differ only in method and query key, carried as props. */
export function DocsSignOutButton({
  source,
  method
}: {
  source: DocSource
  method: 'notion.signOut' | 'craftConnect.signOut'
}): React.JSX.Element {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  async function signOut(): Promise<void> {
    if (busy) return
    setBusy(true)
    setFailed(false)
    try {
      await callBridge(method)
      queryClient.setQueryData(['rpc', 'docs.listRecents', { source }], {
        items: [],
        signedOut: true,
        unreachable: false
      })
      await queryClient.invalidateQueries({ queryKey: ['rpc', 'docs.listRecents'] })
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="moki-docs-signout">
      <QuietButton type="button" onClick={() => void signOut()} disabled={busy}>
        {busy ? 'Signing out…' : 'Sign out'}
      </QuietButton>
      {failed && (
        <Text variant="small" as="span" role="status">
          Couldn't sign out
        </Text>
      )}
    </span>
  )
}

/* Signed-in sign-out affordance per source: Drive has none (its credential
 * lives in the Google flow alone), notion/craft share one button. Looked
 * up once in the section head behind showSignOut. */
const SIGN_OUT_AFFORDANCE: Record<DocSource, React.JSX.Element | null> = {
  drive: null,
  notion: <DocsSignOutButton source="notion" method="notion.signOut" />,
  craft: <DocsSignOutButton source="craft" method="craftConnect.signOut" />
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

/* Notion integration-token settings page: see NotionSignedOutExplainer in
 * NotionAuth (the token itself stays Keychain-only). */

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
  /* Notion and Craft carry their own auth affordances: the token /
   * connect form in the signed-out state, a sign-out button beside the
   * title once signed in. Both need the bridge; fixture mode (plain
   * browser, captures) stays clean without them. */
  const hasBridge = getBridge() !== null
  const showSignOut =
    (source === 'notion' || source === 'craft') &&
    hasBridge &&
    query.status !== 'loading' &&
    query.status !== 'signed-out'
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
          {source === 'drive' && (
            <>
              <QuietState
                icon="notes"
                text="Sign in to Google"
                label="Drive needs sign-in"
                action={<GoogleSignInControl />}
              />
              <Text variant="small" tone="muted" as="p" className="moki-docs-auth-note">
                Zen import signs in previews, not the list
              </Text>
            </>
          )}
          {source === 'craft' && (
            <>
              <QuietState icon="notes" text="Connect Craft to list docs" label="Craft needs sign-in" />
              <div className="moki-docs-auth">
                <CraftConnectForm />
              </div>
            </>
          )}
          {source === 'notion' && (
            <>
              <QuietState
                icon="notes"
                text="Sign in to Notion"
                label="Notion needs sign-in"
              />
              <div className="moki-docs-auth">
                <NotionSignedOutExplainer />
              </div>
            </>
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
        {showSignOut ? SIGN_OUT_AFFORDANCE[source] : null}
      </div>
      {source === 'craft' && query.items.length > 0 && (
        <Text variant="small" tone="muted" as="p" className="moki-docs-craft-note">
          In space order
        </Text>
      )}
      {query.items.map((doc) => (
        <DocRow key={doc.id} doc={doc} selected={doc.id === selectedId} onSelect={onSelect} />
      ))}
      {notice !== null && <SectionNotice text={notice} />}
      {source === 'craft' && query.status === 'unreachable' && query.items.length === 0 && (
        <div className="moki-docs-section-state">
          <OpenCraftAction onSelect={onSelect} />
        </div>
      )}
    </section>
  )
}

/* Docs lens: three stacked sections (Drive, Notion, Craft) beside the
 * preview pane, mirroring the Messages 2-up. One selection across the
 * previewable rows (openUrl non-empty) replaces the right pane per click;
 * Craft deep-link rows open in the native app via openExternal and never
 * touch the selection. Fixtures carry the UX until the helper lands live
 * listing (mok-8uu.3/4/6). */
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
  /* Preview-eligible rows only: Craft live rows carry openUrl:'' plus a
   * craftdocs:// deepLink and open out-of-app, so they never auto-select
   * or resolve as the preview doc. */
  const previewable = useMemo(() => all.filter(isPreviewable), [all])

  /* A picked row that vanishes (signed-out, refetch) clears the selection —
   * the preview goes empty rather than swapping unprompted. The synthetic
   * Craft home pick is exempt: it never appears in `all`. */
  useEffect(() => {
    if (selectedId === CRAFT_HOME_DOC.id) return
    if (hasPicked && selectedId !== null && !all.some((doc) => doc.id === selectedId)) {
      setSelectedId(null)
    }
  }, [all, hasPicked, selectedId])

  const selected: DocItem | null = useMemo(() => {
    if (selectedId === CRAFT_HOME_DOC.id) return CRAFT_HOME_DOC
    if (selectedId !== null) return previewable.find((doc) => doc.id === selectedId) ?? null
    if (hasPicked) return null
    if (previewable.length === 0) return null
    if (preference !== undefined)
      return previewable.find((doc) => doc.id === preference) ?? previewable[0]
    return previewable[0]
  }, [previewable, selectedId, preference, hasPicked])

  function handleSelect(doc: DocItem): void {
    /* Deep-link rows (Craft native-app open) never touch the selection —
     * they open externally and the preview stays where it was. */
    if (!isPreviewable(doc)) {
      if (doc.deepLink) {
        getBridge()?.openExternal(doc.deepLink).catch(() => undefined)
      }
      return
    }
    setSelectedId(doc.id)
    setHasPicked(true)
  }

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
            onSelect={handleSelect}
          />
        ))}
      </GlassPane>
      <GlassPane className="moki-inbox-thread" data-testid="docs-preview-pane">
        <DocPreview key={selected?.id ?? 'none'} doc={selected} />
      </GlassPane>
    </div>
  )
}
