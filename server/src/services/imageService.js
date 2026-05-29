import sharp from 'sharp'

/**
 * Validate that a buffer is a readable image and return its metadata.
 * Throws a descriptive error if sharp cannot decode it.
 *
 * @param {Buffer} buffer
 * @param {string} label  - "figma image" | "screenshot" — used in the error message
 * @returns {Promise<import('sharp').Metadata>}
 */
async function validateAndGetMeta(buffer, label) {
  try {
    return await sharp(buffer).metadata()
  } catch {
    throw new Error(`Invalid image data: ${label} could not be read`)
  }
}

// ---------------------------------------------------------------------------
// alignImages
// ---------------------------------------------------------------------------

/**
 * Resize the screenshot to exactly match the Figma frame dimensions, then
 * normalise both images to PNG so downstream consumers (pixelmatch, Gemini)
 * always receive the same format.
 *
 * @param {Buffer} figmaBuffer
 * @param {Buffer} screenshotBuffer
 * @returns {Promise<{
 *   figmaBuffer: Buffer,
 *   screenshotBuffer: Buffer,
 *   width: number,
 *   height: number
 * }>}
 */
export async function alignImages(figmaBuffer, screenshotBuffer) {
  // Validate both inputs before doing any work
  const figmaMeta = await validateAndGetMeta(figmaBuffer, 'figma image')
  await validateAndGetMeta(screenshotBuffer, 'screenshot')

  const { width, height } = figmaMeta

  // Convert Figma export to PNG (it arrives as PNG already, but normalise anyway)
  const alignedFigma = await sharp(figmaBuffer).png().toBuffer()

  // Resize screenshot to exact Figma dimensions — fit: 'fill' skips aspect-ratio
  // preservation, giving us a pixel-for-pixel comparable canvas
  const alignedScreenshot = await sharp(screenshotBuffer)
    .resize(width, height, { fit: 'fill' })
    .png()
    .toBuffer()

  return {
    figmaBuffer: alignedFigma,
    screenshotBuffer: alignedScreenshot,
    width,
    height,
  }
}

// ---------------------------------------------------------------------------
// bufferToBase64
// ---------------------------------------------------------------------------

/**
 * Encode a PNG buffer as a base64 data URI.
 * Synchronous — no sharp required.
 *
 * @param {Buffer} buffer
 * @returns {string}  "data:image/png;base64,..."
 */
export function bufferToBase64(buffer) {
  return `data:image/png;base64,${buffer.toString('base64')}`
}

// ---------------------------------------------------------------------------
// bufferToRawPixels
// ---------------------------------------------------------------------------

/**
 * Decode a PNG buffer into raw RGBA pixel data for pixelmatch.
 *
 * pixelmatch requires exactly 4 bytes per pixel (RGBA). We force 4 channels
 * explicitly because sharp defaults to 3 (RGB) for opaque PNGs, which would
 * silently produce an incorrect byte-length and corrupt the diff output.
 *
 * @param {Buffer} buffer
 * @returns {Promise<{ data: Buffer, info: { width: number, height: number, channels: number } }>}
 */
export async function bufferToRawPixels(buffer) {
  const { data, info } = await sharp(buffer)
    .ensureAlpha()   // promote RGB → RGBA so channels is always 4
    .raw()
    .toBuffer({ resolveWithObject: true })

  return { data, info }
}
