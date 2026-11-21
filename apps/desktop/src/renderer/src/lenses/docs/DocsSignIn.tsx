import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { DocsSignInPollResult } from '../../../../../../../packages/protocol/src/index'
import { callBridge } from '../../rpc/bridge'
import { QuietButton, Text } from '../../ui'

/* Poll cadence for Docs OAuth sign-ins: start returns at once (the RPC
 * timeout is 15s, so a consent wait can never be one long-poll) and the
 * renderer polls until done/error/cancel/unmount. Shared by the Google and
 * Notion flows — the two differ only in method names. */
export const DOCS_SIGN_IN_POLL_MS = 2000

/* One provider's exact start/poll/cancel RPC names. A union keeps the
 * label from lying about which methods it calls. */
export type DocsSignInMethods =
  | {
      provider: 'Google'
      start: 'google.signInStart'
      poll: 'google.signInPoll'
      cancel: 'google.signInCancel'
    }
  | {
      provider: 'Notion'
      start: 'notion.signInStart'
      poll: 'notion.signInPoll'
      cancel: 'notion.signInCancel'
    }

export const GOOGLE_SIGN_IN_METHODS: DocsSignInMethods = {
  provider: 'Google',
  start: 'google.signInStart',
  poll: 'google.signInPoll',
  cancel: 'google.signInCancel'
}

export const NOTION_SIGN_IN_METHODS: DocsSignInMethods = {
  provider: 'Notion',
  start: 'notion.signInStart',
  poll: 'notion.signInPoll',
  cancel: 'notion.signInCancel'
}

/* Docs OAuth sign-in flow state: the token itself never crosses into the
 * renderer. Waiting shows the one-liner plus Cancel; done refetches
 * recents, error shows its message one-liner and refetches too (the
 * section may have rows). Helper error messages pass through verbatim —
 * never collapsed — so consent, config and retry causes stay visible. */
export function useDocsSignIn(methods: DocsSignInMethods): {
  waiting: boolean
  error: string | null
  start: () => Promise<void>
  cancel: () => Promise<void>
} {
  const queryClient = useQueryClient()
  const [waiting, setWaiting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const timerRef = useRef<number | null>(null)
  const stoppedRef = useRef(false)
  /* A flow is in flight from the synchronous top of start() until it
   * settles (done/error/cancel/unmount). The `waiting` state flips only
   * after the async signInStart resolves, so a state guard alone admits
   * two flows on rapid clicks — this ref closes that window. */
  const inFlightRef = useRef(false)
  const methodsRef = useRef(methods)
  useEffect(() => {
    methodsRef.current = methods
  }, [methods])

  function clearTimer(): void {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  useEffect(
    () => () => {
      stoppedRef.current = true
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
      /* Unmount mid-flow: the helper holds the listener plus its
       * background task up to 5 minutes, and a completed abandoned tab
       * still saves a token — release it. Fire-and-forget: nothing left
       * to update. Idle unmounts stay quiet. */
      if (inFlightRef.current) {
        inFlightRef.current = false
        callBridge(methodsRef.current.cancel).catch(() => undefined)
      }
    },
    []
  )

  async function poll(): Promise<void> {
    const label = methodsRef.current.provider
    let result: DocsSignInPollResult
    try {
      result = await callBridge(methodsRef.current.poll)
    } catch {
      /* Transient poll failure — stay in flight and retry. */
      if (stoppedRef.current) return
      timerRef.current = window.setTimeout(() => void poll(), DOCS_SIGN_IN_POLL_MS)
      return
    }
    if (stoppedRef.current) return
    if (result.status === 'pending') {
      timerRef.current = window.setTimeout(() => void poll(), DOCS_SIGN_IN_POLL_MS)
      return
    }
    inFlightRef.current = false
    setWaiting(false)
    if (result.status === 'done') {
      setError(null)
    } else {
      setError(result.message ?? `Couldn't sign in with ${label}`)
    }
    await queryClient.invalidateQueries({ queryKey: ['rpc', 'docs.listRecents'] })
  }

  async function start(): Promise<void> {
    if (inFlightRef.current) return
    inFlightRef.current = true
    const label = methodsRef.current.provider
    setError(null)
    stoppedRef.current = false
    try {
      await callBridge(methodsRef.current.start)
    } catch {
      /* Cancel/unmount already landed: the helper's guarded start throws
       * cancelled, which must stay quiet — no error line on a dead flow. */
      if (stoppedRef.current) return
      /* A start failure never leaves the button: the quiet generic line,
       * matching the original Google flow. Poll errors below still carry
       * the helper's own message verbatim. */
      inFlightRef.current = false
      setError(`Couldn't start ${label} sign-in`)
      return
    }
    /* Unmounted while the start RPC was in flight: cleanup already sent
     * signInCancel. Never set state or schedule a poll on the dead mount. */
    if (stoppedRef.current) return
    setWaiting(true)
    timerRef.current = window.setTimeout(() => void poll(), DOCS_SIGN_IN_POLL_MS)
  }

  async function cancel(): Promise<void> {
    stoppedRef.current = true
    inFlightRef.current = false
    clearTimer()
    try {
      await callBridge(methodsRef.current.cancel)
    } catch {
      /* Quiet — cancelling already lands back at idle. */
    }
    setWaiting(false)
  }

  return { waiting, error, start, cancel }
}

/* Generic Docs OAuth signed-out control: "Sign in with {provider}"
 * starts the loopback flow (browser opens out-of-app), then polls every
 * 2s. The method config carries its own display label. */
export function DocsSignInControl({
  methods
}: {
  methods: DocsSignInMethods
}): React.JSX.Element {
  const { waiting, error, start, cancel } = useDocsSignIn(methods)

  if (waiting) {
    return (
      <span className="moki-docs-signout">
        <Text variant="small" tone="muted" as="span" role="status">
          Waiting for browser…
        </Text>
        <QuietButton type="button" onClick={() => void cancel()}>
          Cancel
        </QuietButton>
      </span>
    )
  }

  return (
    <span className="moki-docs-signout">
      <QuietButton type="button" onClick={() => void start()}>
        Sign in with {methods.provider}
      </QuietButton>
      {error !== null && (
        <Text variant="small" as="span" role="status">
          {error}
        </Text>
      )}
    </span>
  )
}
