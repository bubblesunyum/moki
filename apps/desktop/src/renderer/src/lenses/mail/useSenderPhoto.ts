import { useEffect, useState } from 'react'
import type { AvatarPhoto } from '../../ui/Avatar'
import {
  MIN_PHOTO_DIMENSION,
  normalizeSenderAddress,
  senderPhotoCandidates
} from './senderPhoto'

/* Session caches, mirroring `SenderPhotos`: a hit is never re-probed, and a
 * sender that came back empty is remembered — a 404 isn't cacheable, so
 * scrolling past the same unknown sender must not re-ask the network. The
 * in-flight map shares one request across the dozen rows showing the same
 * address. Cleared only by a reload. */
const photos = new Map<string, AvatarPhoto>()
const misses = new Set<string>()
const inFlight = new Map<string, Promise<AvatarPhoto | null>>()

/* Probe one candidate URL with an `Image` load (offline in tests via a stub):
 * true only when the bytes decode to something worth showing — both dimensions
 * clear the floor, rejecting placeholder globes and tracking pixels. */
function probe(src: string): Promise<boolean> {
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => {
      resolve(
        image.naturalWidth >= MIN_PHOTO_DIMENSION &&
          image.naturalHeight >= MIN_PHOTO_DIMENSION
      )
    }
    image.onerror = () => resolve(false)
    image.src = src
  })
}

async function resolvePhoto(address: string): Promise<AvatarPhoto | null> {
  const key = normalizeSenderAddress(address)
  if (key === '') return null
  const cached = photos.get(key)
  if (cached !== undefined) return cached
  if (misses.has(key)) return null
  const pending = inFlight.get(key)
  if (pending !== undefined) return pending
  const task = (async (): Promise<AvatarPhoto | null> => {
    for (const candidate of await senderPhotoCandidates(key)) {
      if (await probe(candidate.src)) {
        photos.set(key, candidate)
        return candidate
      }
    }
    misses.add(key)
    return null
  })()
  inFlight.set(key, task)
  try {
    return await task
  } finally {
    inFlight.delete(key)
  }
}

/* The sender's photo for an address, or null while probing / when no source
 * has one (callers keep the monogram). Default-on, matching psymail's
 * `usesGravatarPhotos`: see `senderPhoto.ts` for the privacy tradeoff this
 * opts into (the probe fetches disclose viewed senders). */
export function useSenderPhoto(address: string): AvatarPhoto | null {
  const [photo, setPhoto] = useState<AvatarPhoto | null>(
    () => photos.get(normalizeSenderAddress(address)) ?? null
  )

  useEffect(() => {
    const key = normalizeSenderAddress(address)
    // Synchronous fast path: cache hits (and known misses) settle without a
    // probe, so scrolling back over seen senders never touches the network.
    setPhoto(photos.get(key) ?? null)
    if (key === '' || photos.has(key) || misses.has(key)) return
    let live = true
    void resolvePhoto(key).then((found) => {
      if (live) setPhoto(found)
    })
    return () => {
      live = false
    }
  }, [address])

  return photo
}
