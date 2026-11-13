import { useEffect, useState } from 'react'
import { getWatchNextFav } from './profileImages'

// ---------------------------------------------------------------------------
// The "Watch Next" shortcut — a pinnable pseudo-item that stands in for the
// Search page's random-episode shuffler. It can be favorited (shown in Library
// Favorites) or dropped into a custom list; either way it's a single well-known
// sentinel rather than a real title, so everywhere a title id is rendered or
// opened we special-case this id to show the blue shuffle card and, on click,
// jump to Search and roll a fresh suggestion.
// ---------------------------------------------------------------------------

/** Reserved id for the Watch Next shortcut (real ids are `<type>:<tmdbId>`). */
export const WATCH_NEXT_ID = 'watchnext'
export const WATCH_NEXT_TITLE = 'Watch Next'
/** Link target that opens Search, clears the filter, and rolls a suggestion. */
export const WATCH_NEXT_LINK = '/search?shuffle=1'

export function isWatchNextId(id: string): boolean {
  return id === WATCH_NEXT_ID
}

/** Live read of the Watch Next favorite flag; updates on the profile event that
 *  setWatchNextFav (and sync) dispatch. */
export function useWatchNextFav(): boolean {
  const [on, setOn] = useState(getWatchNextFav)
  useEffect(() => {
    const sync = () => setOn(getWatchNextFav())
    window.addEventListener('tvtracker:profile', sync)
    return () => window.removeEventListener('tvtracker:profile', sync)
  }, [])
  return on
}
