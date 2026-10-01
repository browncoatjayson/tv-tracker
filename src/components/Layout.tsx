import { NavLink, Outlet } from 'react-router-dom'

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
      </header>

      <main className="app-main">
        {/* Child route renders here. */}
        <Outlet />
      </main>

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
