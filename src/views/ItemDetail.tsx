import { Link, useParams } from 'react-router-dom'
import ShowDetail from './ShowDetail'
import MovieDetail from './MovieDetail'

/** Routes /item/:id to the show or movie detail view (both handle preview mode). */
export default function ItemDetail() {
  const { id = '' } = useParams()
  const itemId = decodeURIComponent(id)
  const [mediaPart, tmdbPart] = itemId.split(':')
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
