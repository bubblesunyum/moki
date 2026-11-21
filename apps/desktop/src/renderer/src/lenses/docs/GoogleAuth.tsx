import {
  DocsSignInControl,
  DOCS_SIGN_IN_POLL_MS,
  GOOGLE_SIGN_IN_METHODS,
  useDocsSignIn
} from './DocsSignIn'
import { Text } from '../../ui'

/* Google's original names stay exported for existing imports; the shared
 * implementation now lives in DocsSignIn. */
export const GOOGLE_POLL_MS = DOCS_SIGN_IN_POLL_MS

export function useGoogleSignIn(): {
  waiting: boolean
  error: string | null
  start: () => Promise<void>
  cancel: () => Promise<void>
} {
  return useDocsSignIn(GOOGLE_SIGN_IN_METHODS)
}

/* Drive signed-out control: "Sign in with Google" starts the loopback
 * flow (browser opens out-of-app), then polls every 2s. */
export function GoogleSignInControl(): React.JSX.Element {
  return <DocsSignInControl methods={GOOGLE_SIGN_IN_METHODS} />
}

/* Drive's signed-out block matches Notion/Craft: control plus one quiet
 * note, all inside the lens's shared auth wrapper. */
export function DriveSignedOutExplainer(): React.JSX.Element {
  return (
    <>
      <GoogleSignInControl />
      <Text variant="small" tone="muted" as="p" className="moki-docs-auth-note">
        Zen import signs in previews, not the list
      </Text>
    </>
  )
}
