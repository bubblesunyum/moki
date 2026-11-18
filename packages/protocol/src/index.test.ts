import { describe, expect, it } from 'vitest'
import { PROTOCOL_VERSION, type MokiProtocolHello } from './index'

describe('protocol', () => {
  it('exposes a placeholder hello message', () => {
    const hello: MokiProtocolHello = { kind: 'hello', version: PROTOCOL_VERSION }
    expect(hello.version).toBe(1)
  })
})
