import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'
import { imageUrl } from '../api/tmdb'
import { db } from '../data/db'
import { useFavoritePeople } from '../data/favorites'
import ListsSection from '../components/ListsSection'
import UserAvatar from '../components/UserAvatar'
import { UploadIcon } from '../components/ImageDrop'
import { BADGES, useEarnedBadges } from '../data/badges'
import { reviewBadgeToast } from '../utils/badgeToast'
import { getGoogleProfile, type GoogleProfile } from '../data/driveSync'
import {
  getProfileAvatar,
  getProfileBackdrop,
  getProfileName,
  setProfileAvatar,
  setProfileBackdrop,
  setProfileName,
} from '../data/profileImages'
import { LIST_BANNER_MAX, PROFILE_AVATAR_MAX, resizeImageToDataUrl } from '../utils/image'
import { markFlag } from '../data/appFlags'
import { LAST_EXPORT_KEY } from '../data/exportImport'
import { itemNeedsIndex, startIndexing, useIndexProgress } from '../data/episodeIndex'
import { getTraktLastSync, getTraktStats } from '../api/trakt'
import { useTraktAuth } from '../hooks/useTraktAuth'

const LAST_SYNCED_KEY = 'tvtracker.lastSynced'

function readTs(key: string): number | null {
  try {
    const v = localStorage.getItem(key)
    return v ? Number(v) : null
  } catch {
    return null
  }
}

