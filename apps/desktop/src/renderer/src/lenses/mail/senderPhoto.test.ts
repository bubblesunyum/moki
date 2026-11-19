import { describe, expect, it } from 'vitest'
import type { AvatarPhoto } from '../../ui/Avatar'
import {
  brandDomain,
  FREEMAIL_DOMAINS,
  gravatarURL,
  logoURL,
  MIN_PHOTO_DIMENSION,
  normalizeSenderAddress,
  senderPhotoCandidates
} from './senderPhoto'

describe('normalizeSenderAddress', () => {
  it('trims and lowercases for cache keys and hashing', () => {
    expect(normalizeSenderAddress('  Clayton@Example.COM  ')).toBe('clayton@example.com')
  })
})

describe('gravatarURL', () => {
  it('hashes the trimmed-lowercased address with d=404 so misses stay misses', async () => {
    // SHA-256('clayton@example.com'), pinned so the algorithm can't drift.
    await expect(gravatarURL('clayton@example.com')).resolves.toBe(
      'https://gravatar.com/avatar/49c53fd9dc94f763a2e3fed0fbd363351e193c7978cf9793a84f675abec1fdf2?d=404&s=256'
    )
  })

  it('ignores case and surrounding whitespace', async () => {
    await expect(gravatarURL('  CLAYTON@Example.COM ')).resolves.toBe(
      await gravatarURL('clayton@example.com')
    )
  })
})

describe('logoURL', () => {
  it('builds the favicon-service URL for the domain', () => {
    expect(logoURL('substack.com')).toBe(
      'https://www.google.com/s2/favicons?domain=substack.com&sz=128'
    )
  })
})

describe('brandDomain', () => {
  it('returns the domain for brand addresses', () => {
    expect(brandDomain('news@substack.com')).toBe('substack.com')
    expect(brandDomain('News@Substack.COM')).toBe('substack.com')
  })

  it('returns null for freemail hosts', () => {
    for (const domain of FREEMAIL_DOMAINS) {
      expect(brandDomain(`someone@${domain}`)).toBeNull()
    }
    expect(brandDomain('Bo@Gmail.COM')).toBeNull()
  })

  it('returns null for malformed addresses', () => {
    expect(brandDomain('not-an-address')).toBeNull()
    expect(brandDomain('a@b@c.com')).toBeNull()
    expect(brandDomain('@example.com')).toBeNull()
    expect(brandDomain('someone@')).toBeNull()
    expect(brandDomain('')).toBeNull()
  })

  it('ports the psymail freemail set', () => {
    expect(FREEMAIL_DOMAINS.has('gmail.com')).toBe(true)
    expect(FREEMAIL_DOMAINS.has('protonmail.com')).toBe(true)
    expect(FREEMAIL_DOMAINS.has('fastmail.com')).toBe(true)
  })
})

describe('senderPhotoCandidates', () => {
  it('tries the portrait then the brand logo', async () => {
    // Pinned to the single shared type: candidates must satisfy AvatarPhoto.
    const candidates: AvatarPhoto[] = await senderPhotoCandidates('news@substack.com')
    expect(candidates).toHaveLength(2)
    expect(candidates[0].kind).toBe('portrait')
    expect(candidates[0].src).toContain('https://gravatar.com/avatar/')
    expect(candidates[1]).toEqual({ src: logoURL('substack.com'), kind: 'logo' })
  })

  it('skips the logo for freemail senders', async () => {
    const candidates = await senderPhotoCandidates('bo@gmail.com')
    expect(candidates).toHaveLength(1)
    expect(candidates[0].kind).toBe('portrait')
  })
})

describe('MIN_PHOTO_DIMENSION', () => {
  it('matches the worth-showing floor', () => {
    expect(MIN_PHOTO_DIMENSION).toBe(32)
  })
})
