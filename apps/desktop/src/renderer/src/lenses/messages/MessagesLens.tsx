import { GlassPane } from '../../ui'
import './MessagesLens.css'

/* Two empty panes (377px list + flexible thread); the next bead fills them. */
export function MessagesLens(): React.JSX.Element {
  return (
    <div className="moki-messages-lens">
      <GlassPane className="moki-messages-list" data-testid="messages-list-pane" />
      <GlassPane className="moki-messages-thread" data-testid="messages-thread-pane" />
    </div>
  )
}
