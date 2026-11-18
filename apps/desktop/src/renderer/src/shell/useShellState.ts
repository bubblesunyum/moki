import { useCallback, useEffect, useState } from 'react'
import { DEFAULT_LENS_ID, type LensId } from '../lenses/registry'

const SIDEBAR_KEY = 'moki.shell.sidebarOpen'
const INSPECTOR_KEY = 'moki.shell.inspectorOpen'

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback
    return raw === 'true'
  } catch {
    return fallback
  }
}

function writeFlag(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, String(value))
  } catch {
    /* Private-mode storage: keep the in-memory state, skip persistence. */
  }
}

export interface ShellState {
  activeLens: LensId
  selectLens: (id: LensId) => void
  showPrimitives: boolean
  togglePrimitives: () => void
  sidebarOpen: boolean
  inspectorOpen: boolean
  toggleSidebar: () => void
  toggleInspector: () => void
}

/* Sidebar/inspector visibility (persisted) + active lens routing (session).
 * Dev-only: Cmd+Shift+P toggles the Primitives showcase. */
export function useShellState(): ShellState {
  const [activeLens, setActiveLens] = useState<LensId>(DEFAULT_LENS_ID)
  const [showPrimitives, setShowPrimitives] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(() => readFlag(SIDEBAR_KEY, true))
  const [inspectorOpen, setInspectorOpen] = useState(() => readFlag(INSPECTOR_KEY, true))

  const selectLens = useCallback((id: LensId) => {
    setActiveLens(id)
    setShowPrimitives(false)
  }, [])

  const togglePrimitives = useCallback(() => {
    setShowPrimitives((prev) => !prev)
  }, [])

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => {
      writeFlag(SIDEBAR_KEY, !prev)
      return !prev
    })
  }, [])

  const toggleInspector = useCallback(() => {
    setInspectorOpen((prev) => {
      writeFlag(INSPECTOR_KEY, !prev)
      return !prev
    })
  }, [])

  useEffect(() => {
    if (!import.meta.env.DEV) return
    function onKeyDown(e: KeyboardEvent): void {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        setShowPrimitives((prev) => !prev)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return {
    activeLens,
    selectLens,
    showPrimitives,
    togglePrimitives,
    sidebarOpen,
    inspectorOpen,
    toggleSidebar,
    toggleInspector
  }
}
