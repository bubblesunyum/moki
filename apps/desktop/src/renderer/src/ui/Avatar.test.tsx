import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  Avatar,
  AVATAR_PALETTE_SIZE,
  avatarGradient,
  avatarInitials,
  avatarPaletteIndex
} from './Avatar'

afterEach(() => {
  cleanup()
})

describe('avatarInitials', () => {
  it('uses first and last initials for multi-word names', () => {
    expect(avatarInitials('Ada Lovelace')).toBe('AL')
    expect(avatarInitials('Brooke')).toBe('BR')
    expect(avatarInitials('Mary Kate Olsen')).toBe('MO')
  })

  it('uppercases and trims', () => {
    expect(avatarInitials('  noor  ')).toBe('NO')
    expect(avatarInitials('a')).toBe('A')
  })

  it('falls back for empty names', () => {
    expect(avatarInitials('')).toBe('?')
    expect(avatarInitials('   ')).toBe('?')
  })

  it('keeps emoji graphemes intact instead of splitting surrogates', () => {
    expect(avatarInitials('🧑‍💻 Lee')).toBe('🧑‍💻L')
    expect(avatarInitials('🧑‍💻')).toBe('🧑‍💻')
  })
})

describe('avatarPaletteIndex', () => {
  it('is deterministic for the same name', () => {
    expect(avatarPaletteIndex('Brooke')).toBe(avatarPaletteIndex('Brooke'))
  })

  it('stays inside the palette', () => {
    for (const name of ['Brooke', 'Mom', 'Aish', 'Noor', 'Kate', 'QWELL', 'Ada Lovelace']) {
      const i = avatarPaletteIndex(name)
      expect(Number.isInteger(i)).toBe(true)
      expect(i).toBeGreaterThanOrEqual(0)
      expect(i).toBeLessThan(AVATAR_PALETTE_SIZE)
    }
  })

  it('matches the 17-pair palette from the brief', () => {
    expect(AVATAR_PALETTE_SIZE).toBe(17)
  })
})

describe('Avatar', () => {
  it('gives the same gradient for the same name', () => {
    const a = avatarGradient('Brooke')
    const b = avatarGradient('Brooke')
    expect(a).toBe(b)
    expect(a).toMatch(/^linear-gradient\(135deg, var\(--moki-avatar-\d+-a\) 14%, var\(--moki-avatar-\d+-b\) 86%\)$/)

    render(
      <>
        <Avatar name="Brooke" data-testid="a1" />
        <Avatar name="Brooke" data-testid="a2" />
        <Avatar name="Mom" data-testid="b" />
      </>
    )
    const first = screen.getByTestId('a1')
    const second = screen.getByTestId('a2')
    const other = screen.getByTestId('b')
    expect(first.style.background).toBe(second.style.background)
    expect(first.style.background).toBe(a)
    expect(other.style.background).toBe(avatarGradient('Mom'))
  })

  it('renders initials and exposes the name to assistive tech', () => {
    render(<Avatar name="Ada Lovelace" />)
    expect(screen.getByText('AL')).toBeDefined()
    expect(screen.getByRole('img', { name: 'Ada Lovelace' })).toBeDefined()
  })

  it('renders the optional badge slot', () => {
    render(<Avatar name="Brooke" badge={<span data-testid="badge" />} />)
    expect(screen.getByTestId('badge')).toBeDefined()
  })

  it('renders the indicator slot only when provided', () => {
    const { container, rerender } = render(<Avatar name="Brooke" />)
    expect(container.querySelector('.moki-avatar-indicator')).toBeNull()

    rerender(
      <Avatar
        name="Brooke"
        indicator={<span className="moki-avatar-indicator" aria-hidden="true" />}
      />
    )
    const dot = container.querySelector('.moki-avatar-indicator')
    expect(dot).not.toBeNull()
    expect(dot?.getAttribute('aria-hidden')).toBe('true')
  })
})

describe('Avatar photo', () => {
  it('renders no image by default — monogram only', () => {
    const { container } = render(<Avatar name="Ada Lovelace" />)
    expect(container.querySelector('img.moki-avatar-photo')).toBeNull()
    expect(screen.getByText('AL')).toBeDefined()
  })

  it('treats a null photo as absent — monogram only', () => {
    const { container } = render(<Avatar name="Ada Lovelace" photo={null} />)
    expect(container.querySelector('img.moki-avatar-photo')).toBeNull()
    expect(screen.getByText('AL')).toBeDefined()
  })

  it('cover-fills a portrait and cross-fades it in over the monogram', () => {
    const { container } = render(
      <Avatar name="Ada Lovelace" photo={{ src: 'https://example.com/ada.jpg', kind: 'portrait' }} />
    )
    const img = container.querySelector('img.moki-avatar-photo')
    expect(img?.getAttribute('src')).toBe('https://example.com/ada.jpg')
    expect(img?.classList.contains('moki-avatar-photo--portrait')).toBe(true)
    // Starts transparent over the monogram; the load flips the fade on.
    expect(img?.classList.contains('is-loaded')).toBe(false)
    expect(img?.getAttribute('aria-hidden')).toBe('true')
    expect(screen.getByText('AL')).toBeDefined()

    fireEvent.load(img!)
    expect(img?.classList.contains('is-loaded')).toBe(true)
    expect(screen.getByText('AL')).toBeDefined()
  })

  it('contains a logo on a light card instead of cover-filling', () => {
    const { container } = render(
      <Avatar name="Substack" photo={{ src: 'https://example.com/logo.png', kind: 'logo' }} />
    )
    const img = container.querySelector('img.moki-avatar-photo')
    expect(img?.classList.contains('moki-avatar-photo--logo')).toBe(true)
    expect(img?.classList.contains('moki-avatar-photo--portrait')).toBe(false)
  })

  it('hides back to the monogram when the photo errors', () => {
    const { container } = render(
      <Avatar name="Ada Lovelace" photo={{ src: 'https://example.com/gone.jpg', kind: 'portrait' }} />
    )
    const img = container.querySelector('img.moki-avatar-photo')
    expect(img).not.toBeNull()

    fireEvent.error(img!)
    expect(container.querySelector('img.moki-avatar-photo')).toBeNull()
    // Monogram, badge slot and accessible name are untouched by the failure.
    expect(screen.getByText('AL')).toBeDefined()
    expect(screen.getByRole('img', { name: 'Ada Lovelace' })).toBeDefined()
  })

  it('shows a new src after an earlier one failed', () => {
    const { container, rerender } = render(
      <Avatar name="Ada Lovelace" photo={{ src: 'https://example.com/gone.jpg', kind: 'portrait' }} />
    )
    fireEvent.error(container.querySelector('img.moki-avatar-photo')!)
    expect(container.querySelector('img.moki-avatar-photo')).toBeNull()

    rerender(
      <Avatar name="Ada Lovelace" photo={{ src: 'https://example.com/back.jpg', kind: 'portrait' }} />
    )
    expect(
      container.querySelector('img.moki-avatar-photo')?.getAttribute('src')
    ).toBe('https://example.com/back.jpg')
  })
})
