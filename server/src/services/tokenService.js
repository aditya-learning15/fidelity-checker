// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert Figma's 0–1 float RGB to an uppercase hex string e.g. "#3B82F6".
 */
function rgbToHex(r, g, b) {
  const h = (v) => Math.round(v * 255).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`.toUpperCase()
}

/**
 * Build a token object — keeps call-sites terse.
 */
function token(type, property, value, rawValue, nodeId, nodeName) {
  return { type, property, value, rawValue, nodeId, nodeName }
}

// ---------------------------------------------------------------------------
// Per-node extractors
// ---------------------------------------------------------------------------

function extractColors(node, tokens) {
  for (const source of ['fills', 'strokes']) {
    if (!Array.isArray(node[source])) continue

    for (const paint of node[source]) {
      // Skip hidden or non-solid paints
      if (paint.visible === false) continue
      if (paint.type !== 'SOLID' || !paint.color) continue

      const { r, g, b } = paint.color
      tokens.push(token(
        'color',
        source === 'fills' ? 'fill' : 'stroke',
        rgbToHex(r, g, b),
        paint.color,
        node.id ?? '',
        node.name ?? '',
      ))
    }
  }
}

function extractTypography(node, tokens) {
  if (node.type !== 'TEXT' || !node.style) return

  const { style } = node
  const id   = node.id   ?? ''
  const name = node.name ?? ''

  if (style.fontFamily) {
    tokens.push(token('typography', 'fontFamily', style.fontFamily, style.fontFamily, id, name))
  }

  if (style.fontSize != null) {
    tokens.push(token('typography', 'fontSize', `${style.fontSize}px`, style.fontSize, id, name))
  }

  if (style.fontWeight != null) {
    tokens.push(token('typography', 'fontWeight', String(style.fontWeight), style.fontWeight, id, name))
  }

  if (style.lineHeightPx != null) {
    tokens.push(token('typography', 'lineHeightPx', `${Math.round(style.lineHeightPx)}px`, style.lineHeightPx, id, name))
  }

  // Only emit letterSpacing when it's non-zero (0 is the default, not useful)
  if (style.letterSpacing != null && style.letterSpacing !== 0) {
    tokens.push(token('typography', 'letterSpacing', `${style.letterSpacing}px`, style.letterSpacing, id, name))
  }
}

function extractSpacing(node, tokens) {
  const id   = node.id   ?? ''
  const name = node.name ?? ''

  for (const prop of ['paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom']) {
    const v = node[prop]
    if (v != null && v > 0) {
      tokens.push(token('spacing', prop, `${v}px`, v, id, name))
    }
  }
}

function extractRadius(node, tokens) {
  const id   = node.id   ?? ''
  const name = node.name ?? ''

  // rectangleCornerRadii takes precedence — it's the per-corner breakdown
  if (Array.isArray(node.rectangleCornerRadii)) {
    const labels = [
      'borderTopLeftRadius',
      'borderTopRightRadius',
      'borderBottomRightRadius',
      'borderBottomLeftRadius',
    ]
    node.rectangleCornerRadii.forEach((v, i) => {
      if (v != null && v > 0) {
        tokens.push(token('radius', labels[i], `${v}px`, v, id, name))
      }
    })
    return
  }

  // Fall back to the uniform cornerRadius
  if (node.cornerRadius != null && node.cornerRadius > 0) {
    tokens.push(token('radius', 'cornerRadius', `${node.cornerRadius}px`, node.cornerRadius, id, name))
  }
}

// ---------------------------------------------------------------------------
// Tree walker
// ---------------------------------------------------------------------------

function walkNode(node, tokens) {
  if (!node || typeof node !== 'object') return

  extractColors(node, tokens)
  extractTypography(node, tokens)
  extractSpacing(node, tokens)
  extractRadius(node, tokens)

  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      walkNode(child, tokens)
    }
  }
}

// ---------------------------------------------------------------------------
// Named-element extraction
// ---------------------------------------------------------------------------

/**
 * Layer names that are generic Figma defaults — skip these so the AI only
 * receives meaningfully named elements (e.g. "Primary Button", "Job Card").
 */
const GENERIC = /^(Rectangle|Frame|Group|Vector|Ellipse|Line|Polygon|Star|Image)\s*\d*$/i

// Only filter if it matches GENERIC AND does not contain any of: Card, Title, Job, Button, Label, Input, Tag, Icon, Nav, Bar
const PRESERVE = /card|title|job|button|label|input|tag|icon|nav|bar/i

/** Depth-first walk that collects up to `limit` named elements. */
function walkNamedElements(node, results, limit, depth = 0) {
  const STRUCTURAL_MAX_DEPTH = 4  // structural containers extracted up to here
  const TEXT_MAX_DEPTH       = 8  // text nodes extracted up to here (hard ceiling)

  if (!node || typeof node !== 'object' || results.length >= limit) return
  if (depth > TEXT_MAX_DEPTH) return  // hard ceiling for all nodes

  // Skip hidden layers (only if explicitly marked as visible: false)
  if (node.visible === false) return

  const isTextNode = node.type === 'TEXT'

  // Selective depth: structural nodes stop being extracted past depth 4,
  // but we continue RECURSING through them to find TEXT children deeper.
  // TEXT nodes (like the "Title" at depth 5) are extracted up to depth 8.
  const shouldExtract = isTextNode ? depth <= TEXT_MAX_DEPTH : depth <= STRUCTURAL_MAX_DEPTH

  const name = (node.name ?? '').trim()

  // Extract named elements from any type, including GROUP and COMPONENT_SET
  // These types can contain meaningful child elements (Job Title, Job ID, etc.)
  if (shouldExtract && name && (!GENERIC.test(name) || PRESERVE.test(name))) {
    const el = { name, type: node.type ?? 'UNKNOWN' }

    // Solid fill colors
    const fills = []
    if (Array.isArray(node.fills)) {
      for (const fill of node.fills) {
        if (fill.visible !== false && fill.type === 'SOLID' && fill.color) {
          const { r, g, b } = fill.color
          fills.push(rgbToHex(r, g, b))
        }
      }
    }
    if (fills.length) el.fills = fills

    // Text content (from TEXT nodes)
    if (node.characters) {
      el.textContent = node.characters
    }

    // Typography (TEXT nodes only, but the fields may appear on others)
    if (node.style) {
      if (node.style.fontSize  != null) el.fontSize  = node.style.fontSize
      if (node.style.fontWeight != null) el.fontWeight = node.style.fontWeight
      if (node.style.fontFamily)         el.fontFamily = node.style.fontFamily
    }

    // Corner radius — per-corner array takes precedence
    // BUG 2 FIX: Mark as pill if cornerRadius >= 100 (fully-rounded sentinel)
    const cr = Array.isArray(node.rectangleCornerRadii)
      ? node.rectangleCornerRadii[0]   // use TL as representative value
      : node.cornerRadius
    if (cr != null && cr > 0) {
      if (cr >= 100) {
        // Fully-rounded / pill shape, not a literal radius
        el.isPill = true
        // Don't store the literal large value
      } else {
        el.cornerRadius = cr
      }
    }

    // Padding (skip zero values to keep the payload lean)
    for (const p of ['paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom']) {
      if (node[p] != null && node[p] > 0) el[p] = node[p]
    }

    // Dimensions
    if (node.absoluteBoundingBox) {
      el.width  = Math.round(node.absoluteBoundingBox.width)
      el.height = Math.round(node.absoluteBoundingBox.height)
    }

    results.push(el)
  }

  // Recurse into children of container types.
  // IMPORTANT: always recurse even past STRUCTURAL_MAX_DEPTH — we may need to
  // descend through deep structural containers to reach TEXT leaf nodes.
  // The TEXT_MAX_DEPTH hard ceiling stops runaway recursion.
  if (Array.isArray(node.children)) {
    const containerTypes = new Set(['FRAME', 'INSTANCE', 'COMPONENT', 'GROUP', 'COMPONENT_SET', 'BOOLEAN_OPERATION', 'SYMBOL'])
    if (node.type && containerTypes.has(node.type)) {
      for (const child of node.children) {
        if (results.length >= limit) break
        walkNamedElements(child, results, limit, depth + 1)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Public export — named elements
// ---------------------------------------------------------------------------

/**
 * Walk a Figma node tree and return up to 60 meaningfully named elements with
 * their key design properties (fills, typography, radius, padding, dimensions).
 *
 * Generic auto-named layers (Rectangle 1, Frame 3, etc.) are skipped so the
 * AI only receives semantically meaningful nodes.
 *
 * @param {object} figmaNodeJson - Root node from fetchFigmaFrame()
 * @returns {Array<{
 *   name:          string,
 *   type:          string,
 *   fills?:        string[],
 *   fontSize?:     number,
 *   fontWeight?:   number,
 *   fontFamily?:   string,
 *   cornerRadius?: number,
 *   paddingLeft?:  number,
 *   paddingRight?: number,
 *   paddingTop?:   number,
 *   paddingBottom?:number,
 *   width?:        number,
 *   height?:       number,
 * }>}
 */
export function extractNamedElements(figmaNodeJson) {
  const results = []
  // Cap at 35: only the most significant elements reach the Gemini prompt.
  // Prompt slims both Figma and DOM sides to top 35 by area — so >35 elements
  // are extracted here but only the first 35 are used in the matching prompt.
  walkNamedElements(figmaNodeJson, results, 35)
  console.log(`[tokenService] extractNamedElements: ${results.length} elements extracted`)
  return results
}

// ---------------------------------------------------------------------------
// Computed-styles helpers
// ---------------------------------------------------------------------------

/**
 * Convert a CSS "rgb(R, G, B)" or "rgba(R, G, B, A)" string to uppercase hex.
 * Returns null for transparent values or unrecognised strings.
 */
function rgbStringToHex(str) {
  if (!str || str === 'transparent') return null
  const m = str.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/)
  if (!m) return null
  const alpha = m[4] !== undefined ? parseFloat(m[4]) : 1
  if (alpha === 0) return null                            // fully transparent → skip
  const [, r, g, b] = m
  return '#' + [r, g, b].map(v => parseInt(v, 10).toString(16).padStart(2, '0')).join('').toUpperCase()
}

/**
 * Maps Figma-style token property names to their CSS computed-style equivalents
 * so diffTokenSets() can line them up correctly.
 */
const FIGMA_TO_CSS_PROP = {
  fill:                    'backgroundColor',
  lineHeightPx:            'lineHeight',
  cornerRadius:            'borderRadius',
  borderTopLeftRadius:     'borderRadius',
  borderTopRightRadius:    'borderRadius',
  borderBottomLeftRadius:  'borderRadius',
  borderBottomRightRadius: 'borderRadius',
}

function normaliseFigmaProp(prop) {
  return FIGMA_TO_CSS_PROP[prop] ?? prop
}

/** Recursively walk a computed-styles tree node and emit flat tokens. */
function walkComputedNode(node, tokens) {
  if (!node || typeof node !== 'object') return

  const { tag = '', id = null, classes = null, styles = {} } = node

  const t = (type, property, value, rawValue) => ({
    type, property, value, rawValue,
    nodeTag: tag, nodeId: id, nodeClasses: classes,
  })

  // ── Colors ──
  if (styles.backgroundColor) {
    const hex = rgbStringToHex(styles.backgroundColor)
    if (hex) tokens.push(t('color', 'backgroundColor', hex, styles.backgroundColor))
  }
  if (styles.color) {
    const hex = rgbStringToHex(styles.color)
    if (hex) tokens.push(t('color', 'color', hex, styles.color))
  }

  // ── Typography ──
  if (styles.fontSize && styles.fontSize !== '0px') {
    tokens.push(t('typography', 'fontSize', styles.fontSize, styles.fontSize))
  }
  if (styles.fontFamily) {
    const primary = styles.fontFamily.split(',')[0].trim().replace(/['"]/g, '')
    tokens.push(t('typography', 'fontFamily', primary, styles.fontFamily))
  }
  if (styles.fontWeight) {
    tokens.push(t('typography', 'fontWeight', String(styles.fontWeight), styles.fontWeight))
  }
  if (styles.lineHeight && styles.lineHeight !== 'normal') {
    tokens.push(t('typography', 'lineHeight', styles.lineHeight, styles.lineHeight))
  }
  if (styles.letterSpacing && styles.letterSpacing !== '0px' && styles.letterSpacing !== 'normal') {
    tokens.push(t('typography', 'letterSpacing', styles.letterSpacing, styles.letterSpacing))
  }

  // ── Spacing ──
  for (const prop of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft']) {
    if (styles[prop] && styles[prop] !== '0px') {
      tokens.push(t('spacing', prop, styles[prop], styles[prop]))
    }
  }
  if (styles.gap && styles.gap !== '0px' && styles.gap !== 'normal') {
    tokens.push(t('spacing', 'gap', styles.gap, styles.gap))
  }

  // ── Radius ──
  if (styles.borderRadius && styles.borderRadius !== '0px') {
    tokens.push(t('radius', 'borderRadius', styles.borderRadius, styles.borderRadius))
  }

  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      walkComputedNode(child, tokens)
    }
  }
}

// ── diff helpers ──

function findClosestValue(target, candidates) {
  const tNum = parseFloat(target)
  if (isNaN(tNum)) return candidates[0]
  let best = candidates[0], bestDist = Infinity
  for (const c of candidates) {
    const d = Math.abs(tNum - parseFloat(c))
    if (!isNaN(d) && d < bestDist) { bestDist = d; best = c }
  }
  return best
}

function numericDelta(a, b) {
  const an = parseFloat(a), bn = parseFloat(b)
  if (isNaN(an) || isNaN(bn)) return null
  return Math.round(Math.abs(an - bn) * 10) / 10
}

// ---------------------------------------------------------------------------
// Public exports
// ---------------------------------------------------------------------------

/**
 * Recursively walk a Figma node tree and return a flat array of design tokens.
 *
 * @param {object} figmaNodeJson - A Figma node object (document from nodes API)
 * @returns {Array<{
 *   type: string, property: string, value: string,
 *   rawValue: any, nodeId: string, nodeName: string
 * }>}
 */
export function extractTokens(figmaNodeJson) {
  const tokens = []
  walkNode(figmaNodeJson, tokens)
  return tokens
}

/**
 * Parse the JSON tree produced by the Fidelity Extractor bookmarklet into a
 * flat token array with the same shape as extractTokens().
 *
 * @param {string|object} stylesJson - Raw JSON string or already-parsed object
 * @returns {Array<{
 *   type: string, property: string, value: string, rawValue: any,
 *   nodeTag: string, nodeId: string|null, nodeClasses: string|null
 * }>}
 */
export function parseComputedStyles(stylesJson) {
  const parsed = typeof stylesJson === 'string' ? JSON.parse(stylesJson) : stylesJson
  const tokens = []
  if (parsed?.tree) walkComputedNode(parsed.tree, tokens)
  return tokens
}

/**
 * Compare Figma design tokens against computed browser tokens.
 *
 * Property names from Figma are normalised (e.g. "fill" → "backgroundColor",
 * "lineHeightPx" → "lineHeight") before comparison so like-for-like values
 * can be matched.
 *
 * @param {ReturnType<typeof extractTokens>}      figmaTokens
 * @param {ReturnType<typeof parseComputedStyles>} computedTokens
 * @returns {{
 *   matches:       Array<{ type, property, figmaValue, computedValue }>,
 *   mismatches:    Array<{ type, property, figmaValue, computedValue, delta? }>,
 *   onlyInFigma:   Array<{ type, property, figmaValue }>,
 *   onlyInComputed:Array<{ type, property, computedValue }>,
 * }}
 */
export function diffTokenSets(figmaTokens, computedTokens) {
  // Index tokens by (type, normalisedProperty) → Set<value>
  const index = (tokens, normaliseProp) => {
    const map = new Map()
    for (const t of tokens) {
      const prop = normaliseProp ? normaliseFigmaProp(t.property) : t.property
      const key  = `${t.type}::${prop}`
      if (!map.has(key)) map.set(key, { type: t.type, property: prop, values: new Set() })
      map.get(key).values.add(t.value)
    }
    return map
  }

  const figmaIdx    = index(figmaTokens, true)
  const computedIdx = index(computedTokens, false)
  const allKeys     = new Set([...figmaIdx.keys(), ...computedIdx.keys()])

  const matches = [], mismatches = [], onlyInFigma = [], onlyInComputed = []

  for (const key of allKeys) {
    const fb = figmaIdx.get(key)
    const cb = computedIdx.get(key)
    const { type, property } = fb ?? cb

    if (!fb) {
      for (const v of cb.values) onlyInComputed.push({ type, property, computedValue: v })
      continue
    }
    if (!cb) {
      for (const v of fb.values) onlyInFigma.push({ type, property, figmaValue: v })
      continue
    }

    // Both sides have values — find exact matches then pair up remainders
    const remaining = new Set(cb.values)

    for (const fv of fb.values) {
      if (remaining.has(fv)) {
        matches.push({ type, property, figmaValue: fv, computedValue: fv })
        remaining.delete(fv)
      } else {
        const candidates = [...remaining]
        if (candidates.length === 0) {
          onlyInFigma.push({ type, property, figmaValue: fv })
        } else {
          const closest = findClosestValue(fv, candidates)
          const delta   = numericDelta(fv, closest)
          mismatches.push({
            type, property,
            figmaValue:    fv,
            computedValue: closest,
            ...(delta !== null ? { delta } : {}),
          })
          remaining.delete(closest)
        }
      }
    }

    for (const v of remaining) onlyInComputed.push({ type, property, computedValue: v })
  }

  return { matches, mismatches, onlyInFigma, onlyInComputed }
}

/**
 * Condense a flat token array into a deduplicated summary for the report.
 *
 * @param {ReturnType<typeof extractTokens>} tokens
 * @returns {{
 *   uniqueColors: string[],
 *   fontSizes: string[],
 *   fontFamilies: string[],
 *   borderRadii: string[],
 *   totalTokensExtracted: number
 * }}
 */
export function summariseTokens(tokens) {
  const unique = (type, property) => [
    ...new Set(
      tokens
        .filter(t => t.type === type && (property ? t.property === property : true))
        .map(t => t.value)
    ),
  ]

  return {
    uniqueColors:          unique('color'),
    fontSizes:             unique('typography', 'fontSize'),
    fontFamilies:          unique('typography', 'fontFamily'),
    borderRadii:           unique('radius'),
    totalTokensExtracted:  tokens.length,
  }
}