/** "4 days, 6 hours, 23 minutes" from a minute total. */
function formatDuration(totalMinutes: number): string {
  const m = Math.max(0, Math.round(totalMinutes))
  const days = Math.floor(m / 1440)
  const hours = Math.floor((m % 1440) / 60)
  const mins = m % 60
  const parts: string[] = []
  if (days) parts.push(`${days} ${days === 1 ? 'day' : 'days'}`)
  if (hours) parts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`)
  if (mins || parts.length === 0) parts.push(`${mins} ${mins === 1 ? 'minute' : 'minutes'}`)
  return parts.join(', ')
}

function formatTs(ms: number | null): string {
  return ms ? new Date(ms).toLocaleString() : 'Never'
}

export default function Stats() {
  const items = useLiveQuery(() => db.trackedItems.toArray())
  const episodeStates = useLiveQuery(() => db.episodeStates.toArray())
  const watchEvents = useLiveQuery(() => db.watchEvents.toArray())
  const favoriteActors = useFavoritePeople()
  const earnedBadges = useEarnedBadges()

  const [profile, setProfile] = useState<GoogleProfile | null>(getGoogleProfile())
  const [avatarCustom, setAvatarCustom] = useState(getProfileAvatar())
  const [backdrop, setBackdrop] = useState(getProfileBackdrop())
  const [nameCustom, setNameCustom] = useState(getProfileName())
  const [nameDraft, setNameDraft] = useState('')
  const [headEditing, setHeadEditing] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const backdropInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const onProfile = () => {
      setProfile(getGoogleProfile())
      setAvatarCustom(getProfileAvatar())
      setBackdrop(getProfileBackdrop())
      setNameCustom(getProfileName())
    }
    window.addEventListener('tvtracker:profile', onProfile)
    return () => window.removeEventListener('tvtracker:profile', onProfile)
  }, [])

  // The display name: a custom override, else the Google name, else a generic label.
  const displayName = nameCustom ?? profile?.name ?? 'Your profile'
  // Commit the edited name (empty clears the override, falling back to the Google
  // name). Called on blur and when leaving Customize mode.
  function commitName(): void {
    const trimmed = nameDraft.trim()
    if (trimmed === (getProfileName() ?? '')) return
    setProfileName(trimmed || null)
  }
  function toggleHeadEdit(): void {
    setHeadEditing((v) => {
      if (v) commitName()
      else setNameDraft(getProfileName() ?? '')
      return !v
    })
  }

  async function uploadAvatar(file: File | undefined): Promise<void> {
    if (!file) return
    try {
      setProfileAvatar(await resizeImageToDataUrl(file, PROFILE_AVATAR_MAX.w, PROFILE_AVATAR_MAX.h))
    } catch {
      // Ignore an unsupported/corrupt file.
    }
  }
  async function uploadBackdrop(file: File | undefined): Promise<void> {
    if (!file) return
    try {
      setProfileBackdrop(await resizeImageToDataUrl(file, LIST_BANNER_MAX.w, LIST_BANNER_MAX.h))
    } catch {
      // Ignore an unsupported/corrupt file.
    }
  }

  // Earns "It's Full of Stars" the first time you open this page.
  useEffect(() => markFlag('openedStats'), [])

  const index = useIndexProgress()
  const [indexDismissed, setIndexDismissed] = useState(false)

  const trakt = useTraktAuth()
  const traktStatsQuery = useQuery({
    queryKey: ['trakt-stats'],
    queryFn: getTraktStats,
    enabled: trakt.signedIn,
    staleTime: 5 * 60_000,
  })
  const traktLastSync = getTraktLastSync()

  const lastSynced = readTs(LAST_SYNCED_KEY)
  const lastExport = readTs(LAST_EXPORT_KEY)

  if (!items || !episodeStates || !watchEvents) {
    return <p className="muted">Crunching your numbers…</p>
  }

  if (items.length === 0) {
    return (
      <div className="empty-state">
        <p className="empty-state__emoji">📊</p>
        <h2>No stats yet</h2>
        <p className="muted">
          Add shows and movies from <Link to="/search">Search</Link>, then watch a few — your viewing
          profile builds up here.
        </p>
      </div>
    )
  }

  const itemsById = new Map(items.map((i) => [i.id, i]))
  const shows = items.filter((i) => i.mediaType === 'show')
  const movies = items.filter((i) => i.mediaType === 'movie')
  const sportTeams = items.filter((i) => i.mediaType === 'sport')

  // --- Watched episodes (shows) -------------------------------------------
  const watched = episodeStates.filter((s) => s.watched)
  // Games (sport "episodes") are counted separately, not as TV episodes.
  const isSportState = (itemId: string) => itemsById.get(itemId)?.mediaType === 'sport'
  const episodesWatched = watched.filter((s) => !isSportState(s.itemId)).length
  const gamesWatched = watched.filter((s) => isSportState(s.itemId)).length
  const episodesSkipped = episodeStates.filter((s) => s.skipped && !isSportState(s.itemId)).length
  const watchedPerShow = new Map<string, number>()
  for (const s of watched) watchedPerShow.set(s.itemId, (watchedPerShow.get(s.itemId) ?? 0) + 1)

  // --- Watched movies (append-only log; episodeId === null) ----------------
  const movieWatchesByItem = new Map<string, number>()
  for (const e of watchEvents) {
    if (e.episodeId === null && itemsById.has(e.itemId)) {
      movieWatchesByItem.set(e.itemId, (movieWatchesByItem.get(e.itemId) ?? 0) + 1)
    }
  }
  const moviesWatched = movieWatchesByItem.size

  // --- Watch time (uses backfilled per-item runtime; rewatches count) ------
  let tvMinutes = 0
  for (const s of watched) {
    const it = itemsById.get(s.itemId)
    if (it?.runtime) tvMinutes += (s.watchCount ?? 1) * it.runtime
  }
  let movieMinutes = 0
  for (const [id, count] of movieWatchesByItem) {
    const it = itemsById.get(id)
    if (it?.runtime) movieMinutes += count * it.runtime
  }
  const totalMinutes = tvMinutes + movieMinutes

  // --- Completion ratio (needs backfilled episodeCount) --------------------
  // Dropped shows are excluded — you've decided not to finish them, so they
  // shouldn't drag completion down.
  let epWatchedForRatio = 0
  let epTotalForRatio = 0
  let showsInRatio = 0
  for (const sh of shows) {
    if (sh.status === 'dropped') continue
    if (!sh.episodeCount || sh.episodeCount <= 0) continue
    showsInRatio += 1
    epWatchedForRatio += Math.min(watchedPerShow.get(sh.id) ?? 0, sh.episodeCount)
    epTotalForRatio += sh.episodeCount
  }
  const completion = epTotalForRatio > 0 ? epWatchedForRatio / epTotalForRatio : 0
  const completionPct = Math.round(completion * 100)

  // --- Active vs completed shows ------------------------------------------
  const activeShows = shows.filter((s) => s.status === 'watching').length
  const completedShows = shows.filter((s) => s.status === 'completed').length

  // --- Genre chart (weighted by what you actually watched) -----------------
  const genreWeight = new Map<string, number>()
  let genreWatchSum = 0
  for (const sh of shows) {
    const w = watchedPerShow.get(sh.id) ?? 0
    if (w <= 0) continue
    for (const g of sh.genres ?? []) genreWeight.set(g, (genreWeight.get(g) ?? 0) + w)
    genreWatchSum += w
  }
  for (const mv of movies) {
    const w = movieWatchesByItem.get(mv.id) ?? 0
    if (w <= 0) continue
    for (const g of mv.genres ?? []) genreWeight.set(g, (genreWeight.get(g) ?? 0) + w)
    genreWatchSum += w
  }
  // Nothing watched yet → fall back to a library-wide genre count.
  const genresFromWatch = genreWatchSum > 0
  if (!genresFromWatch) {
    for (const it of items) for (const g of it.genres ?? []) genreWeight.set(g, (genreWeight.get(g) ?? 0) + 1)
  }
  const topGenres = [...genreWeight.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
  const genreMax = topGenres[0]?.[1] ?? 1

  // --- Top networks / services (per tracked title) -------------------------
  const netWeight = new Map<string, number>()
  for (const it of items) for (const p of it.providers ?? []) netWeight.set(p, (netWeight.get(p) ?? 0) + 1)
  const topNetworks = [...netWeight.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
  const netMax = topNetworks[0]?.[1] ?? 1

  // --- Critic profile (your average vs TMDB's) -----------------------------
  const rated = items.filter((i) => typeof i.userRating === 'number')
  const yourAvg = rated.length
    ? rated.reduce((n, i) => n + (i.userRating as number), 0) / rated.length
    : null
  const ratedWithTmdb = rated.filter((i) => typeof i.tmdbRating === 'number')
  const tmdbAvg = ratedWithTmdb.length
    ? ratedWithTmdb.reduce((n, i) => n + (i.tmdbRating as number), 0) / ratedWithTmdb.length
    : null
  let criticQuip: string | null = null
  if (yourAvg !== null && tmdbAvg !== null) {
    const delta = yourAvg - tmdbAvg
    criticQuip =
      delta > 0.3
        ? 'Generous critic — you rate higher than the crowd.'
        : delta < -0.3
          ? 'Tough crowd — you rate lower than average.'
          : 'Right in line with the TMDB consensus.'
  }

  // --- Coverage / indexing -------------------------------------------------
  const pendingIndex = items.filter(itemNeedsIndex).length
  const indexing = index.status === 'running'
  // Prompt to bring the index up to date — the stats only add up once it is.
  const showIndexPrompt = pendingIndex > 0 && !indexDismissed && !indexing

  function indexNow() {
    setIndexDismissed(true)
    void startIndexing()
  }

  // --- Badges --------------------------------------------------------------
  // "Welcome Back!" is a sign-in notification, not a collectible — hide it here.
  const HIDDEN_BADGES = new Set(['welcome-back'])
  const visibleBadges = BADGES.filter((b) => !HIDDEN_BADGES.has(b.id))
  const earnedAt = new Map(
    (earnedBadges ?? []).filter((b) => !HIDDEN_BADGES.has(b.id)).map((b) => [b.id, b.earnedAt]),
  )
  const badgeGroups = [...new Set(visibleBadges.map((b) => b.group))]

  return (
    <div className="stats">
      {showIndexPrompt && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal">
            <h3>Update your stats?</h3>
            <p>
              {pendingIndex} {pendingIndex === 1 ? 'title needs' : 'titles need'} indexing before your
              totals — watch time, completion, genres — are accurate.
            </p>
            <p className="muted">
              This fetches episode data for those titles. It runs in the background and takes about a
              minute for a large library.
            </p>
            <div className="modal__actions">
              <button className="btn btn--ghost" onClick={() => setIndexDismissed(true)}>
                Show as-is
              </button>
              <button className="btn" onClick={indexNow}>
                Index now
              </button>
            </div>
          </div>
        </div>
      )}

      {indexing && (
        <p className="badge badge--ok stats__indexing">
          Updating your stats… {index.done}/{index.total}
        </p>
      )}

      <div
        className={`stats__head${headEditing ? ' stats__head--edit' : ''}`}
        onDragOver={headEditing ? (e) => e.preventDefault() : undefined}
        onDrop={
          headEditing
            ? (e) => {
                e.preventDefault()
                void uploadBackdrop(e.dataTransfer.files?.[0])
              }
            : undefined
        }
      >
        {backdrop && <img className="stats__backdrop" src={backdrop} alt="" />}
        <div className="stats__head-overlay" />
        <input
          ref={backdropInputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            void uploadBackdrop(e.target.files?.[0])
            e.target.value = ''
          }}
        />
        {headEditing && backdrop && (
          <button
            type="button"
            className="img-drop__remove list-backdrop-remove"
            title="Remove backdrop"
            aria-label="Remove backdrop"
            onClick={() => setProfileBackdrop(null)}
          >
            −
          </button>
        )}
        {headEditing && !backdrop && (
          <button
            type="button"
            className="list-backdrop-drop stats-drop"
            onClick={() => backdropInputRef.current?.click()}
            title="Upload backdrop"
          >
            <UploadIcon />
            <span className="img-drop__label">Backdrop</span>
            <span className="img-drop__hint">16:9 · ~1280×720 · ≤5 MB</span>
          </button>
        )}

        <div className="stats__avatar-wrap">
          <UserAvatar className="stats__avatar" />
          {headEditing && (
            <>
              <button
                type="button"
                className="stats__avatar-edit"
                title="Upload icon"
                aria-label="Upload icon"
                onClick={() => avatarInputRef.current?.click()}
              >
                <UploadIcon />
              </button>
              {avatarCustom && (
                <button
                  type="button"
                  className="stats__avatar-reset"
                  title="Use Google icon"
                  aria-label="Use Google icon"
                  onClick={() => setProfileAvatar(null)}
                >
                  ↺
                </button>
              )}
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  void uploadAvatar(e.target.files?.[0])
                  e.target.value = ''
                }}
              />
            </>
          )}
        </div>

        <div className="stats__head-meta">
          {headEditing ? (
            <div className="stats__name-edit">
              <input
                className="stats__name-input"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={commitName}
                placeholder={profile?.name ?? 'Your name'}
                aria-label="Display name"
                maxLength={40}
              />
              {nameCustom && profile?.name && (
                <button
                  type="button"
                  className="stats__name-reset"
                  title="Use Google name"
                  aria-label="Use Google name"
                  onClick={() => {
                    setProfileName(null)
                    setNameDraft('')
                  }}
                >
                  ↺
                </button>
              )}
            </div>
          ) : (
            <h2 className="stats__name">{displayName}</h2>
          )}
          <div className="stats__pills">
            <span className="where-pill">{items.length} tracked</span>
            <span className="where-pill">{shows.length} shows</span>
            <span className="where-pill">{movies.length} movies</span>
            {sportTeams.length > 0 && <span className="where-pill">{sportTeams.length} teams</span>}
          </div>
        </div>

        <button
          type="button"
          className="ext-link stats__head-edit-btn"
          onClick={toggleHeadEdit}
        >
          {headEditing ? 'Done' : 'Customize'}
        </button>
      </div>

      {/* Hero: total watch time */}
      <section className="stat-hero">
        <span className="stat-hero__label">Total time watched</span>
        <span className="stat-hero__value">{formatDuration(totalMinutes)}</span>
        <div className="stat-hero__split">
          <span>
            📺 TV · <strong>{formatDuration(tvMinutes)}</strong>
          </span>
          <span>
            🎬 Movies · <strong>{formatDuration(movieMinutes)}</strong>
          </span>
        </div>
      </section>

      {/* Quick tiles */}
      <div className="stat-grid">
        <StatTile value={episodesWatched.toLocaleString()} label="Episodes watched" />
        {episodesSkipped > 0 && (
          <StatTile value={episodesSkipped.toLocaleString()} label="Episodes skipped" />
        )}
        <StatTile value={moviesWatched.toLocaleString()} label="Movies watched" />
        <StatTile value={shows.length.toLocaleString()} label="Shows tracked" />
        <StatTile value={`${activeShows} / ${completedShows}`} label="Watching / Completed" />
        {sportTeams.length > 0 && (
          <StatTile value={gamesWatched.toLocaleString()} label="Games watched" />
        )}
      </div>

      {/* Timeline entry point */}
      <Link to="/timeline" className="card tl-entry">
        <span className="tl-entry__icon" aria-hidden="true">
          🗓️
        </span>
        <span className="tl-entry__text">
          <strong className="tl-entry__name">Timeline</strong>
          <span className="muted">See what you watched, day by day</span>
        </span>
        <span className="tl-entry__chev" aria-hidden="true">
          ›
        </span>
      </Link>

      {/* Badges */}
      <section className="card">
        <h3 className="section-title">
          Badges <span className="muted section-title__count">{earnedAt.size} / {visibleBadges.length}</span>
        </h3>
        {badgeGroups.map((group) => (
          <div key={group} className="badge-group">
            <h4 className="badge-group__title">{group}</h4>
            <div className="badge-grid">
              {visibleBadges.filter((b) => b.group === group).map((b) => {
                const at = earnedAt.get(b.id)
                const on = at !== undefined
                const inner = (
                  <>
                    <span className="badge-chip__icon" aria-hidden="true">
                      {b.emoji}
                    </span>
                    <span className="badge-chip__name">{b.name}</span>
                    <span className="badge-chip__desc muted">
                      {on ? 'Earned' : b.description}
                    </span>
                  </>
                )
                // Earned badges hide their requirement, so a tap re-shows the
                // toast to remind you how you earned it; locked ones aren't
                // clickable (they already show what's needed).
                return on ? (
                  <button
                    key={b.id}
                    type="button"
                    className="badge-chip badge-chip--on badge-chip--tap"
                    title={`${b.name} — see how you earned it`}
                    onClick={() => reviewBadgeToast(b, at)}
                  >
                    {inner}
                  </button>
                ) : (
                  <div key={b.id} className="badge-chip" title={`Locked — ${b.description}`}>
                    {inner}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </section>

      {/* Completion */}
      <section className="card">
        <h3 className="section-title">Library completion</h3>
        {epTotalForRatio > 0 ? (
          <>
            <div className="progress">
              <div className="progress__fill" style={{ width: `${completionPct}%` }} />
              <span className="progress__label">{completionPct}%</span>
            </div>
            <p className="muted stat-note">
              {epWatchedForRatio.toLocaleString()} of {epTotalForRatio.toLocaleString()} episodes
              watched across {showsInRatio} show{showsInRatio === 1 ? '' : 's'} (dropped shows
              excluded).
            </p>
          </>
        ) : (
          <p className="muted">
            Episode counts aren’t available yet — run <Link to="/settings">Build index</Link> to
            compute your completion.
          </p>
        )}
      </section>

      {/* Genres */}
      {topGenres.length > 0 && (
        <section className="card">
          <h3 className="section-title">
            {genresFromWatch ? 'Your top genres' : 'Genres in your library'}
          </h3>
          <ul className="bars">
            {topGenres.map(([name, w]) => (
              <li key={name} className="bar-row">
                <span className="bar-row__label">{name}</span>
                <span className="bar-row__track">
                  <span className="bar-row__fill" style={{ width: `${(w / genreMax) * 100}%` }} />
                </span>
                <span className="bar-row__val muted">{w}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Networks */}
      {topNetworks.length > 0 && (
        <section className="card">
          <h3 className="section-title">Top networks &amp; services</h3>
          <ul className="bars">
            {topNetworks.map(([name, w]) => (
              <li key={name} className="bar-row">
                <span className="bar-row__label">{name}</span>
                <span className="bar-row__track">
                  <span
                    className="bar-row__fill bar-row__fill--alt"
                    style={{ width: `${(w / netMax) * 100}%` }}
                  />
                </span>
                <span className="bar-row__val muted">{w}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Custom lists */}
      <ListsSection />

      {/* Favorite actors */}
      {favoriteActors && favoriteActors.length > 0 && (
        <section className="card">
          <h3 className="section-title">Favorite actors</h3>
          <div className="fav-actors">
            {favoriteActors.map((p) => {
              const photo = imageUrl(p.profilePath ?? undefined, 'w185')
              return (
                <Link
                  key={p.id}
                  to={`/search?q=${encodeURIComponent(`actor:${p.name}`)}`}
                  className="fav-actor"
                  title={p.name}
                >
                  {photo ? (
                    <img className="fav-actor__photo" src={photo} alt="" loading="lazy" />
                  ) : (
                    <span className="fav-actor__photo fav-actor__photo--ph">👤</span>
                  )}
                  <span className="fav-actor__name">{p.name}</span>
                </Link>
              )
            })}
          </div>
        </section>
      )}

      {/* Critic profile */}
      <section className="card">
        <h3 className="section-title">Critic profile</h3>
        {yourAvg !== null ? (
          <>
            <div className="critic">
              <div className="critic__col">
                <span className="critic__num">{yourAvg.toFixed(1)}</span>
                <span className="muted">your average</span>
              </div>
              <span className="critic__vs">vs</span>
              <div className="critic__col">
                <span className="critic__num">{tmdbAvg !== null ? tmdbAvg.toFixed(1) : '—'}</span>
                <span className="muted">TMDB average</span>
              </div>
            </div>
            {criticQuip && <p className="muted stat-note">{criticQuip}</p>}
            <p className="muted stat-note">Based on {rated.length} rated title{rated.length === 1 ? '' : 's'}.</p>
          </>
        ) : (
          <p className="muted">Rate some titles to build your critic profile.</p>
        )}
      </section>

      {/* Account / meta */}
      <section className="card">
        <h3 className="section-title">Account</h3>
        <dl className="meta-list">
          <div>
            <dt>Google account</dt>
            <dd>{profile?.name ?? 'Not connected'}</dd>
          </div>
          <div>
            <dt>Last synced</dt>
            <dd>{formatTs(lastSynced)}</dd>
          </div>
          <div>
            <dt>Last export</dt>
            <dd>{formatTs(lastExport)}</dd>
          </div>
        </dl>
      </section>

      {trakt.signedIn && (
        <section className="card">
          <h3 className="section-title">Trakt</h3>
          {(() => {
            const ts = traktStatsQuery.data
            const traktMinutes = (ts?.movies?.minutes ?? 0) + (ts?.episodes?.minutes ?? 0)
            const traktComments =
              (ts?.movies?.comments ?? 0) +
              (ts?.shows?.comments ?? 0) +
              (ts?.seasons?.comments ?? 0) +
              (ts?.episodes?.comments ?? 0)
            return (
              <dl className="meta-list">
                <div>
                  <dt>Account</dt>
                  <dd>{trakt.username ?? 'Signed in'}</dd>
                </div>
                <div>
                  <dt>Last history sync</dt>
                  <dd>{formatTs(traktLastSync)}</dd>
                </div>
                {ts && (
                  <>
                    <div>
                      <dt>Movies watched</dt>
                      <dd>{(ts.movies?.watched ?? 0).toLocaleString()}</dd>
                    </div>
                    <div>
                      <dt>Episodes watched</dt>
                      <dd>{(ts.episodes?.watched ?? 0).toLocaleString()}</dd>
                    </div>
                    <div>
                      <dt>Time on Trakt</dt>
                      <dd>{formatDuration(traktMinutes)}</dd>
                    </div>
                    <div>
                      <dt>Ratings</dt>
                      <dd>{(ts.ratings?.total ?? 0).toLocaleString()}</dd>
                    </div>
                    <div>
                      <dt>Comments &amp; reviews</dt>
                      <dd>{traktComments.toLocaleString()}</dd>
                    </div>
                  </>
                )}
                {traktStatsQuery.isLoading && (
                  <div>
                    <dt className="muted">Loading Trakt stats…</dt>
                    <dd />
                  </div>
                )}
              </dl>
            )
          })()}
        </section>
      )}

      {pendingIndex > 0 && !indexing && (
        <p className="muted stat-note stat-note--foot">
          {pendingIndex} {pendingIndex === 1 ? 'title is' : 'titles are'} missing data, so these
          numbers are a floor.{' '}
          <button className="link-btn" onClick={indexNow}>
            Index now
          </button>{' '}
          to fill them in.
        </p>
      )}
    </div>
  )
}

function StatTile({ value, label }: { value: string; label: string }) {
  return (
    <div className="stat-tile">
      <span className="stat-tile__value">{value}</span>
      <span className="stat-tile__label">{label}</span>
    </div>
  )
}

