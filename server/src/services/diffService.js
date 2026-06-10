import pixelmatch from 'pixelmatch'
import sharp from 'sharp'
import { alignImages, bufferToRawPixels } from './imageService.js'

// ---------------------------------------------------------------------------
// Color conversion helpers
// ---------------------------------------------------------------------------

function rgbStringToHex(rgbStr) {
  if (!rgbStr || typeof rgbStr !== 'string') return null
  const match = rgbStr.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)
  if (!match) return null
  const [, r, g, b] = match
  return '#' + [r, g, b].map(v => parseInt(v, 10).toString(16).padStart(2, '0')).join('').toUpperCase()
}

function hexToRgb(hex) {
  if (!hex || typeof hex !== 'string') return null
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16),
  } : null
}

function rgbToHsl(r, g, b) {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h, s, l = (max + min) / 2

  if (max === min) {
    h = s = 0
  } else {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break
      case g: h = ((b - r) / d + 2) / 6; break
      case b: h = ((r - g) / d + 4) / 6; break
    }
  }

  return { h: h * 360, s: s * 100, l: l * 100 }
}

// ---------------------------------------------------------------------------
// Property comparison helpers
// ---------------------------------------------------------------------------

function parseNumberValue(str) {
  if (!str) return null
  const num = parseFloat(str)
  return isNaN(num) ? null : num
}

function compareColors(figmaHex, domColor) {
  // Normalize both to lowercase hex
  const figmaHexLower = figmaHex?.toLowerCase()
  const domColorHex = rgbStringToHex(domColor)?.toLowerCase()

  if (!figmaHexLower || !domColorHex) return null
  if (figmaHexLower === domColorHex) return null  // identical

  // Convert to RGB then HSL for hue comparison
  const figmaRgb = hexToRgb(figmaHexLower)
  const domRgb = hexToRgb(domColorHex)

  if (!figmaRgb || !domRgb) return null

  const figmaHsl = rgbToHsl(figmaRgb.r, figmaRgb.g, figmaRgb.b)
  const domHsl = rgbToHsl(domRgb.r, domRgb.g, domRgb.b)

  const hueDelta = Math.abs(figmaHsl.h - domHsl.h)
  const normalizedHueDelta = Math.min(hueDelta, 360 - hueDelta)

  if (normalizedHueDelta > 30) {
    return { severity: 'critical', delta: `hue shift ${normalizedHueDelta.toFixed(0)}°` }
  }

  const saturationDelta = Math.abs(figmaHsl.s - domHsl.s)
  const lightnessDelta = Math.abs(figmaHsl.l - domHsl.l)

  if (saturationDelta > 15 || lightnessDelta > 15) {
    return { severity: 'major', delta: `shade difference` }
  }

  if (lightnessDelta > 5 || saturationDelta > 5) {
    return { severity: 'minor', delta: `slight shade variation` }
  }

  return null
}

// ---------------------------------------------------------------------------
// Canonical issue builder (single source of truth)
// ---------------------------------------------------------------------------

function buildDescription(category, property, figmaValue, domValue, delta) {
  if (category === 'color') {
    return `${property}: design ${figmaValue}, build ${domValue}`
  }
  const d = delta ? ` (off by ${delta})` : ''
  return `${property}: design ${figmaValue}, build ${domValue}${d}`
}

export function buildIssue({
  property, figmaValue, domValue, delta,
  category, severity, referencedElement
}) {
  return {
    property,
    figmaValue,
    domValue,
    delta: delta ?? null,
    category,
    severity,
    referencedElement: referencedElement ?? null,
    source: 'arithmetic',
    description: buildDescription(category, property, figmaValue, domValue, delta),
    suggestion: `Set ${property} to ${figmaValue} (currently ${domValue})`,
  }
}

