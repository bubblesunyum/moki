import { DocsSignInControl, NOTION_SIGN_IN_METHODS } from './DocsSignIn'
import { Text } from '../../ui'

/* Signed-out explainer: the OAuth button plus one quiet line about the
 * provider approval picking which pages Moki may list. The grant lives
 * helper-side only — nothing pasteable ever enters the renderer. */
export function NotionSignedOutExplainer(): React.JSX.Element {
  return (
    <>
      <DocsSignInControl methods={NOTION_SIGN_IN_METHODS} />
      <Text variant="small" tone="muted" as="p" className="moki-docs-auth-note">
        Choose which pages Moki may list — stored only in the Mac Keychain
      </Text>
    </>
  )
}
