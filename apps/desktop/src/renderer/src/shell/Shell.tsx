import { lensById } from '../lenses/registry'
import { PrimitivesPage } from '../dev/Primitives'
import { Inspector } from './Inspector'
import { Sidebar } from './Sidebar'
import { useShell } from './ShellProvider'
import './Shell.css'

/* Window grid: sidebar | content | inspector with 12px outer padding and
 * 12px gutters. Columns fill the viewport height minus padding. */
export function Shell(): React.JSX.Element {
  const { activeLens, showPrimitives } = useShell()
  const lens = lensById(activeLens)
  const showDevPage = import.meta.env.DEV && showPrimitives
  const Active = lens.Component

  return (
    <div className="moki-shell">
      <Sidebar />
      <main className="moki-shell-content" data-testid="shell-content">
        {showDevPage ? <PrimitivesPage /> : <Active />}
      </main>
      <Inspector />
    </div>
  )
}
