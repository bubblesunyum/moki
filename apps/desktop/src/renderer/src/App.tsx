import { PrimitivesPage } from './dev/Primitives'

export default function App(): React.JSX.Element | null {
  // The shell (app shell bead) owns the production window. Until then, dev
  // gets the primitives showcase full-window on the backdrop.
  if (!import.meta.env.DEV) {
    return null
  }
  return <PrimitivesPage />
}
