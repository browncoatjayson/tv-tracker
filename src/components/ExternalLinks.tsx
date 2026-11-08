import { useState } from 'react'

/** The IMDb / TMDB / Trakt / ESPN link pills shown at the top-right of a detail
 *  hero, plus a Share pill that copies the page's deep link to the clipboard. */
export default function ExternalLinks({
  imdb,
  tmdb,
  trakt,
  espn,
}: {
  imdb?: string
  tmdb?: string
  trakt?: string
  espn?: string
}) {
  return (
    <div className="hero__links">
      {imdb && <Pill href={imdb} label="IMDb" />}
      {tmdb && <Pill href={tmdb} label="TMDB" />}
      {trakt && <Pill href={trakt} label="Trakt" />}
      {espn && <Pill href={espn} label="ESPN" />}
      <SharePill />
    </div>
  )
}

function Pill({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="ext-link"
      title={`Open on ${label}`}
    >
      {label} ↗
    </a>
  )
}

/**
 * Copies the current page's URL — a stable, TMDB-derived deep link (/item/<media>:<id>)
 * — to the clipboard, so it can be shared (e.g. by text). The recipient opens it
 * to the same title's page and can add it to their own library from there.
 */
function SharePill() {
  const [copied, setCopied] = useState(false)

  async function copyLink() {
    const url = window.location.href
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      // Fallback for browsers / insecure contexts without the async clipboard API.
      const ta = document.createElement('textarea')
      ta.value = url
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      try {
        document.execCommand('copy')
      } catch {
        // give up silently
      }
      document.body.removeChild(ta)
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  return (
    <button
      type="button"
      className="ext-link"
      style={{ cursor: 'pointer', fontFamily: 'inherit' }}
      title="Copy link to share"
      onClick={() => void copyLink()}
    >
      {copied ? 'Copied ✓' : 'Share 🔗'}
    </button>
  )
}
