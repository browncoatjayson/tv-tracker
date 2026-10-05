import { useEffect, useState } from 'react'
import { getTraktUsername, isSignedIn } from '../api/trakt'

export interface TraktAuthState {
  signedIn: boolean
  username?: string
}

/** Reactive Trakt sign-in state; updates on the `tvtracker:trakt` event. */
export function useTraktAuth(): TraktAuthState {
  const [state, setState] = useState<TraktAuthState>(() => ({
    signedIn: isSignedIn(),
    username: getTraktUsername(),
  }))
  useEffect(() => {
    const update = () => setState({ signedIn: isSignedIn(), username: getTraktUsername() })
    window.addEventListener('tvtracker:trakt', update)
    window.addEventListener('storage', update)
    return () => {
      window.removeEventListener('tvtracker:trakt', update)
      window.removeEventListener('storage', update)
    }
  }, [])
  return state
}
