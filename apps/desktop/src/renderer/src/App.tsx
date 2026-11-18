import { RpcProvider } from './rpc'
import { Shell } from './shell/Shell'
import { ShellProvider } from './shell/ShellProvider'

/* Production window: shell (sidebar + lens content + inspector) on the
 * backdrop. The Primitives showcase stays reachable in dev from the
 * sidebar entry and Cmd+Shift+P. */
export default function App(): React.JSX.Element {
  return (
    <RpcProvider>
      <ShellProvider>
        <Shell />
      </ShellProvider>
    </RpcProvider>
  )
}
