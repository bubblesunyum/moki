import { Icon, IconButton, Text } from '../ui'
import { LENSES } from '../lenses/registry'
import { useShell } from './ShellProvider'

/* Built-in lens list. Expanded rows hug their content when selected;
 * the collapsed rail is icon-only (the sidebar decides via sidebarOpen). */
export function LensList(): React.JSX.Element {
  const { activeLens, selectLens, showPrimitives, sidebarOpen } = useShell()

  if (!sidebarOpen) {
    return (
      <nav className="moki-lens-rail" aria-label="Lenses">
        {LENSES.map((lens) => (
          <IconButton
            key={lens.id}
            icon={lens.icon}
            label={lens.title}
            iconSize={16}
            size="sm"
            onClick={() => selectLens(lens.id)}
            aria-current={lens.id === activeLens && !showPrimitives ? 'page' : undefined}
            className={
              lens.id === activeLens && !showPrimitives ? 'moki-lens-rail-active' : undefined
            }
          />
        ))}
      </nav>
    )
  }

  return (
    <nav className="moki-lens-list" aria-label="Lenses">
      {LENSES.map((lens) => {
        const selected = lens.id === activeLens && !showPrimitives
        return (
          <button
            key={lens.id}
            type="button"
            onClick={() => selectLens(lens.id)}
            aria-current={selected ? 'page' : undefined}
            className={selected ? 'moki-lens-row selected-lit' : 'moki-lens-row'}
          >
            <Icon
              name={lens.icon}
              size={16}
              color={selected ? 'var(--moki-accent-cyan)' : undefined}
            />
            <Text
              variant={selected ? 'control-selected' : 'control'}
              className="moki-lens-label"
            >
              {lens.title}
            </Text>
          </button>
        )
      })}
    </nav>
  )
}
