import { useRef } from 'react'
import type { DragEvent } from 'react'
import { resizeImageToDataUrl } from '../utils/image'

/** Shared upload icon (also used for ad-hoc dropzones outside this component). */
export function UploadIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  )
}

/**
 * A reusable image field: shows the current image with a "−" remove button in the
 * bottom-right corner, or — when empty — a click/drop upload zone (upload icon +
 * label + hint). Files are downscaled/compressed to a base64 data URL before being
 * handed back via onChange(dataUrl); onChange(null) clears. `shapeClass` sets the
 * frame (poster, wide, circle). Used for list poster/backdrop and the Stats avatar.
 */
export default function ImageDrop({
  value,
  onChange,
  maxW,
  maxH,
  label,
  hint,
  shapeClass = '',
  alt = '',
}: {
  value?: string
  onChange: (dataUrl: string | null) => void
  maxW: number
  maxH: number
  label: string
  hint?: string
  shapeClass?: string
  alt?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFile(file: File | undefined): Promise<void> {
    if (!file) return
    try {
      onChange(await resizeImageToDataUrl(file, maxW, maxH))
    } catch {
      // Ignore an unsupported/corrupt file — the control just doesn't change.
    }
  }

  return (
    <div
      className={`img-drop ${shapeClass}`.trim()}
      onDragOver={(e: DragEvent) => e.preventDefault()}
      onDrop={(e: DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        void handleFile(e.dataTransfer.files?.[0])
      }}
    >
      {value ? (
        <>
          <img className="img-drop__img" src={value} alt={alt} />
          <button
            type="button"
            className="img-drop__remove"
            title={`Remove ${label.toLowerCase()}`}
            aria-label={`Remove ${label.toLowerCase()}`}
            onClick={() => onChange(null)}
          >
            −
          </button>
        </>
      ) : (
        <button
          type="button"
          className="img-drop__zone"
          onClick={() => inputRef.current?.click()}
          title={`Upload ${label.toLowerCase()}`}
        >
          <UploadIcon />
          <span className="img-drop__label">{label}</span>
          {hint && <span className="img-drop__hint">{hint}</span>}
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          void handleFile(e.target.files?.[0])
          e.target.value = ''
        }}
      />
    </div>
  )
}