/**
 * Run a pixel-level diff between a Figma frame export and a developer screenshot.
 *
 * The two images are first normalised to identical dimensions and PNG format
 * by alignImages(). pixelmatch then compares them pixel-by-pixel and writes a
 * diff image where:
 *   - matching pixels → greyscale (dimmed)
 *   - mismatching pixels → bright red (#FF0000)
 *
 * @param {Buffer} figmaBuffer      - Raw PNG/JPG buffer from Figma export
 * @param {Buffer} screenshotBuffer - Raw PNG/JPG buffer from user upload
 * @returns {Promise<{
 *   mismatchPercent:         number,   // rounded to 2 decimal places
 *   mismatchedPixels:        number,
 *   totalPixels:             number,
 *   diffImageBuffer:         Buffer,   // PNG of the red-highlighted diff
 *   alignedFigmaBuffer:      Buffer,   // PNG aligned to Figma dimensions
 *   alignedScreenshotBuffer: Buffer,   // PNG resized to match Figma dimensions
 *   dimensions:              { width: number, height: number }
 * }>}
 */
export async function runPixelDiff(figmaBuffer, screenshotBuffer) {
  // Step 1 — Normalise both images to the same dimensions and PNG format
  const aligned = await alignImages(figmaBuffer, screenshotBuffer)
  const { width, height } = aligned

  // Step 2 — Decode both PNGs into raw RGBA pixel arrays (4 bytes per pixel)
  const { data: figmaPixels }      = await bufferToRawPixels(aligned.figmaBuffer)
  const { data: screenshotPixels } = await bufferToRawPixels(aligned.screenshotBuffer)

  // Step 3 — Allocate the output buffer that pixelmatch will write into
  const totalPixels = width * height
  const diffRaw = Buffer.alloc(totalPixels * 4)

  // Step 4 — Run pixelmatch
  // threshold 0.1 → sensitive to clear differences, tolerates minor subpixel variance
  // includeAA: false → ignore antialiasing; those differences aren't actionable
  const mismatchedPixels = pixelmatch(
    figmaPixels,
    screenshotPixels,
    diffRaw,
    width,
    height,
    {
      threshold: 0.1,
      includeAA: false,
    }
  )

  // Step 5 — Mismatch percentage (capped display at 2 dp)
  const mismatchPercent = parseFloat(((mismatchedPixels / totalPixels) * 100).toFixed(2))

  // Step 6 — Re-encode the raw diff pixels back to PNG so the frontend can display it
  const diffImageBuffer = await sharp(diffRaw, {
    raw: { width, height, channels: 4 },
  })
    .png()
    .toBuffer()

  return {
    mismatchPercent,
    mismatchedPixels,
    totalPixels,
    diffImageBuffer,
    alignedFigmaBuffer: aligned.figmaBuffer,
    alignedScreenshotBuffer: aligned.screenshotBuffer,
    dimensions: { width, height },
  }
}

// ---------------------------------------------------------------------------
// Arithmetic diff: compare matched Figma elements against DOM
// ---------------------------------------------------------------------------

/**
 * Compare a matched Figma element against a DOM node and return property discrepancies.
 *
 * @param {object} match - { figmaElement, domNode, viewport, ... }
 * @returns {Array<{
 *   property: string,
 *   figmaValue: string,
 *   domValue: string,
 *   delta: string | null,
 *   category: 'color' | 'spacing' | 'typography' | 'radius',
 *   severity: 'critical' | 'major' | 'minor'
 * }>}
 */
