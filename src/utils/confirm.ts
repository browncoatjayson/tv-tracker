// A tiny promise-based confirm, rendered by <ConfirmHost/> as an in-app toast
// (styled like the "new version available" prompt) instead of a native
// window.confirm — which looks out of place and can be blocked by the browser.
// Callable from non-React code (e.g. watchActions) as well as components.

export interface ConfirmRequest {
  id: number
  message: string
  confirmLabel: string
  cancelLabel: string
  resolve: (ok: boolean) => void
}

type Listener = (req: ConfirmRequest) => void

let listener: Listener | null = null
let seq = 0

/** Registered by the mounted ConfirmHost; internal. */
export function _setConfirmListener(l: Listener | null): void {
  listener = l
}

/**
 * Ask the user to confirm an action. Resolves true (confirm) or false (cancel).
 * Falls back to the native dialog if no host is mounted (e.g. in tests).
 */
export function appConfirm(
  message: string,
  opts?: { confirmLabel?: string; cancelLabel?: string },
): Promise<boolean> {
  return new Promise((resolve) => {
    if (!listener) {
      resolve(window.confirm(message))
      return
    }
    listener({
      id: ++seq,
      message,
      confirmLabel: opts?.confirmLabel ?? 'Yes',
      cancelLabel: opts?.cancelLabel ?? 'No',
      resolve,
    })
  })
}
