import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { callBridge } from '../../rpc/bridge'
import { QuietButton, Text } from '../../ui'

/* Poll cadence for google.signInPoll: start returns at once (the RPC
 * timeout is 15s, so a consent wait can never be one long-poll) and the
 * renderer polls until done/error/cancel/unmount. */
export const GOOGLE_POLL_MS = 2000

/* Google sign-in flow state: the token itself never crosses into the
 * renderer. Waiting shows the one-liner plus Cancel; done refetches
 * recents, error shows its message one-liner and refetches too (the
 * section may have rows). */
export function useGoogleSignIn(): {
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
        callBridge('google.signInCancel').catch(() => undefined)
      }
    },
    []
  )

  async function poll(): Promise<void> {
    let result: { status: 'pending' | 'done' | 'error'; message?: string }
    try {
      result = await callBridge('google.signInPoll')
    } catch {
      /* Transient poll failure — stay in flight and retry. */
      if (stoppedRef.current) return
      timerRef.current = window.setTimeout(() => void poll(), GOOGLE_POLL_MS)
      return
    }
    if (stoppedRef.current) return
    if (result.status === 'pending') {
      timerRef.current = window.setTimeout(() => void poll(), GOOGLE_POLL_MS)
      return
    }
    inFlightRef.current = false
    setWaiting(false)
    if (result.status === 'done') {
      setError(null)
    } else {
      setError(result.message ?? "Couldn't sign in with Google")
    }
    await queryClient.invalidateQueries({ queryKey: ['rpc', 'docs.listRecents'] })
  }

  async function start(): Promise<void> {
    if (inFlightRef.current) return
    inFlightRef.current = true
    setError(null)
    stoppedRef.current = false
    try {
      await callBridge('google.signInStart')
    } catch {
      inFlightRef.current = false
      setError("Couldn't start Google sign-in")
      return
    }
    setWaiting(true)
    timerRef.current = window.setTimeout(() => void poll(), GOOGLE_POLL_MS)
  }

  async function cancel(): Promise<void> {
    stoppedRef.current = true
    inFlightRef.current = false
    clearTimer()
    try {
      await callBridge('google.signInCancel')
    } catch {
      /* Quiet — cancelling already lands back at idle. */
    }
    setWaiting(false)
  }

  return { waiting, error, start, cancel }
}

/* Drive signed-out control: "Sign in with Google" starts the loopback
 * flow (browser opens out-of-app), then polls every 2s. */
export function GoogleSignInControl(): React.JSX.Element {
  const { waiting, error, start, cancel } = useGoogleSignIn()

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
        Sign in with Google
      </QuietButton>
      {error !== null && (
        <Text variant="small" as="span" role="status">
          {error}
        </Text>
      )}
    </span>
  )
}
