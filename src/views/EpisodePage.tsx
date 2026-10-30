import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { db, episodeKey } from '../data/db'
import {
  getEpisodeDetails,
  getEpisodeImages,
  getEpisodeImdbId,
  imageUrl,
  watchNames,
} from '../api/tmdb'
import { getSeasonEpisodesCached, getTvDetailsCached } from '../data/episodeCache'
import { buildBrowseSequence } from '../data/specials'
import { hasTraktClientId, resolveTraktId } from '../api/trakt'
import { markEpisode, setEpisodeRating, setEpisodeWatchedDate } from '../data/library'
import { markWatchedWithCatchUp } from '../utils/watchActions'
import { airTimeOrDate, hasAiredByTime } from '../utils/airTime'
import { useShowAirstamps } from '../hooks/useShowAirstamps'
import ExternalLinks from '../components/ExternalLinks'
import { WherePills } from '../components/DetailHero'
import CastRow from '../components/CastRow'
import RatingRow from '../components/RatingRow'
import Reviews from '../components/Reviews'
import WatchedDateField from '../components/WatchedDateField'

const HOUR = 1000 * 60 * 60

export default function EpisodePage() {
  const { id = '', season = '', episode = '' } = useParams()
  const itemId = decodeURIComponent(id)
  const tmdbId = Number(itemId.split(':')[1])
  const seasonNum = Number(season)
  const episodeNum = Number(episode)
  const navigate = useNavigate()
  const valid =
    itemId.startsWith('show:') &&
    Number.isFinite(tmdbId) &&
    Number.isFinite(seasonNum) &&
    Number.isFinite(episodeNum)


  const epQuery = useQuery({
    queryKey: ['episode', tmdbId, seasonNum, episodeNum],
    queryFn: () => getEpisodeDetails(tmdbId, seasonNum, episodeNum),
    enabled: valid,
    staleTime: HOUR,
  })
  const ep = epQuery.data

  const show = useQuery({
    queryKey: ['tv', tmdbId],
    queryFn: () => getTvDetailsCached(itemId, tmdbId),
    enabled: valid,
    staleTime: HOUR,
  })
  const epImdb = useQuery({
    queryKey: ['episode-imdb', tmdbId, seasonNum, episodeNum],
    queryFn: () => getEpisodeImdbId(tmdbId, seasonNum, episodeNum),
    enabled: valid,
    staleTime: Infinity,
  })
  const traktRef = useQuery({
    queryKey: ['trakt-ref', 'show', tmdbId],
    queryFn: () => resolveTraktId('show', tmdbId),
    enabled: valid && hasTraktClientId(),
    staleTime: Infinity,
  })
  const epImages = useQuery({
    queryKey: ['episode-images', tmdbId, seasonNum, episodeNum],
    queryFn: () => getEpisodeImages(tmdbId, seasonNum, episodeNum),
    enabled: valid,
    staleTime: HOUR,
  })
  // Season-0 episodes (shared cache with the show page) so Prev/Next can weave
  // the narrative specials into the browse order between seasons.
  const hasSpecials = (show.data?.seasons ?? []).some(
    (s) => s.season_number === 0 && s.episode_count > 0,
  )
  const specialsQuery = useQuery({
    queryKey: ['season', tmdbId, 0],
    queryFn: () => getSeasonEpisodesCached(itemId, tmdbId, 0),
    enabled: valid && hasSpecials,
    staleTime: HOUR,
  })
  // The linear browse order: regular episodes with narrative specials interleaved.
  const browseSeq = useMemo(
    () => buildBrowseSequence(show.data?.seasons ?? [], specialsQuery.data),
    [show.data, specialsQuery.data],
  )

  const item = useLiveQuery(() => db.trackedItems.get(itemId).then((r) => r ?? null), [itemId])
  const epState = useLiveQuery(
    () => db.episodeStates.get(episodeKey(itemId, seasonNum, episodeNum)).then((r) => r ?? null),
    [itemId, seasonNum, episodeNum],
  )
  const inLibrary = !!item
  const airstampOf = useShowAirstamps(item?.imdbId)

  if (!valid) {
    return (
      <div className="placeholder">
        <p>Unknown episode.</p>
        <Link to="/library">← Back to Library</Link>
      </div>
    )
  }
  if (epQuery.isLoading) return <p className="muted">Loading episode…</p>
  if (epQuery.isError || !ep) {
    return (
      <div className="placeholder">
        <p className="badge badge--warn">
          {epQuery.error instanceof Error ? epQuery.error.message : 'Could not load this episode.'}
        </p>
        <Link to={`/item/${encodeURIComponent(itemId)}`}>← Back to show</Link>
      </div>
    )
  }

  const showTitle = item?.title ?? show.data?.name ?? 'Show'
  const showBackdrop = imageUrl(show.data?.backdrop_path ?? undefined, 'w1280')
  const still = imageUrl(ep.still_path ?? undefined, 'w500')
  const airstamp = airstampOf(seasonNum, episodeNum)
  const aired = hasAiredByTime(ep.air_date, airstamp)
  const watched = !!epState?.watched
  const average =
    typeof ep.vote_average === 'number' && ep.vote_average > 0 ? `★ ${ep.vote_average.toFixed(1)} / 10` : '—'
  const cast = ep.credits?.cast ?? []
  const guests = ep.credits?.guest_stars ?? ep.guest_stars ?? []
  const providers = show.data ? watchNames(show.data) : []
  const gallery = (epImages.data ?? []).slice(0, 10)

  // Prev/Next follow the browse order: regular episodes with narrative specials
  // woven in by air date. Extras aren't in that order (they're their own island),
  // so when we're on one — or before the data has loaded — we fall back to
  // stepping within the current season.
  const seqIdx = browseSeq.findIndex((e) => e.season === seasonNum && e.episode === episodeNum)
  let prevEp: { season: number; episode: number } | null = null
  let nextEp: { season: number; episode: number } | null = null
  if (seqIdx >= 0) {
    prevEp = seqIdx > 0 ? browseSeq[seqIdx - 1] : null
    nextEp = seqIdx < browseSeq.length - 1 ? browseSeq[seqIdx + 1] : null
  } else if (seasonNum === 0 && specialsQuery.data?.length) {
    // An Extra (or an undated special): step among the season-0 items by number.
    const nums = specialsQuery.data.map((e) => e.episode_number).sort((a, b) => a - b)
    const i = nums.indexOf(episodeNum)
    prevEp = i > 0 ? { season: 0, episode: nums[i - 1] } : null
    nextEp = i >= 0 && i < nums.length - 1 ? { season: 0, episode: nums[i + 1] } : null
  } else {
    // Details still loading: step within this season using its summary count.
    const cnt = show.data?.seasons?.find((s) => s.season_number === seasonNum)?.episode_count
    prevEp = episodeNum > 1 ? { season: seasonNum, episode: episodeNum - 1 } : null
    nextEp = cnt == null || episodeNum < cnt ? { season: seasonNum, episode: episodeNum + 1 } : null
  }

  const epPath = (t: { season: number; episode: number }) =>
    `/item/${encodeURIComponent(itemId)}/episode/${t.season}/${t.episode}`

  const links = {
    imdb: epImdb.data ? `https://www.imdb.com/title/${epImdb.data}/` : undefined,
    tmdb: `https://www.themoviedb.org/tv/${tmdbId}/season/${seasonNum}/episode/${episodeNum}`,
    trakt: traktRef.data?.slug
      ? `https://trakt.tv/shows/${traktRef.data.slug}/seasons/${seasonNum}/episodes/${episodeNum}`
      : undefined,
  }

  const directors = (ep.crew ?? []).filter((c) => c.job === 'Director').map((c) => c.name)
  const writers = (ep.crew ?? [])
    .filter((c) => c.job === 'Writer' || c.department === 'Writing')
    .map((c) => c.name)
  const facts: { label: string; value: string }[] = []
  if (directors.length) facts.push({ label: 'Directed by', value: [...new Set(directors)].join(', ') })
  if (writers.length) facts.push({ label: 'Written by', value: [...new Set(writers)].join(', ') })
  if (ep.air_date)
    facts.push({ label: aired ? 'Aired' : 'Airs', value: aired ? ep.air_date : airTimeOrDate(ep.air_date, airstamp) })
  if (ep.runtime) facts.push({ label: 'Runtime', value: `${ep.runtime} min` })
  if (guests.length) facts.push({ label: 'Guest stars', value: String(guests.length) })

  return (
    <div className="show-detail episode-page">
      <section className="hero episode-hero">
        {showBackdrop && <img className="hero__backdrop" src={showBackdrop} alt="" />}
        <div className="hero__overlay" />
        <div className="hero__topbar">
          <Link className="back-link" to={`/item/${encodeURIComponent(itemId)}`}>
            ← {showTitle}
          </Link>
          <ExternalLinks {...links} />
        </div>
        <div className="hero__body">
          <div className="episode-hero__poster">
            {still ? (
              <img className="episode-hero__still" src={still} alt="" loading="lazy" />
            ) : (
              <div className="episode-hero__still episode-hero__still--ph">📺</div>
            )}
            <nav className="episode-hero__nav" aria-label="Episode navigation">
              <button
                className="btn btn--small"
                disabled={!prevEp}
                onClick={() => prevEp && navigate(epPath(prevEp))}
              >
                ← Prev
              </button>
              <button
                className="btn btn--small"
                disabled={!nextEp}
                onClick={() => nextEp && navigate(epPath(nextEp))}
              >
                Next →
              </button>
            </nav>
          </div>
          <div className="hero__meta">
            <h2 className="hero__title">
              <span className="episode-page__num">
                S{ep.season_number}E{ep.episode_number}
              </span>{' '}
              {ep.name}
            </h2>
            <div className="genre-badges">
              <span className="genre-badge">{aired ? 'Aired' : 'Airs'}</span>
              {ep.air_date && (
                <span className="genre-badge">
                  {aired ? ep.air_date : airTimeOrDate(ep.air_date, airstamp)}
                </span>
              )}
              {ep.runtime ? <span className="genre-badge">{ep.runtime} min</span> : null}
            </div>
            <div className="hero__tags">
              <span>Episode</span>
              <WherePills providers={providers} />
            </div>
            {ep.overview && <p className="hero__overview">{ep.overview}</p>}
          </div>
        </div>
      </section>

      <section className="detail-actions">
        {inLibrary && (
          <div className="episode-watch">
            <button
              className="btn"
              disabled={!aired}
              onClick={() =>
                void (watched
                  ? markEpisode(itemId, seasonNum, episodeNum, false)
                  : markWatchedWithCatchUp(itemId, seasonNum, episodeNum))
              }
            >
              {watched ? '✓ Watched' : 'Mark as watched'}
            </button>
            {watched && (
              <WatchedDateField
                watchedAt={epState?.watchedAt}
                precision={epState?.watchedPrecision}
                onChange={(ms, p) =>
                  void setEpisodeWatchedDate(itemId, seasonNum, episodeNum, ms, p)
                }
                label="Watched on"
                className="episode__watched"
              />
            )}
          </div>
        )}
        <RatingRow
          userRating={epState?.userRating}
          average={average}
          canRate={inLibrary}
          emptyLabel="Add the show to rate"
          onPick={(n) => void setEpisodeRating(itemId, seasonNum, episodeNum, n)}
          onClear={() => void setEpisodeRating(itemId, seasonNum, episodeNum, undefined)}
        />
      </section>

      {cast.length > 0 ? (
        <CastRow
          title="Cast"
          leadLabel="Main cast"
          people={cast}
          extra={guests}
          extraLabel="Guest stars"
        />
      ) : (
        guests.length > 0 && <CastRow title="Cast" people={guests} />
      )}

      <section className="section">
        <h3 className="section-title">Extras</h3>
        {gallery.length > 0 && (
          <div className="gallery">
            {gallery.map((img) => (
              <a
                key={img.file_path}
                href={imageUrl(img.file_path, 'original')}
                target="_blank"
                rel="noopener noreferrer"
                className="gallery__item"
              >
                <img src={imageUrl(img.file_path, 'w300')} alt="" loading="lazy" />
              </a>
            ))}
          </div>
        )}

        {facts.length > 0 && (
          <details className="facts">
            <summary className="facts__summary">Fun facts</summary>
            <dl className="meta-list facts__list">
              {facts.map((f) => (
                <div key={f.label}>
                  <dt>{f.label}</dt>
                  <dd>{f.value}</dd>
                </div>
              ))}
            </dl>
          </details>
        )}
      </section>

      <Reviews target={{ mediaType: 'show', tmdbId, season: seasonNum, episode: episodeNum }} poweredBy />
    </div>
  )
}
