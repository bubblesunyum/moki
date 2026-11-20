import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { promises as fs, realpathSync } from 'node:fs'
import type { DayDownloadsEntry } from '../../../../../packages/protocol/src/index'

export const DOWNLOADS_LIMIT = 9

export function downloadsDir(home = homedir()): string {
  return join(home, 'Downloads')
}

/* Lexical containment (no I/O): the resolved path must be the dir itself
 * or a child of it. `resolve` never touches symlinks, so the open/reveal
 * gate below re-checks the real path — a symlink inside Downloads pointing
 * elsewhere stays denied. */
export function isInsideDownloads(targetPath: string, dir: string): boolean {
  const resolved = resolve(targetPath)
  const base = resolve(dir)
  return resolved === base || resolved.startsWith(base + sep)
}

/** Strict gate for open/reveal: the real (symlink-resolved) target must
 * live inside the real Downloads dir. Unresolvable paths are denied. */
export function isPathAllowed(targetPath: string, dir: string): boolean {
  try {
    const realTarget = realpathSync.native(targetPath)
    const realBase = realpathSync.native(dir)
    return realTarget === realBase || realTarget.startsWith(realBase + sep)
  } catch {
    return false
  }
}

export interface RawDownloadFile {
  name: string
  fullPath: string
  mtimeMs: number
  isDir: boolean
}

/* Pure shape step (tested): hide dotfiles unless asked, newest first, top 9. */
export function filterAndSortDownloads(
  files: RawDownloadFile[],
  showHidden: boolean,
  limit = DOWNLOADS_LIMIT
): DayDownloadsEntry[] {
  return files
    .filter((f) => showHidden || !f.name.startsWith('.'))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, limit)
    .map((f) => ({ name: f.name, fullPath: f.fullPath, mtimeMs: f.mtimeMs, isDir: f.isDir }))
}

export async function listDownloads(showHidden = false, dir = downloadsDir()): Promise<DayDownloadsEntry[]> {
  let names: string[]
  try {
    names = await fs.readdir(dir)
  } catch {
    return []
  }
  const stats = await Promise.all(
    names.map(async (name): Promise<RawDownloadFile | null> => {
      const fullPath = join(dir, name)
      try {
        const st = await fs.stat(fullPath)
        return { name, fullPath, mtimeMs: st.mtimeMs, isDir: st.isDirectory() }
      } catch {
        return null
      }
    })
  )
  const files = stats.filter((s): s is RawDownloadFile => s !== null)
  return filterAndSortDownloads(files, showHidden)
}
