import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'
import {
  espnGameUrl,
  espnRaceUrl,
  espnTeamUrl,
  getEspnRaceSchedule,
  getEspnTeamSchedule,
  leagueByKey,
  recentSeasons,
} from '../api/espn'
import { db } from '../data/db'
import { clearWatchedEpisodes, markEpisode, removeItem, setStatus } from '../data/library'
import {
  addSportTeam,
  cacheSportGames,
  markGameWithCatchUp,
  parseSportId,
  sportAirState,
} from '../data/sports'
import type { WatchStatus } from '../data/types'
import DetailHero from '../components/DetailHero'
import { appConfirm } from '../utils/confirm'

const HOUR = 1000 * 60 * 60
const STATUSES: WatchStatus[] = ['watchlist', 'watching', 'completed', 'dropped']
const SEASONS = recentSeasons(6)

export default function SportDetail({ itemId }: { itemId: string }) {
  const parsed = parseSportId(itemId)
  const league = leagueByKey(parsed?.league)
  const teamId = parsed?.teamId

  const item = useLiveQuery(() => db.trackedItems.get(itemId).then((r) => r ?? null), [itemId])
  const [season, setSeason] = useState<number>(SEASONS[0])
  const isRace = league?.kind === 'races'

  const schedule = useQuery({
    queryKey: ['espn-schedule', parsed?.league, teamId, season],
    queryFn: () =>
      isRace
        ? getEspnRaceSchedule(parsed!.league, season)
        : getEspnTeamSchedule(parsed!.league, teamId!, season),
    enabled: !!parsed && !!league,
    staleTime: HOUR,
  })

  // Mirror the fetched games into the episode cache (for Library / Upcoming).
  useEffect(() => {
    if (schedule.data && schedule.data.games.length) {
      void cacheSportGames(itemId, season, schedule.data.games)
    }
  }, [schedule.data, itemId, season])

  // Backfill a missing team logo onto the tracked item.
  useEffect(() => {
    if (item && item.sport && !item.sport.logo && schedule.data?.logo) {
      void db.trackedItems.update(itemId, { sport: { ...item.sport, logo: schedule.data.logo } })
    }
  }, [item, schedule.data, itemId])

  const states = useLiveQuery(
    () => db.episodeStates.where('itemId').equals(itemId).toArray(),
    [itemId],
  )
  const watchedSet = useMemo(
    () => new Set((states ?? []).filter((s) => s.watched).map((s) => `${s.season}:${s.episode}`)),
    [states],
  )

  if (!parsed || !league) {
    return (
      <div className="placeholder">
        <p>Unknown team.</p>
        <Link to="/library">← Back to Library</Link>
      </div>
    )
  }

  const readOnly = !item
  const teamName = item?.sport?.teamName ?? schedule.data?.teamName ?? 'Team'
  const logo = item?.sport?.logo ?? schedule.data?.logo
  const games = schedule.data?.games ?? []
  const watchedInSeason = games.filter((_, i) => watchedSet.has(`${season}:${i + 1}`)).length

  // Season summary shown beside the status control. Rewatching a season is rare,
  // so the space carries the win/loss record and rank instead.
  const wins = games.filter((g) => g.result?.won).length
  const losses = games.filter((g) => g.result && !g.result.won).length
  const ongoing = games.some((g) => !g.completed)
  const nextGame = games.find((g) => !g.completed)
  const lastCompleted = [...games].reverse().find((g) => g.completed)
  const rank = nextGame?.teamRank ?? lastCompleted?.teamRank
  const hasRecord = wins > 0 || losses > 0

  const links = {
    espn: isRace
      ? `https://www.espn.com/racing/schedule/_/series/${league.raceSeries ?? 'sprint'}`
      : teamId
        ? espnTeamUrl(league.key, teamId)
        : undefined,
  }

  // Any aired-but-unwatched games left to mark in one go.
  const unwatchedAired = games.some(
    (g, i) => g.completed && !watchedSet.has(`${season}:${i + 1}`),
  )

  async function handleAdd() {
    await addSportTeam({
      league: league!.key,
      teamId: teamId!,
      teamName: schedule.data?.teamName ?? teamName,
      logo: schedule.data?.logo ?? logo,
    })
  }

  async function markAllAired() {
    const toMark = games.filter((g, i) => g.completed && !watchedSet.has(`${season}:${i + 1}`))
    if (toMark.length === 0) return
    const ok = await appConfirm(`Mark all ${toMark.length} aired games as watched?`)
    if (!ok) return
    for (let i = 0; i < games.length; i++) {
      const g = games[i]
      if (g.completed && !watchedSet.has(`${season}:${i + 1}`)) {
        await markEpisode(itemId, season, i + 1, true)
      }
    }
  }

  // Changing status out of "Completed" (rare for sports — teams never auto-
  // complete). Mirrors the show page: offer to wipe the watched marks so an
  // accidental bulk-mark can be undone; declining keeps them (and stays Completed
  // when there's nothing aired left to watch).
  async function handleStatusChange(next: WatchStatus) {
    if (!item) return
    const leavingComplete =
      item.status === 'completed' && (next === 'watching' || next === 'watchlist')
    const watchedCount = (states ?? []).filter((s) => (s.watchCount ?? (s.watched ? 1 : 0)) > 0).length
    if (leavingComplete && watchedCount > 0) {
      const clear = await appConfirm('Clear all watched games?', {
        confirmLabel: 'Yes',
        cancelLabel: 'No',
      })
      if (clear) {
        await clearWatchedEpisodes(item.id)
        await setStatus(item.id, next)
      } else if (unwatchedAired) {
        await setStatus(item.id, next)
      }
      // else: caught up and kept the marks — stay Completed.
      return
    }
    await setStatus(item.id, next)
  }

  return (
    <div className="show-detail sport-detail">
      <DetailHero
        poster={logo}
        placeholder={league.emoji}
        title={teamName}
        heroClass={`hero--sport hero--sport-${league.sport}`}
        watermark={league.emoji}
        tags={
          <>
            {games.length > 0 && (
              <>
                <span className="hero__status">{ongoing ? 'Ongoing' : 'Aired'}</span>
                <span className="hero__sep">·</span>
              </>
            )}
            <span>{league.label}</span>
          </>
        }
        links={links}
      />

      <section className="detail-actions">
        <div className="detail-actions__controls">
          {readOnly ? (
            <button className="btn show-detail__add" onClick={() => void handleAdd()}>
              + Add to library
            </button>
          ) : (
            <label className="field show-detail__status">
              <span>Status</span>
              <select
                value={item.status}
                onChange={(e) => void handleStatusChange(e.target.value as WatchStatus)}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {hasRecord && (
          <div className="sport-record">
            <span className="sport-record__wl">
              <strong>{wins}</strong>–<strong>{losses}</strong>
            </span>
            <span className="muted">{ongoing ? 'Record' : 'Final'}</span>
            {rank != null && <span className="sport-record__rank">Rank #{rank}</span>}
          </div>
        )}
      </section>

      <section className="section">
        <h3 className="section-title">Games</h3>

        <div className="hscroll season-tabs">
          {SEASONS.map((y) => (
            <button
              key={y}
              className={`season-tab${y === season ? ' season-tab--on' : ''}`}
              onClick={() => setSeason(y)}
            >
              {y}
            </button>
          ))}
        </div>

        <div className="season-bar">
          <span className="muted">
            <strong>{watchedInSeason}</strong> / {games.length} games watched
          </span>
          {!readOnly && unwatchedAired && (
            <button className="btn btn--small btn--ghost" onClick={() => void markAllAired()}>
              Mark season games as watched
            </button>
          )}
        </div>

        {schedule.isLoading && <p className="muted">Loading schedule…</p>}
        {schedule.isError && <p className="badge badge--warn">Couldn’t load this schedule.</p>}
        {schedule.data && games.length === 0 && (
          <p className="muted">No games found for the {season} season.</p>
        )}

        <div className="hscroll episode-row">
          {games.map((g, i) => {
            const epNo = i + 1
            const watched = watchedSet.has(`${season}:${epNo}`)
            const vs = g.homeAway === 'away' ? 'at' : 'vs'
            // Races have no opponent — the summary carries the winner instead of a
            // matchup; the race name is already in the code line above.
            const summaryParts: string[] = []
            if (isRace) {
              if (g.winner) summaryParts.push(`🏁 ${g.winner}`)
            } else {
              summaryParts.push(
                g.opponent
                  ? `${vs} ${g.opponent.name}${g.opponent.record ? ` (${g.opponent.record})` : ''}`
                  : g.name,
              )
            }
            if (g.broadcast) summaryParts.push(`on ${g.broadcast}`)
            const air = sportAirState(g.date, g.completed)
            const gameUrl = isRace ? espnRaceUrl(league, g.id) : espnGameUrl(league.key, g.id, g.date)
            const openGame = () => {
              if (gameUrl) window.open(gameUrl, '_blank', 'noopener,noreferrer')
            }
            return (
              <div
                key={g.id}
                className="ep-card"
                role="button"
                tabIndex={0}
                onClick={openGame}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    openGame()
                  }
                }}
              >
                {g.opponent?.logo ? (
                  <img className="ep-card__still ep-card__still--logo" src={g.opponent.logo} alt="" loading="lazy" />
                ) : (
                  <div className="ep-card__still ep-card__still--ph">{league.emoji}</div>
                )}
                <div className="ep-card__body">
                  <span className="ep-card__code">
                    {g.week ? `${g.week} • ` : ''}
                    {g.name}
                  </span>
                  {g.date && (
                    <span
                      className={`ep-card__datepill${air === 'upcoming' ? ' ep-card__datepill--upcoming' : ''}`}
                    >
                      {g.date.slice(0, 10)}
                    </span>
                  )}
                  <p className="ep-card__summary muted">{summaryParts.join(' · ')}</p>
                  {g.result && (
                    <span
                      className={`ep-card__result ${g.result.won ? 'sport-win' : 'sport-loss'}`}
                    >
                      {g.result.won ? 'WIN' : 'LOSS'} {g.result.us}–{g.result.them}
                    </span>
                  )}
                  {air === 'upcoming' ? (
                    <span className="ep-card__upcoming">Upcoming</span>
                  ) : air === 'unaired' ? (
                    <span className="ep-card__upcoming ep-card__unaired">Unaired</span>
                  ) : (
                    !readOnly && (
                      <label
                        className="ep-card__watched"
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={watched}
                          onChange={() =>
                            void (watched
                              ? markEpisode(itemId, season, epNo, false)
                              : markGameWithCatchUp(itemId, season, epNo))
                          }
                        />
                        {watched ? 'Watched' : 'Mark watched'}
                      </label>
                    )
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {item && (
        <button
          className="btn btn--danger"
          onClick={() =>
            void appConfirm(`Remove "${item.title}" and its watch history?`, {
              confirmLabel: 'Remove',
              cancelLabel: 'Cancel',
            }).then((ok) => {
              if (ok) void removeItem(item.id)
            })
          }
        >
          Remove from library
        </button>
      )}
    </div>
  )
}
