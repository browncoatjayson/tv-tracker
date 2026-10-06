import { useEffect, useState } from 'react'
import { _setConfirmListener, type ConfirmRequest } from '../utils/confirm'

/**
 * Renders the in-app confirm toast for {@link appConfirm}. Mounted once (in
 * Layout), it shows one request at a time with Yes/No buttons. Escape cancels.
 */
export default function ConfirmHost() {
  const [req, setReq] = useState<ConfirmRequest | null>(null)

  useEffect(() => {
    _setConfirmListener((r) => setReq(r))
    return () => _setConfirmListener(null)
  }, [])

  useEffect(() => {
    if (!req) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        req!.resolve(false)
        setReq(null)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [req])

  if (!req) return null

  const done = (ok: boolean) => {
    req.resolve(ok)
    setReq(null)
  }

  return (
    <div className="update-toast confirm-toast" role="alertdialog" aria-live="assertive">
      <span>{req.message}</span>
      <div className="confirm-toast__actions">
        <button className="btn btn--small btn--ghost" onClick={() => done(false)}>
          {req.cancelLabel}
        </button>
        <button className="btn btn--small" onClick={() => done(true)}>
          {req.confirmLabel}
        </button>
      </div>
    </div>
  )
}
