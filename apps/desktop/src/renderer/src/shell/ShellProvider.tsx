import { createProvider } from './createProvider'
import { useShellState } from './useShellState'

export const [ShellProvider, useShell] = createProvider(useShellState)
export type { ShellState } from './useShellState'
