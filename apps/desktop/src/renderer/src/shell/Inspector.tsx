import { Icon, IconButton, Text } from '../ui'
import { HelperStatus } from '../rpc'
import { useShell } from './ShellProvider'
import './Inspector.css'

const SHOW_STATUS = import.meta.env.DEV

/* 280px inspector on the backdrop (no surface of its own). Collapse keeps
 * a 32px rail; the toggle stays in place either way. */
export function Inspector(): React.JSX.Element {
  const { inspectorOpen, toggleInspector } = useShell()

  if (!inspectorOpen) {
    return (
      <aside className="moki-inspector moki-inspector--collapsed" aria-label="Inspector">
        <div className="moki-inspector-footer">
          <IconButton
            icon="sidebar-right"
            label="Expand inspector"
            iconSize={20}
            size="sm"
            onClick={toggleInspector}
            aria-expanded={false}
            className="moki-shell-toggle moki-no-drag"
          />
        </div>
      </aside>
    )
  }

  return (
    <aside className="moki-inspector" aria-label="Inspector">
      <div className="moki-ask-moki">
        <input
          className="moki-ask-moki-input"
          placeholder="Ask Moki"
          aria-label="Ask Moki"
          readOnly
        />
        <Icon name="mic" size={16} />
      </div>
      <div className="moki-inspector-body" />
      <div className="moki-inspector-footer">
        {SHOW_STATUS ? (
          <Text variant="small" as="div" className="moki-inspector-status">
            <HelperStatus />
          </Text>
        ) : null}
        <IconButton
          icon="sidebar-right"
          label="Collapse inspector"
          iconSize={20}
          size="sm"
          onClick={toggleInspector}
          aria-expanded={true}
          className="moki-shell-toggle moki-no-drag"
        />
      </div>
    </aside>
  )
}