export function computePropertyDiff(match) {
  if (!match || !match.figmaElement || !match.domNode) return []

  const issues = []
  const { figmaElement: figma, domNode: dom } = match

  console.log(`[computePropertyDiff] Comparing ${match.figmaName || 'unnamed'} (confidence: ${match.confidence})`)

  // PART 2 FIX: Gate arithmetic comparisons based on data quality
  const hasComputedStyles = match.hasComputedStyles ?? false
  const skipSpacingComparisons = !hasComputedStyles

  // --- Color comparison ---
  // Skip color comparison for VECTOR/icon elements.
  // SVG icon fill colors come from fill attributes (not CSS styles) that the bookmarklet
  // cannot read reliably. Comparing container's CSS color property against Figma icon fill
  // produces false positives. Icons render correctly in build despite color style mismatch.
  if (figma.type !== 'VECTOR' && figma.fills && figma.fills.length > 0) {
    const figmaColor = figma.fills[0]  // first fill

    // Non-icon elements: compare backgroundColor.
    const rawDomBg = dom.styles?.backgroundColor
    if (figmaColor && rawDomBg) {
      const colorDiff = compareColors(figmaColor, rawDomBg)
      if (colorDiff) {
        const domBgHex = rgbStringToHex(rawDomBg) ?? rawDomBg
        issues.push(buildIssue({
          property: 'backgroundColor',
          figmaValue: figmaColor,
          domValue: domBgHex,
          delta: colorDiff.delta,
          category: 'color',
          severity: colorDiff.severity,
        }))
      }
    }
  }

  // --- Typography: fontFamily ---
  if (figma.fontFamily && dom.styles?.fontFamily) {
    const figmaFam = figma.fontFamily.toLowerCase()
    const domFam = dom.styles.fontFamily.toLowerCase()

    if (!domFam.includes(figmaFam) && !figmaFam.includes(domFam.split(',')[0].trim())) {
      issues.push(buildIssue({
        property: 'fontFamily',
        figmaValue: figma.fontFamily,
        domValue: dom.styles.fontFamily,
        delta: null,
        category: 'typography',
        severity: 'major',
      }))
    }
  }

  // --- Typography: fontSize ---
  if (figma.fontSize != null && dom.styles?.fontSize) {
    const figmaSize = parseNumberValue(figma.fontSize.toString())
    const domSize = parseNumberValue(dom.styles.fontSize)

    if (figmaSize != null && domSize != null) {
      const delta = Math.abs(figmaSize - domSize)
      if (delta > 2) {
        issues.push(buildIssue({
          property: 'fontSize',
          figmaValue: `${figmaSize}px`,
          domValue: `${domSize}px`,
          delta: `${delta > 0 ? '+' : ''}${(domSize - figmaSize).toFixed(1)}px`,
          category: 'typography',
          severity: 'major',
        }))
      }
    }
  }

  // --- Typography: fontWeight ---
  if (figma.fontWeight != null && dom.styles?.fontWeight) {
    const figmaWeight = parseNumberValue(figma.fontWeight.toString())
    const domWeight = parseNumberValue(dom.styles.fontWeight)

    if (figmaWeight != null && domWeight != null) {
      const delta = Math.abs(figmaWeight - domWeight)
      if (delta >= 100) {
        issues.push(buildIssue({
          property: 'fontWeight',
          figmaValue: figmaWeight.toString(),
          domValue: domWeight.toString(),
          delta: `${delta}`,
          category: 'typography',
          severity: 'major',
        }))
      } else if (delta > 0 && delta < 100) {
        issues.push(buildIssue({
          property: 'fontWeight',
          figmaValue: figmaWeight.toString(),
          domValue: domWeight.toString(),
          delta: `${delta}`,
          category: 'typography',
          severity: 'minor',
        }))
      }
    }
  }

  // --- Spacing: padding ---
  // PART 2 FIX: Only generate padding issues if we have real computed styles
  // FIX 4: Skip padding comparison when DOM has 0px on all sides AND Figma element
  // has children — this is the "delegated spacing" pattern where the implementation
  // moves padding to child elements via utility classes. Visual result is identical.
  const domPaddingAllZero = (
    (dom.styles?.paddingTop    || '0px') === '0px' &&
    (dom.styles?.paddingRight  || '0px') === '0px' &&
    (dom.styles?.paddingBottom || '0px') === '0px' &&
    (dom.styles?.paddingLeft   || '0px') === '0px'
  )
  // Container types in Figma delegate padding to child elements in implementation.
  // namedElements doesn't carry a children array, so use type as proxy.
  const FIGMA_CONTAINER_TYPES = new Set(['FRAME', 'INSTANCE', 'COMPONENT', 'GROUP', 'COMPONENT_SET'])
  const figmaIsContainer = FIGMA_CONTAINER_TYPES.has(figma.type)
  const skipPaddingDelegation = domPaddingAllZero && figmaIsContainer

  if (!skipSpacingComparisons && !skipPaddingDelegation) {
    for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
    const figmaProp = `padding${side}`
    const domProp = `padding${side}`

    if (figma[figmaProp] != null && dom.styles?.[domProp]) {
      const figmaVal = parseNumberValue(figma[figmaProp].toString())
      const domVal = parseNumberValue(dom.styles[domProp])

      if (figmaVal != null && domVal != null) {
        // BUG 3 FIX: Skip if Figma value is not a "clean" number (scale artifact)
        // Clean numbers are within 0.5px of whole or half-pixel values
        const isClean = Number.isInteger(figmaVal) || Number.isInteger(figmaVal * 2)
        if (!isClean) {
          // Suspect scale artifact (e.g., 2.02px) — skip this comparison
          continue
        }

        // BUG 3 FIX: Skip implausible mismatches
        // If Figma is very small (<4px) but DOM is large (>16px), wrong node
        if (figmaVal < 4 && domVal > 16) {
          continue
        }

        const delta = Math.abs(figmaVal - domVal)
        // Skip implausible deltas — likely a mismatched element pair
        if (Math.abs(delta) > 50) continue

        if (delta > 6) {
          issues.push(buildIssue({
            property: figmaProp,
            figmaValue: `${figmaVal}px`,
            domValue: `${domVal}px`,
            delta: `${delta > 0 ? '+' : ''}${(domVal - figmaVal).toFixed(1)}px`,
            category: 'spacing',
            severity: 'major',
          }))
        } else if (delta > 3) {
          issues.push(buildIssue({
            property: figmaProp,
            figmaValue: `${figmaVal}px`,
            domValue: `${domVal}px`,
            delta: `${delta > 0 ? '+' : ''}${(domVal - figmaVal).toFixed(1)}px`,
            category: 'spacing',
            severity: 'minor',
          }))
        }
      }
    }
    }
  }

  // --- Border radius ---
  // PART 2 FIX: Skip if no computed styles available
  // BUG 2 FIX: Skip if cornerRadius >= 100 (sentinel for fully-rounded/pill shapes)
  if (!skipSpacingComparisons && figma.cornerRadius != null && dom.styles?.borderRadius) {
    const figmaRadius = parseNumberValue(figma.cornerRadius.toString())

    // Figma stores fully-rounded / pill-shaped corners as very large values (e.g., 999)
    // These are not literal radius values — skip comparison entirely
    if (figmaRadius >= 100) {
      // This is a pill/fully-rounded shape, not a precise radius. Do not compare.
    } else {
      const domRadiusStr = dom.styles.borderRadius
      // Extract first number from borderRadius (could be "4px" or "4px 4px 0 0", etc.)
      const domRadius = parseNumberValue(domRadiusStr.split(/\s+/)[0])

      if (figmaRadius != null && domRadius != null) {
        const delta = Math.abs(figmaRadius - domRadius)
        // Skip implausible deltas — likely a mismatched element pair
        if (Math.abs(delta) > 30) {
          // Skip this comparison; likely a mismatched element
        } else if (delta > 4) {
        issues.push(buildIssue({
          property: 'borderRadius',
          figmaValue: `${figmaRadius}px`,
          domValue: `${domRadius}px`,
          delta: `${delta > 0 ? '+' : ''}${(domRadius - figmaRadius).toFixed(1)}px`,
          category: 'layout',
          severity: 'major',
        }))
      } else if (delta > 2) {
        issues.push(buildIssue({
          property: 'borderRadius',
          figmaValue: `${figmaRadius}px`,
          domValue: `${domRadius}px`,
          delta: `${delta > 0 ? '+' : ''}${(domRadius - figmaRadius).toFixed(1)}px`,
          category: 'layout',
          severity: 'minor',
        }))
      }
      }
    }
  }

  if (issues.length > 0) {
    console.log(`[computePropertyDiff]   Found ${issues.length} discrepancies:`, issues.map(i => ({
      property: i.property,
      figmaValue: i.figmaValue,
      domValue: i.domValue,
      severity: i.severity,
      category: i.category,
    })))
  } else {
    console.log(`[computePropertyDiff]   No discrepancies found`)
  }

  return issues
}

