import { BundleLens } from '../bundles/BundleLens'

/* Notifications lens: the shared inbox interface over the
 * psymail/notifications tab. */
export function NotificationsLens(): React.JSX.Element {
  return <BundleLens label="psymail/notifications" title="Notifications" lensId="notifications" />
}
