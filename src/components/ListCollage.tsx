import { imageUrl } from '../api/tmdb'
import { isWatchNextId } from '../data/watchNext'
import type { ListItem } from '../data/types'

/** Poster for a list item: a TMDB path (shows/movies) or a full logo URL (sports). */
function posterSrc(it: ListItem): string | undefined {
  return it.mediaType === 'sport' ? it.poster : imageUrl(it.poster, 'w185')
}
function itemEmoji(it: ListItem): string {
  return it.mediaType === 'sport' ? '🏟️' : it.mediaType === 'movie' ? '🎬' : '📺'
}

/**
 * A 2:3 cover made from up to four of a list's member posters — the fallback
 * "cover" used on the Stats card and on the list page (view mode) when no custom
 * poster has been uploaded. Fills its container's width.
 */
export default function ListCollage({
  items,
  className = '',
}: {
  items: ListItem[]
  className?: string
}) {
  // The Watch Next shortcut isn't real artwork, so keep it out of the collage.
  const posters = items.filter((it) => !isWatchNextId(it.id)).slice(0, 4)
  return (
    <div className={`list-collage ${className}`.trim()} data-count={posters.length}>
      {posters.length === 0 ? (
        <span className="list-collage__empty" aria-hidden="true">
          📋
        </span>
      ) : (
        posters.map((it) => {
          const src = posterSrc(it)
          return src ? (
            <img key={it.id} className="list-collage__poster" src={src} alt="" loading="lazy" />
          ) : (
            <span
              key={it.id}
              className="list-collage__poster list-collage__poster--ph"
              aria-hidden="true"
            >
              {itemEmoji(it)}
            </span>
          )
        })
      )}
    </div>
  )
}
