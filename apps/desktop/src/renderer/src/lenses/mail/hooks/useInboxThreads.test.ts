import { describe, expect, it } from 'vitest'
import type { ThreadSummary } from '../../../../../../../../packages/protocol/src/index'
import { mergeThreadsNewestFirst } from './useInboxThreads'

function thread(id: string, account: string, isoDate: string): ThreadSummary {
  return {
    id,
    account,
    from: { name: `Sender ${id}`, address: `${id}@example.com` },
    subject: `Subject ${id}`,
    snippet: `Snippet ${id}`,
    date: isoDate,
    unread: false,
    messageCount: 1,
    labelIds: ['INBOX']
  }
}

describe('mergeThreadsNewestFirst', () => {
  it('stays newest-first across concatenated pages', () => {
    const page1 = [
      thread('t1', 'a@example.com', '2026-11-18T10:00:00.000Z'),
      thread('t2', 'a@example.com', '2026-11-18T08:00:00.000Z')
    ]
    // Second page arrives newer than the first (per-account cursors overlap).
    const page2 = [
      thread('t3', 'b@example.com', '2026-11-18T11:00:00.000Z'),
      thread('t4', 'b@example.com', '2026-11-18T07:00:00.000Z')
    ]
    const merged = mergeThreadsNewestFirst([...page1, ...page2])
    expect(merged.map((t) => t.id)).toEqual(['t3', 't1', 't2', 't4'])
  })

  it('de-duplicates by account+id, keeping the newest copy', () => {
    const merged = mergeThreadsNewestFirst([
      thread('t1', 'a@example.com', '2026-11-18T10:00:00.000Z'),
      thread('t1', 'a@example.com', '2026-11-18T10:00:00.000Z'),
      // Same id on another account is a different thread.
      thread('t1', 'b@example.com', '2026-11-18T10:00:00.000Z')
    ])
    expect(merged.map((t) => `${t.account}/${t.id}`)).toEqual([
      'a@example.com/t1',
      'b@example.com/t1'
    ])
  })

  it('is stable for equal dates, keeping page order', () => {
    const merged = mergeThreadsNewestFirst([
      thread('t1', 'a@example.com', '2026-11-18T10:00:00.000Z'),
      thread('t2', 'b@example.com', '2026-11-18T10:00:00.000Z')
    ])
    expect(merged.map((t) => t.id)).toEqual(['t1', 't2'])
  })
})
