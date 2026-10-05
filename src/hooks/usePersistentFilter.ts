import { useEffect, useState } from 'react'

/**
 * A filter-query string that remembers its last value per view (Library,
 * Search, Upcoming) in localStorage, keyed by `key`. Returns the usual
 * [value, setValue] pair, so callers use it like useState.
 */
export function usePersistentFilter(key: string): [string, (v: string) => void] {
  const [value, setValue] = useState<string>(() => {
    try {
      return localStorage.getItem(key) ?? ''
    } catch {
      return ''
    }
  })

  useEffect(() => {
    try {
      if (value) localStorage.setItem(key, value)
      else localStorage.removeItem(key)
    } catch {
      // ignore (private mode / blocked storage)
    }
  }, [key, value])

  return [value, setValue]
}
