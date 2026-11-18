import type { MokiApi } from '../../../../../packages/protocol/src/index'

declare global {
  interface Window {
    moki: MokiApi
  }
}

export {}