// ---------------------------------------------------------------------------
// Bounding box: normalize DOM rects to 0-1 coordinates
// ---------------------------------------------------------------------------

/**
 * Convert a DOM node's rect to normalised 0-1 bounding box coordinates.
 *
 * @param {object} domNode - { rect: { x, y, w, h }, ... }
 * @param {object} viewport - { w, h }
 * @returns {object | null} { x, y, width, height } (0-1), or null if invalid
 */
export function buildDomBoundingBox(domNode, viewport) {
  if (!domNode?.rect || !viewport?.w || !viewport?.h) return null

  const { x, y, w, h } = domNode.rect

  if (x === undefined || y === undefined || w === undefined || h === undefined) return null
  if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(w) || Number.isNaN(h)) return null
  if (w === 0 || h === 0) return null

  return {
    x: Math.max(0, Math.min(1, x / viewport.w)),
    y: Math.max(0, Math.min(1, y / viewport.h)),
    width: Math.max(0, Math.min(1, w / viewport.w)),
    height: Math.max(0, Math.min(1, h / viewport.h)),
  }
}

// ---------------------------------------------------------------------------
// Diff regions: extract changed areas from pixel diff image
// ---------------------------------------------------------------------------

/**
 * Identify changed regions in a pixel diff image using cell-based clustering.
 *
 * @param {Buffer} diffImageBuffer - PNG buffer from runPixelDiff
 * @param {number} width - Image width in pixels
 * @param {number} height - Image height in pixels
 * @returns {Promise<Array<{ x, y, width, height, mismatchDensity }>>} (0-1 coords)
 */
