import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { HashRouter } from 'react-router-dom'
import App from './App.tsx'
import './index.css'

// TanStack Query caches all TMDB responses. staleTime of 1h means we won't
// refetch the same metadata repeatedly within a session.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 1000 * 60 * 60, retry: 1, refetchOnWindowFocus: false },
  },
})

// HashRouter keeps routing entirely client-side (URLs look like /#/library).
// This is bulletproof on GitHub Pages — no 404 fallback or server config needed.
// If we later want clean URLs we can switch to BrowserRouter + a 404.html trick.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <App />
      </HashRouter>
    </QueryClientProvider>
  </StrictMode>,
)
