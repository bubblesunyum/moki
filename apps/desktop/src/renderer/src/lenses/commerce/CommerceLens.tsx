import { BundleLens } from '../bundles/BundleLens'

/* Commerce lens: the shared inbox interface over the psymail/commerce tab. */
export function CommerceLens(): React.JSX.Element {
  return <BundleLens label="psymail/commerce" title="Commerce" lensId="commerce" />
}
