// Sender-photo URL resolvers (renderer-only port of psymail's
// `SenderPhotos`, used here as a read-only reference).
//
// Gmail shows a Google profile photo for a person and a brand logo for a
// company. The profile photos aren't reachable from any scope Moki holds, so
// — like psymail — this asks the two public sources that answer for an
// arbitrary address: Gravatar for the person, a favicon-derived logo for the
// domain. A miss degrades to the monogram `Avatar` already draws.
//
// Privacy tradeoff (same one psymail documents on `Config.usesGravatarPhotos`,
// default-on for parity): fetching either URL discloses the viewed sender — a
// SHA-256 of the address to Gravatar, the bare domain to Google — so who you
// correspond with is shared with those services as you scroll. Turning this
// off (never calling the hook) keeps correspondents between you and Gmail, at
// the cost of monograms for everyone without a company domain.
//
// People-API portraits are deferred: they need an authed helper endpoint, and
// the helper never exposes credentials to the renderer. When that lands it
// becomes the first candidate, ahead of Gravatar.

import type { AvatarPhoto } from '../../ui/Avatar'

/* A 200 is not proof of a photo: Google answers an unknown domain with a 404
 * whose body is still a 16pt globe, and loaders that only look at bytes will
 * happily draw it. So every probe must additionally clear this floor on both
 * dimensions (mirrors `SenderPhotos.isWorthShowing`). */
export const MIN_PHOTO_DIMENSION = 32

/* Personal-mail domains: never ask for a logo — a personal host stands for
 * its millions of users, not for the sender. Ported from
 * `SenderPhotos.freemail`; show a monogram instead. */
export const FREEMAIL_DOMAINS: ReadonlySet<string> = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'yahoo.com',
  'ymail.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'pm.me',
  'gmx.com',
  'zoho.com',
  'fastmail.com'
])

/** Canonical key for cache lookups and hashing: trimmed and lowercased. */
export function normalizeSenderAddress(address: string): string {
  return address.trim().toLowerCase()
}

/* The sender's domain when a logo for it would mean anything — null for
 * personal-mail hosts and for malformed addresses. */
export function brandDomain(address: string): string | null {
  const parts = normalizeSenderAddress(address).split('@')
  if (parts.length !== 2 || parts[0] === '' || parts[1] === '') return null
  const domain = parts[1]
  return FREEMAIL_DOMAINS.has(domain) ? null : domain
}

/* The brand's logo by way of Google's favicon service: keyless, 404s cleanly
 * for a domain it doesn't know. Asks for the largest icon the site publishes
 * (`sz=128`); the size varies (32–128pt), so probes still check the floor. */
export function logoURL(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`
}

/* The sender's own photo, if they keep one at Gravatar — the only public
 * source for a person rather than a company. Keyed by a SHA-256 of the
 * trimmed, lowercased address; `d=404` is what makes a miss a miss instead of
 * a generated placeholder. */
export async function gravatarURL(address: string): Promise<string> {
  const bytes = new TextEncoder().encode(normalizeSenderAddress(address))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join(
    ''
  )
  return `https://gravatar.com/avatar/${hash}?d=404&s=256`
}

/* Ordered candidate sources for an address: the sender's own portrait first,
 * then their brand's logo (absent for freemail senders). The hook probes them
 * in order and takes the first worth showing. */
export async function senderPhotoCandidates(address: string): Promise<AvatarPhoto[]> {
  const candidates: AvatarPhoto[] = [{ src: await gravatarURL(address), kind: 'portrait' }]
  const domain = brandDomain(address)
  if (domain !== null) candidates.push({ src: logoURL(domain), kind: 'logo' })
  return candidates
}
