import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { DocSource } from '../../../../../../../packages/protocol/src/index'
import { DOC_SOURCES, DOC_SOURCE_LABEL } from './fixtures'
import { Icon, QuietButton, Text } from '../../ui'

/* Zen cookie import control (mok-8uu.9) — one header-level button at the top
 * of the Docs list pane. Runs the main-process import over
 * `window.mokiZenCookies` and reports plain-words status: a summary line
 * plus one signed-in / no-cookies line per source. Status only:
 * the preload surface carries per-group ok/failed plus counts, never cookie
 * names, hosts or values, and this control renders nothing else. Re-import
 * stays idempotent (main re-runs and recounts); after every import the
 * recents queries refetch so newly-signed-in previews show. Hidden without
 * the preload surface (older preloads, plain browser) — the double sign-in
 * inside the preview guest remains the fallback.
 *
 * Vocabulary: status here is keyed by DocSource ('drive'|'notion'|'craft')
 * with labels from DOC_SOURCE_LABEL. The preload surface still speaks the
 * shared zenCookies 'google' group, so getZenImporter maps 'google'→'drive'
 * once at the boundary. */

type ZenGroupState = 'ok' | 'failed'

interface ZenImportStatus {
  groups: Record<DocSource, ZenGroupState>
  imported: number
  skipped: number
}

/* Raw preload shape (shared zenCookies vocabulary — do not widen): */
interface RawZenImportStatus {
  groups: Record<'google' | 'notion' | 'craft', ZenGroupState>
  imported: number
  skipped: number
}

function getZenImporter(): (() => Promise<ZenImportStatus>) | null {
  const surface = (window as unknown as { mokiZenCookies?: { importCookies?: unknown } })
    .mokiZenCookies
  if (typeof surface?.importCookies !== 'function') return null
  const rawImport = surface.importCookies as () => Promise<RawZenImportStatus>
  return async () => {
    const result = await rawImport()
    return {
      imported: result.imported,
      skipped: result.skipped,
      groups: {
        drive: result.groups.google,
        notion: result.groups.notion,
        craft: result.groups.craft
      }
    }
  }
}

/* Plain-words summary: the count plus what to do next, or — when nothing
 * came back anywhere — the likely cause. Per-group lines carry the detail. */
function zenSummary(status: ZenImportStatus): string {
  const allFailed = DOC_SOURCES.every((source) => status.groups[source] === 'failed')
  if (allFailed) return 'Zen may not be running or has no saved logins'
  return `Imported ${status.imported} ${status.imported === 1 ? 'cookie' : 'cookies'} — open a doc and it should be signed in`
}

export function ZenImportControl(): React.JSX.Element | null {
  const queryClient = useQueryClient()
  /* Per-render const, not state: a late-injected preload surface must show
   * the control on the next render instead of hiding it forever. */
  const importer = getZenImporter()
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<ZenImportStatus | null>(null)
  const [failed, setFailed] = useState(false)

  if (importer === null) return null
  const runImporter = importer

  async function run(): Promise<void> {
    if (busy) return
    setBusy(true)
    setFailed(false)
    try {
      const result = await runImporter()
      setStatus(result)
      await queryClient.invalidateQueries({ queryKey: ['rpc', 'docs.listRecents'] })
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="moki-docs-tools">
      <QuietButton type="button" onClick={() => void run()} disabled={busy}>
        {busy ? 'Importing…' : 'Import from Zen'}
      </QuietButton>
      {status !== null && (
        <div className="moki-docs-zen-status" role="status" aria-label="Zen import status">
          <Text variant="small" tone="muted" as="p" className="moki-docs-zen-row">
            {zenSummary(status)}
          </Text>
          {DOC_SOURCES.map((source) => (
            <Text key={source} variant="small" tone="muted" as="p" className="moki-docs-zen-row">
              <Icon name={status.groups[source] === 'ok' ? 'check' : 'x'} size={12} aria-hidden />
              {DOC_SOURCE_LABEL[source]} ·{' '}
              {status.groups[source] === 'ok' ? 'signed in' : 'no Zen cookies found'}
            </Text>
          ))}
        </div>
      )}
      {failed && (
        <div className="moki-thread-list-banner" role="status">
          <Icon name="notifications" size={16} />
          <Text variant="small">Couldn't import from Zen</Text>
        </div>
      )}
    </div>
  )
}
