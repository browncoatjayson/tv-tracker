import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import { del, get, set } from 'idb-keyval'
import { HashRouter } from 'react-router-dom'
import App from './App.tsx'
import './index.css'

const HOUR = 1000 * 60 * 60
const DAY = HOUR * 24

// TanStack Query caches all TMDB/TVmaze responses. gcTime must be >= the persist
// maxAge so cached queries aren't dropped before they're restored after a reload.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: HOUR,
      gcTime: DAY,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

// Persist the cache to IndexedDB so refreshing / reopening the app doesn't
// re-fetch show details, air times, etc. — it reloads from the saved cache.
const persister = createAsyncStoragePersister({
  storage: { getItem: get, setItem: set, removeItem: del },
  key: 'tvtracker.queryCache',
  throttleTime: 1000,
})

// HashRouter keeps routing entirely client-side (URLs look like /#/library) —
// bulletproof on GitHub Pages with no server config.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister, maxAge: DAY, buster: 'v1' }}
    >
      <HashRouter>
        <App />
      </HashRouter>
    </PersistQueryClientProvider>
  </StrictMode>,
)
