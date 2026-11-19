import { createElement, type ComponentType } from 'react'
import type { FigmaIconName } from '../ui'
import { CommerceLens } from './commerce/CommerceLens'
import { FeedLens } from './feed/FeedLens'
import { MessagesLens } from './messages/MessagesLens'
import { NotificationsLens } from './notifications/NotificationsLens'
import { PlaceholderLens } from './PlaceholderLens'

export type LensId =
  | 'day'
  | 'messages'
  | 'docs'
  | 'tasks'
  | 'calendar'
  | 'feed'
  | 'notifications'
  | 'commerce'
  | 'library'
  | 'files'
  | 'places'
  | 'people'
  | 'code'

export interface LensDef {
  id: LensId
  title: string
  icon: FigmaIconName
  Component: ComponentType
}

/* Every other lens is a placeholder until its bead lands. */
function placeholderLens(title: string): ComponentType {
  function Placeholder(): React.JSX.Element {
    return createElement(PlaceholderLens, { title })
  }
  Placeholder.displayName = `${title}Lens`
  return Placeholder
}

const MESSAGES: LensDef = {
  id: 'messages',
  title: 'Messages',
  icon: 'messages',
  Component: MessagesLens
}

/* Spec order from the brief (§3 lens table). */
export const LENSES: LensDef[] = [
  { id: 'day', title: 'Day', icon: 'today', Component: placeholderLens('Day') },
  MESSAGES,
  { id: 'docs', title: 'Docs', icon: 'notes', Component: placeholderLens('Docs') },
  { id: 'tasks', title: 'Tasks', icon: 'tasks', Component: placeholderLens('Tasks') },
  { id: 'calendar', title: 'Calendar', icon: 'calendar', Component: placeholderLens('Calendar') },
  { id: 'feed', title: 'Feed', icon: 'globe', Component: FeedLens },
  {
    id: 'notifications',
    title: 'Notifications',
    icon: 'notifications',
    Component: NotificationsLens
  },
  { id: 'commerce', title: 'Commerce', icon: 'commerce', Component: CommerceLens },
  { id: 'library', title: 'Library', icon: 'bookmarks', Component: placeholderLens('Library') },
  { id: 'files', title: 'Files', icon: 'files', Component: placeholderLens('Files') },
  { id: 'places', title: 'Places', icon: 'map-pin', Component: placeholderLens('Places') },
  { id: 'people', title: 'People', icon: 'people', Component: placeholderLens('People') },
  { id: 'code', title: 'Code', icon: 'code', Component: placeholderLens('Code') }
]

export const DEFAULT_LENS_ID: LensId = 'messages'

export function lensById(id: LensId): LensDef {
  return LENSES.find((lens) => lens.id === id) ?? MESSAGES
}
