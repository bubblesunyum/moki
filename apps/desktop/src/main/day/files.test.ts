import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  filterAndSortDownloads,
  isInsideDownloads,
  isPathAllowed
} from './files'

describe('filterAndSortDownloads', () => {
  it('hides dotfiles, sorts newest first, and caps at nine', () => {
    const files = [
      { name: '.hidden', fullPath: '/d/.hidden', mtimeMs: 99, isDir: false },
      ...Array.from({ length: 12 }, (_, i) => ({
        name: `f${i}`,
        fullPath: `/d/f${i}`,
        mtimeMs: i,
        isDir: false
      }))
    ]
    const hidden = filterAndSortDownloads(files, false)
    expect(hidden).toHaveLength(9)
    expect(hidden[0]?.name).toBe('f11')
    expect(hidden.some((f) => f.name.startsWith('.'))).toBe(false)
    const shown = filterAndSortDownloads(files, true)
    expect(shown.some((f) => f.name === '.hidden')).toBe(true)
  })
})

describe('isInsideDownloads / isPathAllowed', () => {
  const dir = join('/Users', 'tester', 'Downloads')

  it('accepts the dir itself and children, rejects escapes', () => {
    expect(isInsideDownloads(dir, dir)).toBe(true)
    expect(isInsideDownloads(join(dir, 'a.pdf'), dir)).toBe(true)
    expect(isInsideDownloads(join(dir, '..', 'Documents', 'x'), dir)).toBe(false)
    expect(isInsideDownloads('/etc/passwd', dir)).toBe(false)
  })

describe('isPathAllowed', () => {
  it('allows the real dir and children, denies escapes and missing paths', () => {
    const dir = mkdtempSync(join(tmpdir(), 'moki-dl-'))
    const inside = join(dir, 'a.pdf')
    writeFileSync(inside, 'x')
    expect(isPathAllowed(dir, dir)).toBe(true)
    expect(isPathAllowed(inside, dir)).toBe(true)
    expect(isPathAllowed('/etc/passwd', dir)).toBe(false)
    expect(isPathAllowed(join(dir, 'missing.pdf'), dir)).toBe(false)
  })

  it('denies a symlink inside that resolves outside', () => {
    const dir = mkdtempSync(join(tmpdir(), 'moki-dl-'))
    const outside = mkdtempSync(join(tmpdir(), 'moki-out-'))
    const secret = join(outside, 'secret.txt')
    writeFileSync(secret, 'x')
    const link = join(dir, 'evil.pdf')
    try {
      symlinkSync(secret, link)
    } catch {
      return
    }
    expect(isInsideDownloads(link, dir)).toBe(true)
    expect(isPathAllowed(link, dir)).toBe(false)
  })
})
})
