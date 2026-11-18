import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
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
})
