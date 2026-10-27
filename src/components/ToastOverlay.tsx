import type { ReactNode } from 'react'

/**
 * Centered, page-dimming shell shared by the app's toasts and prompts (the
 * update banner, confirm dialogs, and badge toasts). It fills the screen with a
 * slight dim and centers its child panel. A click on the dim area — but not on
 * the panel itself — runs `onBackdrop` (e.g. cancel / dismiss).
 */
export default function ToastOverlay({
  children,
  onBackdrop,
}: {
  children: ReactNode
  onBackdrop?: () => void
}) {
  return (
    <div
      className="toast-overlay"
      // Only a click on the backdrop itself counts — clicks that bubble up from
      // the panel or its buttons have a different target.
      onClick={(e) => {
        if (e.target === e.currentTarget) onBackdrop?.()
      }}
    >
      {children}
    </div>
  )
}
