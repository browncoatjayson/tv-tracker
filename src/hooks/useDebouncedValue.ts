import { useEffect, useState } from 'react'

/**
 * Returns a copy of `value` that only updates after it has stopped changing for
 * `delayMs`. Used to avoid firing a TMDB request on every keystroke.
 */
export function useDebouncedValue<T>(value: T, delayMs = 350): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    // Cleanup cancels the pending update if `value` changes again first.
    return () => clearTimeout(timer)
  }, [value, delayMs])

  return debounced
}
