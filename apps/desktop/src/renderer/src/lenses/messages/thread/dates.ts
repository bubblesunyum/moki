import { formatRelativeTime } from '../formatRelativeTime'

/* Thin alias kept for the thread card imports: the inbox formatter in
 * ../formatRelativeTime.ts is the single relative-time capability (calendar
 * days, future dates pinned to absolute dates). */
export function formatMessageDate(iso: string, now: number = Date.now()): string {
  return formatRelativeTime(iso, now)
}
