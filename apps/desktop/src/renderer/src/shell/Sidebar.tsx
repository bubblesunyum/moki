import { Icon, IconButton, Text } from '../ui'
import { LensList } from './LensList'
import { useShell } from './ShellProvider'
import './Sidebar.css'

const SHOW_PRIMITIVES = import.meta.env.DEV

function SidebarToggle(): React.JSX.Element {
  const { sidebarOpen, toggleSidebar } = useShell()
  return (
    <IconButton
      icon="sidebar-left"
      label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
      iconSize={20}
      size="sm"
      onClick={toggleSidebar}
      aria-expanded={sidebarOpen}
      className="moki-shell-toggle moki-no-drag"
    />
  )
}

/* 153px sidebar on the backdrop (no surface of its own). Collapse keeps a
 * 32px icon rail; the toggle stays in place either way. Both states start
 * with an Electron drag strip tall enough to clear the traffic lights
 * (main process trafficLightPosition x20/y20) so no icon sits under them
 * and the window stays draggable. */
export function Sidebar(): React.JSX.Element {
  const { sidebarOpen, showPrimitives, togglePrimitives } = useShell()

  if (!sidebarOpen) {
    return (
      <aside className="moki-sidebar moki-sidebar--collapsed" aria-label="Sidebar">
        <div className="moki-rail-drag" aria-hidden="true" data-testid="sidebar-drag" />
        <LensList />
        <div className="moki-sidebar-bottom">
          <SidebarToggle />
        </div>
      </aside>
    )
  }

  return (
    <aside className="moki-sidebar" aria-label="Sidebar">
      <div className="moki-window-controls" data-testid="sidebar-drag">
        <span className="moki-traffic-gutter" aria-hidden="true" />
        <IconButton
          icon="chevron-left"
          label="Back"
          disabled
          aria-disabled="true"
          className="moki-no-drag"
        />
        <IconButton
          icon="chevron-right"
          label="Forward"
          disabled
          aria-disabled="true"
          className="moki-no-drag"
        />
      </div>
      <button type="button" className="moki-space-picker" aria-label="Space: Everything">
        <Icon name="infinity" size={16} />
        <Text variant="control" className="moki-space-picker-label">
          Everything
        </Text>
        <Icon name="chevron-down" size={20} />
      </button>
      <div className="moki-divider" aria-hidden="true" />
      <LensList />
      <div className="moki-divider" aria-hidden="true" />
      <div className="moki-tabs-placeholder">
        <button type="button" className="moki-new-tab">
          <Icon name="plus" size={16} />
          <Text variant="control">New tab</Text>
        </button>
      </div>
      {SHOW_PRIMITIVES ? (
        <button
          type="button"
          onClick={togglePrimitives}
          aria-current={showPrimitives ? 'page' : undefined}
          className={showPrimitives ? 'moki-lens-row selected-lit' : 'moki-lens-row'}
        >
          <Icon
            name="code"
            size={16}
            color={showPrimitives ? 'var(--moki-accent-cyan)' : undefined}
          />
          <Text
            variant={showPrimitives ? 'control-selected' : 'control'}
            className="moki-lens-label"
          >
            Primitives
          </Text>
        </button>
      ) : null}
      <div className="moki-sidebar-bottom">
        <SidebarToggle />
      </div>
    </aside>
  )
}
