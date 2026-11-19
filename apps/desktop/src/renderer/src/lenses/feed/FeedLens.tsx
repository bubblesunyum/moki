import { BundleLens } from '../bundles/BundleLens'

/* Feed lens: the shared inbox interface over the psymail/feed tab. */
export function FeedLens(): React.JSX.Element {
  return <BundleLens label="psymail/feed" title="Feed" lensId="feed" />
}
