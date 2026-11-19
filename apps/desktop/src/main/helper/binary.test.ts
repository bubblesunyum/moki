import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { helperBinaryFromResourcesPath, resolveHelperBinary } from './binary'

describe('helper binary paths', () => {
  it('resolves the dev binary from the app path', () => {
    expect(resolveHelperBinary(join('/repo', 'apps', 'desktop'))).toBe(
      join('/repo', 'helper', '.build', 'debug', 'moki-helper')
    )
  })

  it('resolves the bundled binary when packaged', () => {
    expect(
      resolveHelperBinary(join('/repo', 'apps', 'desktop'), {
        isPackaged: true,
        resourcesPath: join('/Applications', 'Moki.app', 'Contents', 'Resources')
      })
    ).toBe(
      join('/Applications', 'Moki.app', 'Contents', 'Resources', 'moki-helper', 'moki-helper')
    )
  })

  it('falls back to the dev path when packaged without a resources path', () => {
    expect(
      resolveHelperBinary(join('/repo', 'apps', 'desktop'), { isPackaged: true })
    ).toBe(join('/repo', 'helper', '.build', 'debug', 'moki-helper'))
  })

  it('resolves the bundled binary from a resources path', () => {
    expect(helperBinaryFromResourcesPath('/Resources')).toBe(
      join('/Resources', 'moki-helper', 'moki-helper')
    )
  })
})
