// ---------------------------------------------------------------------------
// Client-side image downscale + compress, used for custom list artwork (poster
// and backdrop). Keeps uploads small enough to live in the separate list store
// (and sync as their own file later) without bloating anything. Everything runs
// in the browser — nothing is uploaded anywhere.
// ---------------------------------------------------------------------------

/**
 * Read an image File, downscale it to fit within `maxW`×`maxH` (preserving aspect
 * ratio; never upscales), and return a compressed JPEG as a base64 data URL.
 * Honours EXIF orientation. Throws on a non-image or a decode/canvas failure.
 */
export async function resizeImageToDataUrl(
  file: File,
  maxW: number,
  maxH: number,
  quality = 0.82,
): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Not an image file.')

  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    const scale = Math.min(1, maxW / bitmap.width, maxH / bitmap.height)
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas is not available.')
    // JPEG has no alpha — fill first so transparent PNGs don't come out black.
    ctx.fillStyle = '#0b1222'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(bitmap, 0, 0, width, height)
    return canvas.toDataURL('image/jpeg', quality)
  } finally {
    bitmap.close()
  }
}

/** Max dimensions for each image (bounding box; aspect is preserved). */
export const LIST_POSTER_MAX = { w: 600, h: 900 } // 2:3 poster
export const LIST_BANNER_MAX = { w: 1280, h: 720 } // landscape backdrop
export const PROFILE_AVATAR_MAX = { w: 256, h: 256 } // square-ish profile icon
