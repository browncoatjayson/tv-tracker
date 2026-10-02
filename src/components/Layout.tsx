import { NavLink, Outlet } from 'react-router-dom'
import { useIndexProgress } from '../data/episodeIndex'
import UpdatePrompt from './UpdatePrompt'

// Tabs shown in the nav bar. A single source of truth keeps the markup tidy.
const TABS = [
  { to: '/library', label: 'Library', icon: '📺' },
  { to: '/search', label: 'Search', icon: '🔍' },
  { to: '/upcoming', label: 'Upcoming', icon: '🗓️' },
  { to: '/settings', label: 'Settings', icon: '⚙️' },
] as const

export default function Layout() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <h1 className="app-title">TV Tracker</h1>
        <IndexIndicator />
      </header>

      <main className="app-main">
        {/* Child route renders here. */}
        <Outlet />
      </main>

      <UpdatePrompt />

      {/* Bottom tab bar — the mobile-app feel, also works fine on desktop. */}
      <nav className="app-nav" aria-label="Primary">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) => `nav-tab${isActive ? ' nav-tab--active' : ''}`}
          >
            <span className="nav-tab__icon" aria-hidden="true">
              {tab.icon}
            </span>
            <span className="nav-tab__label">{tab.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}

/** Small header indicator shown while the episode search index is building. */
function IndexIndicator() {
  const { status, done, total } = useIndexProgress()
  if (status !== 'running' || total === 0) return null
  const pct = Math.round((done / total) * 100)
  return (
    <div className="index-indicator" title="Building episode search index">
      <span>
        Indexing episodes… {done}/{total}
      </span>
      <div className="index-indicator__bar">
        <div className="index-indicator__fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
