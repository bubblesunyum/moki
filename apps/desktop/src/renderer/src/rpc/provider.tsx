import { useState, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/** React-query provider for RPC hooks. Mount once near the app root. */
export function RpcProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 1, staleTime: 10_000 }
        }
      })
  )
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
