import { describe, expect, it, vi } from 'vitest'
import {
  capClipboard,
  ClipboardWatcher,
  dedupeClipboard,
  makeClipboardEntry,
  truncateClipboardText,
  CLIPBOARD_TEXT_MAX
} from './clipboard'

describe('dedupeClipboard', () => {
  it('keeps the first occurrence of each text', () => {
    const entries = [
      { id: 'a', text: 'hello', copiedAt: 1 },
      { id: 'b', text: 'world', copiedAt: 2 },
      { id: 'c', text: 'hello', copiedAt: 3 }
    ]
    expect(dedupeClipboard(entries).map((e) => e.id)).toEqual(['a', 'b'])
  })

  it('drops empty and malformed rows', () => {
    const entries = [
      { id: 'a', text: '', copiedAt: 1 },
      { id: 'b', text: 'ok', copiedAt: 2 }
    ]
    expect(dedupeClipboard(entries)).toHaveLength(1)
  })
})

describe('capClipboard', () => {
  it('keeps the newest-first head at 100 by default', () => {
    const entries = Array.from({ length: 150 }, (_, i) => makeClipboardEntry(`t${i}`, i))
    expect(capClipboard(entries)).toHaveLength(100)
    expect(capClipboard(entries)[0]?.text).toBe('t0')
  })
})

describe('ClipboardWatcher', () => {
  it('notifies once per new text and skips repeats and blanks', () => {
    const onNew = vi.fn()
    const saved: unknown[] = []
    let current = '  first  '
    const watcher = new ClipboardWatcher({
      readText: () => current,
      load: () => [],
      save: (entries) => void saved.push(entries),
      onNew,
      now: () => 1000
    })
    const first = watcher.poll()
    expect(first?.text).toBe('first')
    expect(onNew).toHaveBeenCalledTimes(1)
    expect(watcher.list()).toHaveLength(1)
    // Same text again: no notify.
    expect(watcher.poll()).toBeNull()
    expect(onNew).toHaveBeenCalledTimes(1)
    // Blank: skipped.
    current = '   '
    expect(watcher.poll()).toBeNull()
    expect(onNew).toHaveBeenCalledTimes(1)
    // New text prepends.
    current = 'second'
    watcher.poll()
    expect(watcher.list().map((e) => e.text)).toEqual(['second', 'first'])
  })

  it('clear sticks until genuinely new text arrives', () => {
    const onNew = vi.fn()
    let current = 'a'
    const watcher = new ClipboardWatcher({
      readText: () => current,
      load: () => [{ id: 'x', text: 'a', copiedAt: 1 }],
      save: () => undefined,
      onNew,
      now: () => 7
    })
    watcher.clear()
    expect(watcher.list()).toHaveLength(0)
    // The text still on the OS clipboard does not resurrect…
    expect(watcher.poll()).toBeNull()
    expect(watcher.list()).toHaveLength(0)
    // …but genuinely new text still arrives.
    current = 'b'
    expect(watcher.poll()).not.toBeNull()
    expect(watcher.list().map((e) => e.text)).toEqual(['b'])
  })

  it('truncates over-long entries with their full length', () => {
    const long = 'x'.repeat(CLIPBOARD_TEXT_MAX + 7)
    expect(truncateClipboardText('short')).toBe('short')
    expect(truncateClipboardText(long)).toBe(`${'x'.repeat(CLIPBOARD_TEXT_MAX)}… (${long.length} chars)`)
  })
})
