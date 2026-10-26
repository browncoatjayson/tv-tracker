import { Link, useParams } from 'react-router-dom'
import ShowDetail from './ShowDetail'
import MovieDetail from './MovieDetail'
import SportDetail from './SportDetail'

/** Routes /item/:id to the show, movie, or sport detail view. */
export default function ItemDetail() {
  const { id = '' } = useParams()
  const itemId = decodeURIComponent(id)
  const [mediaPart, tmdbPart] = itemId.split(':')

  // Sports use a non-numeric id (e.g. "sport:cfb-158"), so branch before the
  // tmdbId parse that movies/shows rely on.
  if (mediaPart === 'sport') {
    return <SportDetail itemId={itemId} />
  }

  const tmdbId = Number(tmdbPart)

  if (!Number.isFinite(tmdbId) || tmdbId <= 0) {
    return (
      <div className="placeholder">
        <p>Unknown title.</p>
        <Link to="/library">← Back to Library</Link>
      </div>
    )
  }

  return mediaPart === 'movie' ? (
    <MovieDetail itemId={itemId} tmdbId={tmdbId} />
  ) : (
    <ShowDetail itemId={itemId} tmdbId={tmdbId} />
  )
}
