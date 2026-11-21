import { CRAFT_SIGN_IN_METHODS, DocsSignInControl } from './DocsSignIn'
import { Text } from '../../ui'

/* Craft sign-in (mok-68k): hosted MCP OAuth via the system browser. The
 * approval picks a space in Craft's own UI — `Choose a space in Craft`
 * says so in one quiet line. Tokens stay helper-held in the Keychain and
 * never reach the renderer: no pasteable credential ever enters this
 * file. */
export function CraftSignedOutExplainer(): React.JSX.Element {
  return (
    <>
      <DocsSignInControl methods={CRAFT_SIGN_IN_METHODS} />
      <Text variant="small" tone="muted" as="p" className="moki-docs-auth-note">
        Choose a space in Craft — stored only in the Mac Keychain
      </Text>
    </>
  )
}
