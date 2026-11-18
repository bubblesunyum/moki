// Shared main<->renderer<->helper message types.
// Placeholder until the helper bridge (mok-a0l.5) defines the real RPC.

export const PROTOCOL_VERSION = 1 as const

export type MokiProtocolHello = {
  kind: 'hello'
  version: typeof PROTOCOL_VERSION
}
