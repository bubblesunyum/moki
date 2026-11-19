import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { AvatarPhoto } from '../../ui/Avatar'
import { useSenderPhoto } from './useSenderPhoto'

// Controllable `Image` stub: no real fetches — each test decides per-URL
// whether the load succeeds and at what decoded size.
interface LoadStep {
  ok: boolean
  width?: number
  height?: number
}

let handleLoad: (src: string) => LoadStep = () => ({ ok: false })
let createdImages = 0
let requestedSrcs: string[] = []

class FakeImage {
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  naturalWidth = 0
  naturalHeight = 0

  constructor() {
    createdImages += 1
  }

  set src(value: string) {
    requestedSrcs.push(value)
    const step = handleLoad(value)
    if (step.ok) {
      this.naturalWidth = step.width ?? 128
      this.naturalHeight = step.height ?? 128
    }
    queueMicrotask(() => {
      if (step.ok) this.onload?.()
      else this.onerror?.()
    })
  }
}

function installImageStub(): void {
  createdImages = 0
  requestedSrcs = []
  handleLoad = () => ({ ok: false })
  vi.stubGlobal('Image', FakeImage)
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function Harness({ address }: { address: string }): React.JSX.Element {
  // Pinned to the single shared type: the hook resolves AvatarPhoto directly.
  const photo: AvatarPhoto | null = useSenderPhoto(address)
  return (
    <div data-testid="photo">
      {photo === null ? 'none' : `${photo.kind}:${photo.src}`}
    </div>
  )
}

function photoOf(): { kind: string; src: string } | null {
  const text = screen.getByTestId('photo').textContent
  if (text === 'none' || text === null) return null
  const colon = text.indexOf(':')
  return { kind: text.slice(0, colon), src: text.slice(colon + 1) }
}

// Unique addresses per test: the hook's session cache/miss set is
// module-level, so each test gets a sender no other test has asked about.
describe('useSenderPhoto', () => {
  it('resolves the Gravatar portrait first', async () => {
    installImageStub()
    handleLoad = (src) => (src.includes('gravatar.com') ? { ok: true } : { ok: false })
    render(<Harness address="portrait-first-1@example.com" />)
    expect(screen.getByTestId('photo').textContent).toBe('none')

    await waitFor(() => expect(photoOf()).not.toBeNull())
    const found = photoOf()
    expect(found?.kind).toBe('portrait')
    expect(found?.src).toContain('https://gravatar.com/avatar/')
    // Portrait hit: the logo is never asked for.
    expect(requestedSrcs.some((src) => src.includes('favicons'))).toBe(false)
  })

  it('falls through to the brand logo when the portrait misses', async () => {
    installImageStub()
    handleLoad = (src) => (src.includes('favicons') ? { ok: true } : { ok: false })
    render(<Harness address="logo-fallback-1@substack.com" />)

    await waitFor(() => expect(photoOf()).not.toBeNull())
    const found = photoOf()
    expect(found?.kind).toBe('logo')
    expect(found?.src).toBe(
      'https://www.google.com/s2/favicons?domain=substack.com&sz=128'
    )
    expect(requestedSrcs).toHaveLength(2)
  })

  it('rejects undersized images and moves on', async () => {
    installImageStub()
    handleLoad = (src) =>
      src.includes('gravatar.com')
        ? { ok: true, width: 16, height: 16 } // placeholder globe
        : { ok: true, width: 64, height: 64 }
    render(<Harness address="tiny-globe-1@substack.com" />)

    await waitFor(() => expect(photoOf()).not.toBeNull())
    expect(photoOf()?.kind).toBe('logo')
  })

  it('returns null when every source misses, and never re-asks', async () => {
    installImageStub()
    const { rerender, unmount } = render(<Harness address="nobody-1@unknown-domain-xyz.test" />)
    await waitFor(() => expect(requestedSrcs.length).toBeGreaterThan(0))
    // Two candidates (portrait + logo): both probed, both fail.
    await waitFor(() => expect(requestedSrcs).toHaveLength(2))
    expect(screen.getByTestId('photo').textContent).toBe('none')

    const probes = requestedSrcs.length
    rerender(<Harness address="nobody-1@unknown-domain-xyz.test" />)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(requestedSrcs).toHaveLength(probes)

    // A fresh mount of the same failed address reads the miss set, not the net.
    unmount()
    render(<Harness address="nobody-1@unknown-domain-xyz.test" />)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(requestedSrcs).toHaveLength(probes)
    expect(createdImages).toBe(probes)
  })

  it('serves repeat mounts from the session cache without probing', async () => {
    installImageStub()
    handleLoad = (src) => (src.includes('gravatar.com') ? { ok: true } : { ok: false })
    const { unmount } = render(<Harness address="cached-1@example.com" />)
    await waitFor(() => expect(photoOf()).not.toBeNull())
    const probes = requestedSrcs.length
    expect(probes).toBe(1)

    unmount()
    render(<Harness address="cached-1@example.com" />)
    expect(screen.getByTestId('photo').textContent).not.toBe('none')
    expect(requestedSrcs).toHaveLength(probes)
  })

  it('returns null without probing for an empty address', async () => {
    installImageStub()
    render(<Harness address="   " />)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.getByTestId('photo').textContent).toBe('none')
    expect(requestedSrcs).toHaveLength(0)
  })

  it('shares one request across concurrent mounts of the same address', async () => {
    installImageStub()
    handleLoad = (src) => (src.includes('gravatar.com') ? { ok: true } : { ok: false })
    render(
      <>
        <Harness address="shared-1@example.com" />
        <Harness address="shared-1@example.com" />
      </>
    )
    await waitFor(() => {
      const photos = screen.getAllByTestId('photo')
      expect(photos.every((el) => el.textContent !== 'none')).toBe(true)
    })
    expect(requestedSrcs.filter((src) => src.includes('gravatar.com'))).toHaveLength(1)
  })
})
