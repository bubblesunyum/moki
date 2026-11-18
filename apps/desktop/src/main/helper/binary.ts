import { join } from 'node:path'

/**
 * Resolve the helper binary in dev: `<repo>/helper/.build/debug/moki-helper`,
 * located from Electron's app path (`<repo>/apps/desktop` under `electron-vite dev`).
 * Prod packaging comes later; callers fall back to this path for now.
 */
export function repoRootFromAppPath(appPath: string): string {
  return join(appPath, '..', '..')
}

export function helperBinaryFromRepoRoot(repoRoot: string): string {
  return join(repoRoot, 'helper', '.build', 'debug', 'moki-helper')
}

export function resolveHelperBinary(appPath: string): string {
  return helperBinaryFromRepoRoot(repoRootFromAppPath(appPath))
}
