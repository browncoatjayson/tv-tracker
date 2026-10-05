import { imageUrl, type TmdbEpisode } from '../api/tmdb'

/** Expanded panel for one episode: still image, rating, overview, guest stars. */
export default function EpisodeDetails({ ep }: { ep: TmdbEpisode }) {
  const still = imageUrl(ep.still_path ?? undefined, 'w300')
  const guests = (ep.guest_stars ?? []).slice(0, 8).map((g) => g.name)
  return (
    <div className="ep-details">
      {still && <img className="ep-details__still" src={still} alt="" loading="lazy" />}
      <div className="ep-details__body">
        {ep.vote_average !== undefined && ep.vote_average > 0 && (
          <div className="ep-details__rating">★ {Math.round(ep.vote_average * 10)}%</div>
        )}
        {ep.overview ? (
          <p className="ep-details__overview">{ep.overview}</p>
        ) : (
          <p className="ep-details__overview muted">No description available.</p>
        )}
        {guests.length > 0 && (
          <p className="ep-details__guests muted">
            <strong>Guest stars:</strong> {guests.join(', ')}
          </p>
        )}
      </div>
    </div>
  )
}
