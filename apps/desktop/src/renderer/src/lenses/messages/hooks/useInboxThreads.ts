import { useMemo } from 'react'
import type { InfiniteData } from '@tanstack/react-query'
import type { MailListThreadsResult } from '../../../../../../../../packages/protocol/src/index'
import { useRpcInfiniteQuery } from '../../../rpc/hooks'

type MailPages = InfiniteData<MailListThreadsResult, Record<string, string> | undefined>

/* The bridge hook pins its TData to the single-page result while react-query
 * hands back the usual InfiniteData at runtime (rpc/hooks.ts, not owned
 * here). Cast once so the screens stay typed. */
function pagesOf(data: unknown): MailListThreadsResult[] {
  return (data as MailPages | undefined)?.pages ?? []
}

/* Merged Gmail INBOX newest-first. The cursor rides along as params.cursor
 * (result.next is the next cursor, absent when done); unreachable and
 * authExpired accounts accumulate across pages for the banner. Pages arrive
 * per account and can overlap at the boundary, so the visible list is a
 * stable merge-sort by date desc (de-duplicated by account+id) rather than a
 * raw concatenation. */
export function useInboxThreads(enabled = true) {
  const query = useRpcInfiniteQuery<'mail.listThreads', Record<string, string> | undefined>(
    'mail.listThreads',
    { label: 'INBOX' },
    (lastPage) => lastPage.next,
    undefined,
    { enabled }
  )
  const threads = useMemo(
    () => mergeThreadsNewestFirst(pagesOf(query.data).flatMap((page) => page.threads)),
    [query.data]
  )
  const bannerAccounts = useMemo(() => {
    const unreachable = new Set<string>()
    const authExpired = new Set<string>()
    for (const page of pagesOf(query.data)) {
      for (const account of page.unreachable) unreachable.add(account)
      for (const account of page.authExpired) authExpired.add(account)
    }
    return { unreachable: [...unreachable], authExpired: [...authExpired] }
  }, [query.data])
  return { ...query, threads, ...bannerAccounts }
}

/* Stable newest-first merge, de-duplicated by account+id: decorates with the
 * arrival index so equal dates keep page order, and keeps the first (newest)
 * copy of any duplicated row. Exported for tests. */
export function mergeThreadsNewestFirst(
  threads: MailListThreadsResult['threads']
): MailListThreadsResult['threads'] {
  const seen = new Set<string>()
  const unique: MailListThreadsResult['threads'] = []
  for (const thread of threads) {
    const key = `${thread.account}/${thread.id}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(thread)
  }
  return unique
    .map((thread, index) => ({ thread, index }))
    .sort((a, b) => {
      const dateDiff = Date.parse(b.thread.date) - Date.parse(a.thread.date)
      if (Number.isNaN(dateDiff)) return a.index - b.index
      if (dateDiff !== 0) return dateDiff
      return a.index - b.index
    })
    .map(({ thread }) => thread)
}
