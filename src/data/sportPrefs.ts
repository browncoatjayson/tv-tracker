import { useSyncExternalStore } from 'react'
import { ESPN_LEAGUES } from '../api/espn'

// ---------------------------------------------------------------------------
// Which sport leagues the user wants to see. A lightweight per-device display
// preference (it only gates which filters/search results appear — the teams
// themselves live in trackedItems and sync), so it lives in localStorage rather
// than the synced Dexie store. College football + women's volleyball ship on.
// ---------------------------------------------------------------------------

const KEY = 'tvtracker.sportLeagues'
const DEFAULT_KEYS = ['cfb', 'wcvb']

/** Valid league keys, so a stale stored value can't surface a removed league. */
const VALID = new Set(ESPN_LEAGUES.map((l) => l.key))

function read(): string[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw === null) return DEFAULT_KEYS
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return DEFAULT_KEYS
    return parsed.filter((k): k is string => typeof k === 'string' && VALID.has(k))
  } catch {
    return DEFAULT_KEYS
  }
}

// useSyncExternalStore needs a stable snapshot reference between renders, or it
// loops — cache the array and only swap it when the stored value changes.
let cache: string[] = read()
const listeners = new Set<() => void>()

function emit() {
  cache = read()
  for (const l of listeners) l()
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  // Reflect changes made in other tabs too.
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) emit()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(cb)
    window.removeEventListener('storage', onStorage)
  }
}

export function getEnabledLeagues(): string[] {
  return cache
}

export function setEnabledLeagues(keys: string[]): void {
  const next = ESPN_LEAGUES.map((l) => l.key).filter((k) => keys.includes(k))
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // ignore (private mode / blocked storage)
  }
  emit()
}

export function setLeagueEnabled(key: string, on: boolean): void {
  const set = new Set(cache)
  if (on) set.add(key)
  else set.delete(key)
  setEnabledLeagues([...set])
}

/** Reactive list of enabled league keys (in registry order). */
export function useEnabledLeagues(): string[] {
  return useSyncExternalStore(subscribe, getEnabledLeagues, getEnabledLeagues)
}
