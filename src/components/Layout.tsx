import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { startIndexing, useIndexProgress } from '../data/episodeIndex'
import { getGoogleProfile, recordSynced, syncNow, wasConnected, type GoogleProfile } from '../data/driveSync'
import UpdatePrompt from './UpdatePrompt'
import ConfirmHost from './ConfirmHost'
import BadgeToastHost from './BadgeToastHost'
import NotificationScheduler from './NotificationScheduler'
import { useBadgeWatcher } from '../hooks/useBadgeWatcher'
import { UserGlyph } from '../views/Stats'

// Tabs shown in the nav bar. A single source of truth keeps the markup tidy.
const TABS = [
  { to: '/library', label: 'Library', icon: '📺' },
  { to: '/search', label: 'Search', icon: '🔍' },
  { to: '/upcoming', label: 'Upcoming', icon: '🗓️' },
  { to: '/settings', label: 'Settings', icon: '⚙️' },
] as const

export default function Layout() {
  // Warm the index (and the shared TMDB cache it populates) on launch, so a show
  // just added or pulled in by a sync is ready on Library/Upcoming without first
  // opening Stats. No-ops when everything is already indexed.
  useEffect(() => {
    void startIndexing()
  }, [])

  // On launch: ask the browser to persist our storage (so it isn't auto-evicted
  // under pressure — won't stop a manual data clear, but helps otherwise), and,
  // for a connected user, pull any changes from Drive. Both are silent and
  // best-effort; the Drive sync is a no-op after a cache wipe (the flag is gone).
  useEffect(() => {
    try {
      void navigator.storage?.persist?.()
    } catch {
      // ignore
    }
    if (wasConnected()) {
      void syncNow(false)
        .then((r) => recordSynced(r.syncedAt))
        .catch(() => {})
    }
  }, [])

  // Award gamification badges as milestones are hit (confetti toast on earn).
  useBadgeWatcher()

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1 className="app-title">TV Tracker</h1>
        <div className="app-header__right">
          <IndexIndicator />
          <UserButton />
        </div>
      </header>

      <main className="app-main">
        {/* Child route renders here. */}
        <Outlet />
      </main>

      <UpdatePrompt />
      <ConfirmHost />
      <BadgeToastHost />
      <NotificationScheduler />

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

/** Header avatar button → personal stats. Shows the Google photo when synced. */
function UserButton() {
  const [profile, setProfile] = useState<GoogleProfile | null>(getGoogleProfile())
  useEffect(() => {
    const onProfile = () => setProfile(getGoogleProfile())
    window.addEventListener('tvtracker:profile', onProfile)
    return () => window.removeEventListener('tvtracker:profile', onProfile)
  }, [])
  return (
    <Link to="/stats" className="user-btn" aria-label="Your stats" title="Your stats">
      {profile?.picture ? (
        <img className="user-btn__img" src={profile.picture} alt="" referrerPolicy="no-referrer" />
      ) : (
        <UserGlyph />
      )}
    </Link>
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
