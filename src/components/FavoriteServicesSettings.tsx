import { SERVICES, toggleFavoriteService, useFavoriteServices } from '../data/services'

/** Pick the streaming services you subscribe to. Drives the Search
 *  "New on Your Services" section. Stored per device. */
export default function FavoriteServicesSettings() {
  const favorites = useFavoriteServices()
  const favSet = new Set(favorites)
  return (
    <section className="card">
      <h2>Favorite services</h2>
      <p className="muted">
        Star the services you subscribe to. The Search tab then shows a “New on Your Services”
        row with recent releases now streaming on them.
      </p>
      <div className="chip-row">
        {SERVICES.map((s) => {
          const on = favSet.has(s.value)
          return (
            <button
              key={s.value}
              type="button"
              className={`chip${on ? ' chip--on' : ''}`}
              aria-pressed={on}
              onClick={() => void toggleFavoriteService(s.value, !on)}
            >
              {on ? '★ ' : ''}
              {s.label}
            </button>
          )
        })}
      </div>
    </section>
  )
}
