import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import Library from './views/Library'
import Search from './views/Search'
import Upcoming from './views/Upcoming'
import ItemDetail from './views/ItemDetail'
import EpisodePage from './views/EpisodePage'
import Stats from './views/Stats'
import Settings from './views/Settings'

export default function App() {
  return (
    <Routes>
      {/* All pages render inside the shared Layout (nav + <Outlet/>). */}
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/library" replace />} />
        <Route path="/library" element={<Library />} />
        <Route path="/search" element={<Search />} />
        <Route path="/upcoming" element={<Upcoming />} />
        <Route path="/stats" element={<Stats />} />
        <Route path="/item/:id" element={<ItemDetail />} />
        <Route path="/item/:id/episode/:season/:episode" element={<EpisodePage />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/library" replace />} />
      </Route>
    </Routes>
  )
}
