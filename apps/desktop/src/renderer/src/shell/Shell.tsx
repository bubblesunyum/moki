import { lensById } from '../lenses/registry'
import { PrimitivesPage } from '../dev/Primitives'
import { Inspector } from './Inspector'
import { Sidebar } from './Sidebar'
import { useShell } from './ShellProvider'
import './Shell.css'

/* Webview portal target: the shell content column. The Day lens ports its
 * Peek here so the overlay covers the screen area only — never the
 * sidebar or inspector. Owns the contract both sides query. */
export const SHELL_CONTENT_CLASS = 'moki-shell-content'
export function Shell(): React.JSX.Element {
  const { activeLens, showPrimitives } = useShell()
  const lens = lensById(activeLens)
  const showDevPage = import.meta.env.DEV && showPrimitives
  const Active = lens.Component

  return (
    <div className="moki-shell">
      <Sidebar />
      <main className={SHELL_CONTENT_CLASS} data-testid="shell-content">
        {showDevPage ? <PrimitivesPage /> : <Active />}
      </main>
      <Inspector />
    </div>
  )
}
