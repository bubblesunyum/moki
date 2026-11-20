import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { callBridge } from '../../rpc/bridge'
import { QuietButton, Text } from '../../ui'

/* Notion token auth (mok-8uu.10). The integration token lives in the helper
 * Keychain: the form reads the field once at submit and passes it straight
 * to `notion.setToken` — never into React state, never into localStorage —
 * then clears the field. Sign-out calls `notion.signOut` (server-side wipe)
 * and flips the section to signed-out immediately with an optimistic cache
 * write before the refetch lands. */

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

export function NotionSignOutButton(): React.JSX.Element {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  async function signOut(): Promise<void> {
    if (busy) return
    setBusy(true)
    setFailed(false)
    try {
      await callBridge('notion.signOut')
      queryClient.setQueryData(['rpc', 'docs.listRecents', { source: 'notion' }], {
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
