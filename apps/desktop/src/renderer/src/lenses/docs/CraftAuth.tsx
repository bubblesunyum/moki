import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { callBridge } from '../../rpc/bridge'
import { QuietButton, Text } from '../../ui'

/* Craft Connect form (mok-8uu.6): the connection URL is the credential —
 * paste it once, the helper validates it (GET /connection) and stores it
 * in its 0600 file. Two steps: Validate shows the space name, Save stores
 * and refetches. The URL is read once from the field at submit and never
 * held in React state; the field clears after save. */
export function CraftConnectForm(): React.JSX.Element {
  const queryClient = useQueryClient()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [spaceName, setSpaceName] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function validate(): Promise<void> {
    const url = inputRef.current?.value.trim() ?? ''
    if (url === '' || checking || saving) return
    setChecking(true)
    setError(null)
    try {
      const result = await callBridge('craftConnect.validate', { url })
      if (result.ok) {
        setSpaceName(result.spaceName ?? 'Space found')
      } else {
        setSpaceName(null)
        setError("Couldn't validate that URL")
      }
    } catch {
      setSpaceName(null)
      setError("Couldn't validate that URL")
    } finally {
      setChecking(false)
    }
  }

  async function save(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    const url = inputRef.current?.value.trim() ?? ''
    /* Same mutual exclusion as validate(): an Enter submit mid-check
     * must not fire a save alongside the in-flight validation. */
    if (url === '' || saving || checking) return
    setSaving(true)
    setError(null)
    try {
      await callBridge('craftConnect.save', { url })
      if (inputRef.current) inputRef.current.value = ''
      setSpaceName(null)
      await queryClient.invalidateQueries({ queryKey: ['rpc', 'docs.listRecents'] })
    } catch {
      setError("Couldn't save that connection")
    } finally {
      setSaving(false)
    }
  }

  function cancel(): void {
    if (inputRef.current) inputRef.current.value = ''
    setSpaceName(null)
    setError(null)
  }

  return (
    <form className="moki-docs-token-form" onSubmit={(event) => void save(event)}>
      <input
        ref={inputRef}
        type="password"
        aria-label="Craft connection URL"
        className="moki-docs-token-input"
        placeholder="https://connect.craft.do/…"
        autoComplete="off"
        spellCheck={false}
        disabled={checking || saving}
        onChange={() => {
          /* A fresh edit invalidates the last validation and its error —
           * a stale line must not assert anything about the new value. */
          if (spaceName !== null) setSpaceName(null)
          if (error !== null) setError(null)
        }}
      />
      <div className="moki-docs-token-actions">
        {spaceName === null ? (
          <QuietButton type="button" disabled={checking || saving} onClick={() => void validate()}>
            {checking ? 'Checking…' : 'Validate'}
          </QuietButton>
        ) : (
          <>
            <QuietButton type="submit" disabled={checking || saving}>
              {saving ? 'Saving…' : 'Save'}
            </QuietButton>
            <QuietButton type="button" disabled={checking || saving} onClick={cancel}>
              Cancel
            </QuietButton>
          </>
        )}
      </div>
      {spaceName !== null && (
        <Text variant="small" tone="muted" as="p" role="status">
          {spaceName}
        </Text>
      )}
      {error !== null && (
        <Text variant="small" as="p" className="moki-docs-token-error" role="status">
          {error}
        </Text>
      )}
    </form>
  )
}

/* Signed-out affordance: the paste-once form plus one quiet line pointing
 * at where the URL lives in Craft's UI. The URL itself is the credential —
 * read once from the field at submit, never held in state, never echoed
 * back anywhere outside the input. */
export function CraftSignedOutExplainer(): React.JSX.Element {
  return (
    <>
      <CraftConnectForm />
      <Text variant="small" tone="muted" as="p" className="moki-docs-auth-note">
        Craft → Settings → API → Create connection
      </Text>
    </>
  )
}
