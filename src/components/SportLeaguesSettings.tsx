import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { ESPN_LEAGUES, type EspnLeague } from '../api/espn'
import { setLeagueEnabled, useEnabledLeagues } from '../data/sportPrefs'
import { addSportTeam, sportItemId } from '../data/sports'
import { db } from '../data/db'

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

/** A racing series (e.g. NASCAR) is a single trackable item — there's no team to
 *  search for — so it gets a "Track" button here instead of a filter toggle. */
function RaceLeagueChip({ lg }: { lg: EspnLeague }) {
  const id = sportItemId(lg.key, 'cup')
  const tracked = useLiveQuery(() => db.trackedItems.get(id).then((r) => !!r), [id])
  if (tracked) {
    return (
      <Link className="chip chip--on" to={`/item/${encodeURIComponent(id)}`}>
        {lg.label} ✓
      </Link>
    )
  }
  return (
    <button
      type="button"
      className="chip"
      onClick={() => void addSportTeam({ league: lg.key, teamId: 'cup', teamName: lg.label })}
    >
      + Track {lg.label}
    </button>
  )
}

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
                if (lg.kind === 'races') return <RaceLeagueChip key={k} lg={lg} />
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
