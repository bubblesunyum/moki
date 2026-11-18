import { Text } from '../ui'
import './PlaceholderLens.css'

/* Shared placeholder for lenses whose bead hasn't landed yet. */
export function PlaceholderLens({ title }: { title: string }): React.JSX.Element {
  return (
    <div className="moki-placeholder-lens" role="status">
      <Text variant="control">{`${title} is coming`}</Text>
    </div>
  )
}
