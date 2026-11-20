import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { callBridge, getBridge } from '../../rpc/bridge'
import { QuietButton, Text } from '../../ui'

/* Notion integration-token settings page. The token itself stays
 * Keychain-only — the form below reads the field once at submit. */
const NOTION_INTEGRATIONS_URL = 'https://www.notion.so/my-integrations'

function openNotionIntegrations(): void {
  getBridge()?.openExternal(NOTION_INTEGRATIONS_URL).catch(() => undefined)
}

/* Signed-out explainer: what the token is, where to get it, where it's
 * kept — plus the form. One element so the lens's notion branch reads
 * like the drive/craft branches. */
export function NotionSignedOutExplainer(): React.JSX.Element {
  return (
    <>
      <Text variant="small" tone="muted" as="p" className="moki-docs-auth-note">
        Integration token from{' '}
        <button type="button" className="moki-docs-link" onClick={openNotionIntegrations}>
          Notion settings
        </button>{' '}
        — stored only in the Mac Keychain
      </Text>
      <NotionTokenForm />
    </>
  )
}

/* Token form: reads the field once at submit and passes it straight to
 * `notion.setToken` — never into React state, never into localStorage —
 * then clears the field. */
export function NotionTokenForm(): React.JSX.Element {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  if (!open) {
    return (
      <QuietButton
        type="button"
        aria-expanded={false}
        onClick={() => {
          setFailed(false)
          setOpen(true)
        }}
      >
        Paste token
      </QuietButton>
    )
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    const token = inputRef.current?.value.trim() ?? ''
    if (token === '' || saving) return
    setSaving(true)
    setFailed(false)
    try {
      await callBridge('notion.setToken', { token })
      if (inputRef.current) inputRef.current.value = ''
      setOpen(false)
      await queryClient.invalidateQueries({ queryKey: ['rpc', 'docs.listRecents'] })
    } catch {
      setFailed(true)
    } finally {
      setSaving(false)
    }
  }

  function cancel(): void {
    if (inputRef.current) inputRef.current.value = ''
    setFailed(false)
    setOpen(false)
  }

  return (
    <form className="moki-docs-token-form" onSubmit={(event) => void submit(event)}>
      <input
        ref={inputRef}
        type="password"
        aria-label="Notion integration token"
        className="moki-docs-token-input"
        placeholder="secret_…"
        autoComplete="off"
        spellCheck={false}
        disabled={saving}
      />
      <div className="moki-docs-token-actions">
        <QuietButton type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </QuietButton>
        <QuietButton type="button" disabled={saving} onClick={cancel}>
          Cancel
        </QuietButton>
      </div>
      {failed && (
        <Text variant="small" as="p" className="moki-docs-token-error" role="status">
          Couldn't save that token
        </Text>
      )}
    </form>
  )
}
