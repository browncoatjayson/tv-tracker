import { useEffect, useState } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { getUniverse } from '../api/wikidata'
import { getTitleBrief, imageUrl, type TmdbCollectionPart } from '../api/tmdb'
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
 * The title's franchise, styled like "You might also like". It unifies two
 * sources into one group: the TMDB movie collection (for movies) and the
 * Wikidata shared universe (cross-media — e.g. the Chucky series shown with the
 * Child's Play films). The current title is highlighted in place; the franchise
 * name links to a Search for the whole set. Renders nothing if < 2 titles.
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
  })

  // Tag the library item with its franchise so series: matches across media.
  useEffect(() => {
    if (itemId && uni.data?.name) void setItemMeta(itemId, { universe: uni.data.name })
  }, [itemId, uni.data?.name])

  // Base: the TMDB collection films (already have posters + release order).
  const base: RelItem[] = (collection?.parts ?? [])
    .filter((p) => p.poster_path)
    .map((p) => ({
      key: `movie:${p.id}`,
      tmdbId: p.id,
      mediaType: 'movie',
      title: p.title,
      year: p.release_date ? Number(p.release_date.slice(0, 4)) || undefined : undefined,
      poster: p.poster_path,
    }))
  const have = new Set(base.map((b) => b.key))

  // Extras: Wikidata siblings not already in the collection — need poster lookups.
  const extras = (uni.data?.members ?? []).filter((m) => !have.has(`${m.mediaType}:${m.tmdbId}`))
  const briefs = useQueries({
    queries: extras.map((m) => ({
      queryKey: ['title-brief', m.mediaType, m.tmdbId],
      queryFn: () => getTitleBrief(m.mediaType === 'show' ? 'tv' : 'movie', m.tmdbId),
      staleTime: DAY,
    })),
  })
  const extraItems: RelItem[] = extras
    .map((m, i): RelItem | null => {
      const b = briefs[i]?.data
      return b
        ? {
            key: `${m.mediaType}:${m.tmdbId}`,
            tmdbId: m.tmdbId,
            mediaType: m.mediaType,
            title: b.title,
            year: b.year,
            poster: b.posterPath,
          }
        : null
    })
    .filter((x): x is RelItem => x !== null)
    .sort((a, b) => (a.year ?? 0) - (b.year ?? 0))

  const all = [...base, ...extraItems]
  const name = collection?.name.replace(/\s+Collection$/i, '') || uni.data?.name
  if (all.length < 2 || !name) return null

  const usedTmdb = base.length > 0
  const usedWiki = extraItems.length > 0
  const powered = usedTmdb && usedWiki ? 'TMDB · Wikidata' : usedWiki ? 'Wikidata' : 'TMDB'

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
