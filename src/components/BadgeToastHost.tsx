import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { _setBadgeToastListener, type BadgeToast } from '../utils/badgeToast'
import ToastOverlay from './ToastOverlay'

const SHOW_MS = 4500

/**
 * Renders badge-earned toasts (one at a time, queued) with a confetti burst.
 * Mounted once in Layout. Auto-dismisses; tapping dismisses early.
 */
export default function BadgeToastHost() {
  const [queue, setQueue] = useState<BadgeToast[]>([])
  const current = queue[0] ?? null

  useEffect(() => {
    _setBadgeToastListener((t) => setQueue((q) => [...q, t]))
    return () => _setBadgeToastListener(null)
  }, [])

  const dismiss = useCallback(() => setQueue((q) => q.slice(1)), [])

  // Freshly-earned toasts auto-dismiss; a re-shown (review) one waits for the
  // user, dismissed by OK, click-outside, or Escape.
  useEffect(() => {
    if (!current || current.review) return
    const timer = setTimeout(dismiss, SHOW_MS)
    return () => clearTimeout(timer)
  }, [current, dismiss])

  useEffect(() => {
    if (!current?.review) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [current, dismiss])

  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (!current || !canvasRef.current) return
    return burstConfetti(canvasRef.current)
  }, [current])

  if (!current) return null

  const review = !!current.review

  return (
    <ToastOverlay onBackdrop={dismiss}>
      <canvas ref={canvasRef} className="confetti-canvas" aria-hidden="true" />
      <div
        className="update-toast badge-toast"
        role={review ? 'alertdialog' : 'status'}
        aria-live={review ? 'assertive' : 'polite'}
        // Tapping a celebration toast dismisses it; a review toast ignores body
        // taps (OK / outside dismiss it) so it doesn't vanish on a stray click.
        onClick={review ? undefined : dismiss}
      >
        {current.badge ? (
          <>
            <span className="badge-toast__icon" aria-hidden="true">
              {current.badge.emoji}
            </span>
            <div className="badge-toast__text">
              <strong>Badge earned!</strong>
              <span>
                {current.badge.name} — {current.badge.description}
              </span>
              {review && current.earnedAt && (
                <span className="badge-toast__date muted">
                  Earned {new Date(current.earnedAt).toLocaleDateString()}
                </span>
              )}
            </div>
          </>
        ) : (
          <>
            <span className="badge-toast__icon" aria-hidden="true">
              🎉
            </span>
            <div className="badge-toast__text">
              <strong>Earned {current.count} badges!</strong>
              <Link to="/stats" onClick={(e) => e.stopPropagation()}>
                See them on your Stats page
              </Link>
            </div>
          </>
        )}
        {review && (
          <button className="btn btn--small badge-toast__ok" onClick={dismiss}>
            OK
          </button>
        )}
      </div>
    </ToastOverlay>
  )
}

/** A short, dependency-free confetti burst above the centered toast.
 *  Returns a cleanup that cancels the animation. */
function burstConfetti(canvas: HTMLCanvasElement): () => void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return () => {}
  const dpr = window.devicePixelRatio || 1
  const W = canvas.clientWidth || window.innerWidth
  const H = canvas.clientHeight || window.innerHeight
  canvas.width = W * dpr
  canvas.height = H * dpr
  ctx.scale(dpr, dpr)

  const colors = ['#f59e0b', '#10b981', '#38bdf8', '#ef4444', '#a855f7', '#ec4899']
  const originX = W / 2
  // Burst from a bit above the vertically-centered toast so it rains over it.
  const originY = H * 0.38
  const parts = Array.from({ length: 90 }, () => ({
    x: originX,
    y: originY,
    vx: (Math.random() - 0.5) * 9,
    vy: Math.random() * -7 - 2,
    g: 0.16 + Math.random() * 0.08,
    size: 4 + Math.random() * 5,
    color: colors[Math.floor(Math.random() * colors.length)],
    rot: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.4,
  }))

  const DURATION = 1700
  const start = performance.now()
  let raf = 0
  function frame(now: number) {
    const t = now - start
    ctx!.clearRect(0, 0, W, H)
    const fade = Math.max(0, 1 - t / DURATION)
    for (const p of parts) {
      p.vy += p.g
      p.x += p.vx
      p.y += p.vy
      p.rot += p.vr
      ctx!.save()
      ctx!.translate(p.x, p.y)
      ctx!.rotate(p.rot)
      ctx!.globalAlpha = fade
      ctx!.fillStyle = p.color
      ctx!.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6)
      ctx!.restore()
    }
    if (t < DURATION) raf = requestAnimationFrame(frame)
  }
  raf = requestAnimationFrame(frame)
  return () => cancelAnimationFrame(raf)
}