export async function extractDiffRegions(diffImageBuffer, width, height) {
  if (!diffImageBuffer || !width || !height) {
    return []
  }

  try {
    // Step 1: Decode diff image to raw pixels
    const { data: pixelData } = await bufferToRawPixels(diffImageBuffer)

    // Step 2: Divide into 16×16 cells and identify active ones
    const cellSize = 16
    const colCount = Math.ceil(width / cellSize)
    const rowCount = Math.ceil(height / cellSize)
    const cellArea = cellSize * cellSize

    const activeCells = new Set()  // "row,col"

    for (let row = 0; row < rowCount; row++) {
      for (let col = 0; col < colCount; col++) {
        let mismatchPixels = 0

        // Count red pixels (R > 200, G < 80) in this cell
        const cellStartX = col * cellSize
        const cellEndX = Math.min(cellStartX + cellSize, width)
        const cellStartY = row * cellSize
        const cellEndY = Math.min(cellStartY + cellSize, height)

        for (let py = cellStartY; py < cellEndY; py++) {
          for (let px = cellStartX; px < cellEndX; px++) {
            const idx = (py * width + px) * 4
            const r = pixelData[idx]
            const g = pixelData[idx + 1]
            if (r > 200 && g < 80) {
              mismatchPixels++
            }
          }
        }

        // Mark active if > 8% of cell is mismatched
        if (mismatchPixels > cellArea * 0.08) {
          activeCells.add(`${row},${col}`)
        }
      }
    }

    if (activeCells.size === 0) return []

    // Step 3: BFS to group adjacent active cells
    const visited = new Set()
    const regions = []

    function bfs(startKey) {
      const group = new Set()
      const queue = [startKey]
      group.add(startKey)
      visited.add(startKey)

      while (queue.length > 0) {
        const [r, c] = queue.shift().split(',').map(Number)

        // Check 4 adjacent cells
        for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
          const nr = r + dr
          const nc = c + dc
          const key = `${nr},${nc}`

          if (
            nr >= 0 && nr < rowCount &&
            nc >= 0 && nc < colCount &&
            activeCells.has(key) &&
            !visited.has(key)
          ) {
            group.add(key)
            visited.add(key)
            queue.push(key)
          }
        }
      }

      return group
    }

    for (const key of activeCells) {
      if (!visited.has(key)) {
        const group = bfs(key)
        regions.push(group)
      }
    }

    // Step 4: Compute bounding boxes for each region
    const boxes = regions.map(group => {
      let minRow = rowCount, maxRow = 0
      let minCol = colCount, maxCol = 0

      for (const key of group) {
        const [r, c] = key.split(',').map(Number)
        minRow = Math.min(minRow, r)
        maxRow = Math.max(maxRow, r)
        minCol = Math.min(minCol, c)
        maxCol = Math.max(maxCol, c)
      }

      return { minRow, maxRow, minCol, maxCol }
    })

    // Step 5: Expand by 12px and merge overlapping
    const expandedBoxes = boxes.map(b => ({
      minPixelX: Math.max(0, b.minCol * cellSize - 12),
      maxPixelX: Math.min(width, (b.maxCol + 1) * cellSize + 12),
      minPixelY: Math.max(0, b.minRow * cellSize - 12),
      maxPixelY: Math.min(height, (b.maxRow + 1) * cellSize + 12),
    }))

    // Merge overlapping
    const merged = []
    for (const box of expandedBoxes) {
      let found = false
      for (const existing of merged) {
        // Check if boxes overlap
        if (
          box.minPixelX < existing.maxPixelX &&
          box.maxPixelX > existing.minPixelX &&
          box.minPixelY < existing.maxPixelY &&
          box.maxPixelY > existing.minPixelY
        ) {
          // Merge
          existing.minPixelX = Math.min(existing.minPixelX, box.minPixelX)
          existing.maxPixelX = Math.max(existing.maxPixelX, box.maxPixelX)
          existing.minPixelY = Math.min(existing.minPixelY, box.minPixelY)
          existing.maxPixelY = Math.max(existing.maxPixelY, box.maxPixelY)
          found = true
          break
        }
      }
      if (!found) merged.push(box)
    }

    // Step 6: Filter small boxes (< 400px²) and normalise
    const finalRegions = []

    for (const box of merged) {
      const pixelWidth = box.maxPixelX - box.minPixelX
      const pixelHeight = box.maxPixelY - box.minPixelY
      const area = pixelWidth * pixelHeight

      if (area < 400) continue  // Skip noise

      // Calculate mismatch density in this region
      let mismatchCount = 0
      let totalPixels = 0

      for (let py = box.minPixelY; py < box.maxPixelY; py++) {
        for (let px = box.minPixelX; px < box.maxPixelX; px++) {
          const idx = (py * width + px) * 4
          if (idx + 3 < pixelData.length) {
            const r = pixelData[idx]
            const g = pixelData[idx + 1]
            if (r > 200 && g < 80) {
              mismatchCount++
            }
            totalPixels++
          }
        }
      }

      const mismatchDensity = totalPixels > 0 ? mismatchCount / totalPixels : 0

      finalRegions.push({
        x: box.minPixelX / width,
        y: box.minPixelY / height,
        width: pixelWidth / width,
        height: pixelHeight / height,
        mismatchDensity: Math.round(mismatchDensity * 100) / 100,
      })
    }

    console.log(`[extractDiffRegions] Found ${finalRegions.length} changed regions`)
    return finalRegions
  } catch (err) {
    console.warn('[extractDiffRegions] Error processing diff image:', err.message)
    return []
  }
}
