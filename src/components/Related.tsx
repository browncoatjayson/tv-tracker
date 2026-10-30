import { useEffect, useState } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { getUniverse } from '../api/wikidata'
import { getKeywordUniverse, getTitleBrief, imageUrl, type TmdbCollectionPart } from '../api/tmdb'
import { setItemMeta } from '../data/library'

const DAY = 1000 * 60 * 60 * 24

interface RelItem {
  key: string
  tmdbId: number
  mediaType: 'movie' | 'show'
  title: string
  year?: number
  poster?: string | null
}

/**
 * The title's franchise / shared universe, styled like "You might also like".
 *
 * Primary source is Wikidata, narrowed to a sensibly sized group (so an MCU film
 * shows its phase, not all ~120 MCU titles — see getUniverse). When Wikidata has
 * nothing, it falls back to the TMDB movie collection plus any "named universe"
 * keyword group (MCU/DCEU/Arrowverse…), so more titles get *something*. The
 * current title is highlighted in place; the group name links to a Search for the
 * whole set. Renders nothing if < 2 titles.
 */
export default function Related({
  itemId,
  mediaType,
  tmdbId,
  collection,
}: {
  itemId?: string
  mediaType: 'movie' | 'show'
  tmdbId: number
  /** TMDB collection (movies only) — the franchise films, in release order. */
  collection?: { name: string; parts: TmdbCollectionPart[] } | null
}) {
  const [open, setOpen] = useState(false)

  const uni = useQuery({
    queryKey: ['universe', mediaType, tmdbId],
    queryFn: () => getUniverse(mediaType, tmdbId),
    staleTime: DAY,
    retry: 1,
    // A big-franchise query can time out on a cold Wikidata cache; the attempt
    // warms the cache server-side, so poll every 10s until it resolves (data
    // becomes a universe or a genuine null) rather than leaving the section blank.
    refetchInterval: (q) => (q.state.data === undefined ? 10_000 : false),
  })

  // The TMDB collection (movies) — a tight, curated film series with posters.
  const col: RelItem[] = (collection?.parts ?? [])
    .filter((p) => p.poster_path)
    .map((p) => ({
      key: `movie:${p.id}`,
      tmdbId: p.id,
      mediaType: 'movie',
      title: p.title,
      year: p.release_date ? Number(p.release_date.slice(0, 4)) || undefined : undefined,
      poster: p.poster_path,
    }))

  // Priority: a narrow Wikidata group (phase / small franchise) wins outright; a
  // curated collection beats a broad (wide) Wikidata franchise; the keyword group
  // is the last resort. So we only spend the Wikidata poster lookups when we'll
  // actually show them, and only fetch the keyword group when nothing else fits.
  const useWiki = !!uni.data && (uni.data.narrow || col.length < 2)
  // Only after Wikidata *succeeds* with no franchise — not on an error/timeout,
  // which should refetch later rather than commit to the keyword group.
  const needKeyword = uni.isSuccess && !uni.data && col.length < 2

  const kw = useQuery({
    queryKey: ['universe-kw', mediaType, tmdbId],
    queryFn: () => getKeywordUniverse(mediaType === 'show' ? 'tv' : 'movie', tmdbId),
    enabled: needKeyword,
    staleTime: DAY,
  })

  // Wikidata members carry only ids, so look up each one's poster/title/year.
  const wikiMembers = useWiki ? (uni.data?.members ?? []) : []
  const briefs = useQueries({
    queries: wikiMembers.map((m) => ({
      queryKey: ['title-brief', m.mediaType, m.tmdbId],
      queryFn: () => getTitleBrief(m.mediaType === 'show' ? 'tv' : 'movie', m.tmdbId),
      staleTime: DAY,
    })),
  })

  let name: string | undefined
  let members: RelItem[] = []
  let powered = 'TMDB'
  if (useWiki) {
    name = uni.data!.name
    powered = 'Wikidata'
    members = wikiMembers
      .map((m, i): RelItem | null => {
        const b = briefs[i]?.data
        return b
          ? { key: `${m.mediaType}:${m.tmdbId}`, tmdbId: m.tmdbId, mediaType: m.mediaType, title: b.title, year: b.year, poster: b.posterPath }
          : null
      })
      .filter((x): x is RelItem => x !== null)
  } else if (col.length >= 2) {
    members = col
    name = collection?.name?.replace(/\s+Collection$/i, '')
    powered = 'TMDB'
  } else if (kw.data) {
    members = kw.data.members.map((m) => ({
      key: `${m.mediaType}:${m.tmdbId}`,
      tmdbId: m.tmdbId,
      mediaType: m.mediaType,
      title: m.title,
      year: m.year,
      poster: m.posterPath,
    }))
    name = kw.data.name
    powered = 'Keywords'
  }
  members.sort((a, b) => (a.year ?? 0) - (b.year ?? 0))

  // Tag the library item with the resolved franchise so series: matches across media.
  useEffect(() => {
    if (itemId && name) void setItemMeta(itemId, { universe: name })
  }, [itemId, name])

  const all = members
  const hasContent = all.length >= 2 && !!name
  // Definitively no related group: every source has resolved with nothing.
  const resolvedEmpty =
    uni.isSuccess && !uni.data && col.length < 2 && (!needKeyword || (kw.isFetched && !kw.data))
  // Still working toward a result — a (possibly slow/retrying) Wikidata query, a
  // keyword lookup, or the Wikidata members' poster lookups.
  const working = !hasContent && !resolvedEmpty

  // Surface "Loading…" only once it's clearly slow, so fast titles — and ones
  // with no related group — don't flash a section that fills or vanishes at once.
  const [showSlow, setShowSlow] = useState(false)
  useEffect(() => {
    if (!working) return
    // A normal Wikidata lookup is ~2–4s; only surface "Loading…" past that, so it
    // flags the genuinely slow (cold-cache) case rather than every title.
    const t = window.setTimeout(() => setShowSlow(true), 4500)
    // Reset on title change / once a result arrives, so each title gets the delay.
    return () => {
      window.clearTimeout(t)
      setShowSlow(false)
    }
  }, [working, tmdbId])

  if (!hasContent) {
    if (!working || !showSlow) return null
    // Keep the section present with a "Loading…" label; the 10s poll fills it in.
    return (
      <details
        className="reviews reviews--recs"
        open={open}
        onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      >
        <summary className="reviews__summary">
          <span>
            Related · <span className="muted">Loading…</span>
          </span>
        </summary>
        <div className="reviews__body">
          <p className="muted related__loading">Finding related titles…</p>
        </div>
      </details>
    )
  }

  return (
    <details
      className="reviews reviews--recs"
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="reviews__summary">
        <span>
          Related ·{' '}
          <Link
            className="related__series"
            to={`/search?q=${encodeURIComponent(`series:${name}`)}`}
            onClick={(e) => e.stopPropagation()}
          >
            {name}
          </Link>
        </span>
        <span className="reviews__powered">Powered by {powered}</span>
      </summary>
      <div className="reviews__body">
        <div className="poster-grid">
          {all.map((it) => {
            const current = it.mediaType === mediaType && it.tmdbId === tmdbId
            const inner = (
              <>
                {it.poster ? (
                  <img
                    className="poster-card__img"
                    src={imageUrl(it.poster ?? undefined, 'w185')}
                    alt=""
                    loading="lazy"
                  />
                ) : (
                  <div className="poster-card__img poster-card__img--placeholder">
                    {it.mediaType === 'show' ? '📺' : '🎬'}
                  </div>
                )}
                <span className="poster-card__title">
                  {it.title}
                  {it.year ? <span className="muted"> ({it.year})</span> : null}{' '}
                  <span className="universe-tag" title={it.mediaType === 'show' ? 'TV show' : 'Movie'}>
                    {it.mediaType === 'show' ? '📺' : '🎬'}
                  </span>
                </span>
              </>
            )
            return current ? (
              <div key={it.key} className="poster-card poster-card--current" aria-current="page">
                {inner}
              </div>
            ) : (
              <Link
                key={it.key}
                to={`/item/${encodeURIComponent(`${it.mediaType}:${it.tmdbId}`)}`}
                className="poster-card"
              >
                {inner}
              </Link>
            )
          })}
        </div>
      </div>
    </details>
  )
}
