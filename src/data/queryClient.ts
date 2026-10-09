import { QueryClient } from '@tanstack/react-query'

const HOUR = 1000 * 60 * 60
const DAY = HOUR * 24

// The single TanStack Query client, in its own module so non-React code (e.g. the
// background indexer) can warm the same cache the views read from. gcTime must be
// >= the persist maxAge so cached queries aren't dropped before they're restored.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: HOUR,
      gcTime: DAY,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})
