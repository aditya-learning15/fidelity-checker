import fetch from 'node-fetch'
import { fileURLToPath } from 'url'

const FIGMA_API_BASE = 'https://api.figma.com/v1'

/**
 * Parse a Figma frame URL and extract the fileKey and nodeId.
 *
 * Supports:
 *   https://www.figma.com/file/FILEKEY/Title?node-id=NODEID
 *   https://www.figma.com/design/FILEKEY/Title?node-id=NODEID
 *
 * @param {string} url
 * @returns {{ fileKey: string, nodeId: string }}
 */
export function parseFigmaUrl(url) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('Invalid URL format. Please provide a valid Figma frame URL.')
  }

  // Accept both /file/ and /design/ path prefixes
  const pathMatch = parsed.pathname.match(/^\/(file|design)\/([A-Za-z0-9]+)/)
  if (!pathMatch) {
    throw new Error(
      'Invalid Figma URL. Expected a link containing /file/ or /design/ in the path.'
    )
  }

  const fileKey = pathMatch[2]
  const rawNodeId = parsed.searchParams.get('node-id')

  if (!rawNodeId) {
    throw new Error(
      'No node-id found in URL. Open the frame in Figma, right-click it, and choose "Copy link".'
    )
  }

  // Figma encodes the colon separator in node IDs as either %3A or - in URLs.
  // Normalise to the colon form that the REST API expects.
  const nodeId = decodeURIComponent(rawNodeId).replace(/-/g, ':')

  return { fileKey, nodeId }
}

/**
 * Fetch the design properties of a specific Figma node.
 *
 * Uses /v1/files/:fileKey/nodes?ids=:nodeId (the targeted nodes endpoint) rather
 * than the full /v1/files/:fileKey file endpoint, which can be hundreds of MB.
 *
 * @param {string} fileKey
 * @param {string} nodeId  - colon-separated, e.g. "1234:5678"
 * @param {string} accessToken
 * @returns {Promise<object>}
 */
export async function fetchFigmaFrame(fileKey, nodeId, accessToken) {
  const url = `${FIGMA_API_BASE}/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}`

  let response
  try {
    response = await fetch(url, {
      headers: { 'X-Figma-Token': accessToken },
    })
  } catch {
    throw new Error('Could not reach Figma API')
  }

  if (response.status === 403) {
    throw new Error('Invalid Figma access token')
  }

  const data = await response.json()

  if (!response.ok) {
    throw new Error(`Figma API error: ${data.err ?? data.message ?? response.statusText}`)
  }

  const nodeData = data.nodes?.[nodeId]
  if (!nodeData) {
    throw new Error(
      "Frame not found. Check the URL and that it's a frame, not a page."
    )
  }

  const doc = nodeData.document
  return {
    name: doc.name,
    type: doc.type,
    fills: doc.fills ?? [],
    strokes: doc.strokes ?? [],
    effects: doc.effects ?? [],
    absoluteBoundingBox: doc.absoluteBoundingBox ?? null,
    children: doc.children ?? [],
  }
}

/**
 * Export a Figma frame as a 2× PNG and return the raw image buffer.
 *
 * @param {string} fileKey
 * @param {string} nodeId  - colon-separated, e.g. "1234:5678"
 * @param {string} accessToken
 * @returns {Promise<Buffer>}
 */
export async function exportFigmaFrameAsPng(fileKey, nodeId, accessToken) {
  // Step 1: Ask Figma to render the frame and give us a CDN URL.
  const renderUrl =
    `${FIGMA_API_BASE}/images/${fileKey}` +
    `?ids=${encodeURIComponent(nodeId)}&format=png&scale=2`

  let renderResponse
  try {
    renderResponse = await fetch(renderUrl, {
      headers: { 'X-Figma-Token': accessToken },
    })
  } catch {
    throw new Error('Could not reach Figma API')
  }

  if (renderResponse.status === 403) {
    throw new Error('Invalid Figma access token')
  }

  const renderData = await renderResponse.json()

  if (!renderResponse.ok || renderData.err) {
    throw new Error(
      `Figma images API error: ${renderData.err ?? renderResponse.statusText}`
    )
  }

  const imageUrl = renderData.images?.[nodeId]
  if (!imageUrl) {
    throw new Error(
      "Frame not found. Check the URL and that it's a frame, not a page."
    )
  }

  // Step 2: Download the rendered PNG from the CDN URL.
  let imageResponse
  try {
    imageResponse = await fetch(imageUrl)
  } catch {
    throw new Error('Could not reach Figma API')
  }

  if (!imageResponse.ok) {
    throw new Error(`Failed to download Figma image: ${imageResponse.statusText}`)
  }

  // node-fetch v3 removed .buffer(); use .arrayBuffer() and wrap in Buffer.
  const arrayBuffer = await imageResponse.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

// ---------------------------------------------------------------------------
// Smoke-test: node src/services/figmaService.js
// ---------------------------------------------------------------------------
const isMain = process.argv[1] === fileURLToPath(import.meta.url)
if (isMain) {
  const samples = [
    'https://www.figma.com/design/AbCdEfGhIjKl/My-Design?node-id=1-2',
    'https://www.figma.com/file/AbCdEfGhIjKl/My-Design?node-id=100%3A200',
    'https://www.figma.com/file/AbCdEfGhIjKl/My-Design',   // missing node-id → should error
    'not-a-url',                                            // bad URL → should error
  ]

  for (const url of samples) {
    try {
      console.log('Input :', url)
      console.log('Parsed:', parseFigmaUrl(url))
    } catch (err) {
      console.error('Error :', err.message)
    }
    console.log('---')
  }
}
