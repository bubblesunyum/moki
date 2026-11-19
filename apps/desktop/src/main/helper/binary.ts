import { join } from 'node:path'

export const HELPER_BINARY_NAME = 'moki-helper'
export const HELPER_RESOURCE_DIR = 'moki-helper'

/**
 * Resolve the helper binary in dev: `<repo>/helper/.build/debug/moki-helper`,
 * located from Electron's app path (`<repo>/apps/desktop` under `electron-vite dev`).
 */
export function repoRootFromAppPath(appPath: string): string {
  return join(appPath, '..', '..')
}

export function helperBinaryFromRepoRoot(repoRoot: string): string {
  return join(repoRoot, 'helper', '.build', 'debug', HELPER_BINARY_NAME)
}

/**
 * Resolve the helper binary when packaged: `<resources>/moki-helper/moki-helper`,
 * where `<resources>` is `process.resourcesPath` inside the app bundle.
 * electron-builder ships the release binary there via `extraResources`
 * (see `electron-builder.yml`).
 */
export function helperBinaryFromResourcesPath(resourcesPath: string): string {
  return join(resourcesPath, HELPER_RESOURCE_DIR, HELPER_BINARY_NAME)
}

export interface HelperBinaryEnv {
  /** `app.isPackaged` at the call site. */
  isPackaged: boolean
  /** `process.resourcesPath` at the call site. */
  resourcesPath?: string
}

/**
 * Return the bundled binary when packaged, otherwise the dev path.
 * Packaged mode without a resources path falls back to dev so we never
 * resolve to a bare directory or throw at startup.
 */
export function resolveHelperBinary(appPath: string, env?: HelperBinaryEnv): string {
  if (env?.isPackaged && env.resourcesPath) {
    return helperBinaryFromResourcesPath(env.resourcesPath)
  }
  return helperBinaryFromRepoRoot(repoRootFromAppPath(appPath))
}
