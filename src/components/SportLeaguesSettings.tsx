import { ESPN_LEAGUES } from '../api/espn'
import { setLeagueEnabled, useEnabledLeagues } from '../data/sportPrefs'

// Leagues grouped by sport for display, preserving registry order within each.
const GROUPS: { group: string; keys: string[] }[] = (() => {
  const order: string[] = []
  const byGroup = new Map<string, string[]>()
  for (const l of ESPN_LEAGUES) {
    if (!byGroup.has(l.group)) {
      byGroup.set(l.group, [])
      order.push(l.group)
    }
    byGroup.get(l.group)!.push(l.key)
  }
  return order.map((group) => ({ group, keys: byGroup.get(group)! }))
})()

const LABELS = new Map(ESPN_LEAGUES.map((l) => [l.key, l]))

/** Settings: pick which sport leagues to track. Gates the Game/Team filters and
 *  which teams Search surfaces. Defaults to College Football + Volleyball. */
export default function SportLeaguesSettings() {
  const enabled = useEnabledLeagues()
  const on = new Set(enabled)

  return (
    <section className="card">
      <h2>Sports</h2>
      <p className="muted">
        Choose which leagues to track. Only the leagues you pick show up in the Game filter and
        when searching for teams. This setting is per-device.
      </p>
      <div className="sport-leagues">
        {GROUPS.map(({ group, keys }) => (
          <div key={group} className="sport-leagues__group">
            <span className="sport-leagues__heading">{keys[0] && LABELS.get(keys[0])!.emoji} {group}</span>
            <div className="chip-row">
              {keys.map((k) => {
                const lg = LABELS.get(k)!
                const checked = on.has(k)
                return (
                  <button
                    key={k}
                    type="button"
                    className={`chip${checked ? ' chip--on' : ''}`}
                    aria-pressed={checked}
                    onClick={() => setLeagueEnabled(k, !checked)}
                  >
                    {lg.label}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
