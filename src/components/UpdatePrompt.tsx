import { useRegisterSW } from 'virtual:pwa-register/react'

/**
 * Shows a small toast when a new app version has been deployed, letting the user
 * reload to get it immediately (instead of waiting for a future cold start).
 */
export default function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  if (!needRefresh) return null

  return (
    <div className="update-toast" role="status">
      <span>A new version is available.</span>
      <button className="btn btn--small" onClick={() => void updateServiceWorker(true)}>
        Reload
      </button>
      <button className="btn btn--small btn--ghost" onClick={() => setNeedRefresh(false)}>
        Later
      </button>
    </div>
  )
}
