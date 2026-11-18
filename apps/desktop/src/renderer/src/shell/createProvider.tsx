import { createContext, useContext, type PropsWithChildren } from 'react'

/* Provider factory (psymail-mini ARCHITECTURE.md): write the
 * createContext/useContext boilerplate once, then [Provider, useHook]. */
export function createProvider<T>(useValue: () => T) {
  const Context = createContext<T | null>(null)
  function Provider({ children }: PropsWithChildren): React.JSX.Element {
    return <Context.Provider value={useValue()}>{children}</Context.Provider>
  }
  function useProviderContext(): T {
    const value = useContext(Context)
    if (!value) throw new Error('must be used within its Provider')
    return value
  }
  return [Provider, useProviderContext] as const
}
