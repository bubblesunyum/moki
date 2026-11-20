import { useEffect, useState } from 'react'

/* Shared localStorage-backed state for Day widgets. Loads once through
 * `validate` (JSON-parsed, falling back to the raw string for legacy
 * plain-string keys), then persists every change inside try/catch so
 * blocked storage never breaks the widget. */
export function usePersistentState<T>(
  key: string,
  validate: (raw: unknown) => T | null,
  initial: T
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(key)
      if (raw === null) return initial
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch {
        parsed = raw
      }
      const valid = validate(parsed)
      return valid === null ? initial : valid
    } catch {
      return initial
    }
  })

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value))
    } catch {
      /* Blocked storage — the widget still works in memory. */
    }
  }, [key, value])

  return [value, setValue]
}
