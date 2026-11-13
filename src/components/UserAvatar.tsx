import { useEffect, useState } from 'react'
import { getGoogleProfile } from '../data/driveSync'
import { getProfileAvatar } from '../data/profileImages'

/** A simple user silhouette, shown when there's no avatar image. */
export function UserGlyph() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0 2c-4.42 0-8 2.69-8 6v1a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-1c0-3.31-3.58-6-8-6Z" />
    </svg>
  )
}

/**
 * The user's avatar, used everywhere (header button, Stats). Prefers a custom
 * uploaded avatar, falls back to the connected Google photo, then the silhouette.
 * Re-renders on 'tvtracker:profile' (fired when either the Google profile or the
 * custom avatar changes). `className` is applied to the image (or the placeholder
 * span), so callers control the size/shape.
 */
export default function UserAvatar({ className = '' }: { className?: string }) {
  const [, bump] = useState(0)
  useEffect(() => {
    const onChange = () => bump((n) => n + 1)
    window.addEventListener('tvtracker:profile', onChange)
    return () => window.removeEventListener('tvtracker:profile', onChange)
  }, [])

  const src = getProfileAvatar() ?? getGoogleProfile()?.picture
  return src ? (
    <img className={className} src={src} alt="" referrerPolicy="no-referrer" />
  ) : (
    <span className={`${className} user-avatar--ph`.trim()} aria-hidden="true">
      <UserGlyph />
    </span>
  )
}
