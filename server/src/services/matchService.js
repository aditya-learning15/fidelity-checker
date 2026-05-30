import { GoogleGenerativeAI } from '@google/generative-ai'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SKIP_TAGS = new Set(['script', 'style', 'meta', 'head', 'html'])

// ---------------------------------------------------------------------------
// Part 1 — DOM tree flattening
// ---------------------------------------------------------------------------

/**
 * Build the path segment for a single node within its sibling list.
 * Format: {tag}{#id}{.firstClass} with optional :nth(index) suffix when
 * multiple siblings share the same tag+firstClass combination.
 */
function buildSegment(node, siblings) {
  const tag        = (node.tag ?? 'div').toLowerCase()
  const id         = node.id ? `#${node.id}` : ''
  const firstClass = node.classes
    ? `.${String(node.classes).split(/\s+/)[0]}`
    : ''

  const key      = tag + firstClass
  const sameKind = siblings.filter(s => {
    const t = (s.tag ?? 'div').toLowerCase()
    const c = s.classes ? `.${String(s.classes).split(/\s+/)[0]}` : ''
    return t + c === key
  })

  if (sameKind.length > 1) {
    const idx = sameKind.indexOf(node)
    return `${tag}${id}${firstClass}:nth(${idx})`
  }

  return `${tag}${id}${firstClass}`
}

/**
 * Recursively walk a DOM tree node and append flat descriptors to results.
 * SKIP_TAGS nodes are skipped entirely (no recursion into their children).
 */
function walkDom(node, parentPath, siblings, results) {
  if (!node || typeof node !== 'object') return

  const tag = (node.tag ?? '').toLowerCase()
  if (SKIP_TAGS.has(tag)) return

  const segment = buildSegment(node, siblings)
  const path    = parentPath ? `${parentPath} > ${segment}` : segment

  // Collect textContent — check several field names the bookmarklet might use
  let textContent = null
  const rawText = node.text ?? node.textContent ?? node.innerText
  if (rawText && typeof rawText === 'string' && rawText.trim()) {
    textContent = rawText.trim().slice(0, 60)
  } else if (Array.isArray(node.children)) {
    for (const child of node.children) {
      const ct = child.text ?? child.textContent ?? child.innerText
      if (ct && typeof ct === 'string' && ct.trim()) {
        textContent = ct.trim().slice(0, 60)
        break
      }
    }
  }

  const rect   = node.rect   ?? {}
  const styles = node.styles ?? {}

  results.push({
    path,
    tag,
    id:          node.id      ?? null,
    classes:     node.classes ?? null,
    textContent,
    rect: {
      x: rect.x                  ?? 0,
      y: rect.y                  ?? 0,
      w: rect.width ?? rect.w    ?? 0,
      h: rect.height ?? rect.h   ?? 0,
    },
    styles: {
      backgroundColor: styles.backgroundColor ?? '',
      color:           styles.color           ?? '',
      fontSize:        styles.fontSize        ?? '',
      fontFamily:      styles.fontFamily      ?? '',
      fontWeight:      styles.fontWeight      ?? '',
      paddingTop:      styles.paddingTop      ?? '',
      paddingRight:    styles.paddingRight    ?? '',
      paddingBottom:   styles.paddingBottom   ?? '',
      paddingLeft:     styles.paddingLeft     ?? '',
      borderRadius:    styles.borderRadius    ?? '',
      border:          styles.border          ?? '',
      display:         styles.display         ?? '',
      gap:             styles.gap             ?? '',
    },
  })

  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      walkDom(child, path, node.children, results)
    }
  }
}

/**
 * Flatten a bookmarklet DOM tree into a sorted, filtered array of node
 * descriptors suitable for display and LLM consumption.
 *
 * - Filters out SKIP_TAGS and nodes whose rect is < 8 × 8 px
 * - Sorts by area descending (most visually prominent first)
 * - Returns at most 80 nodes to keep downstream prompts manageable
 *
 * @param {{ url?: string, viewport?: object, tree?: object } | null} domTreeJson
 * @returns {Array<{
 *   path: string, tag: string, id: string|null, classes: string|null,
 *   textContent: string|null,
 *   rect: { x: number, y: number, w: number, h: number },
 *   styles: {
 *     backgroundColor, color, fontSize, fontFamily, fontWeight,
 *     paddingTop, paddingRight, paddingBottom, paddingLeft,
 *     borderRadius, border, display, gap
 *   }
 * }>}
 */
export function flattenDomTree(domTreeJson) {
  if (!domTreeJson?.tree) return []

  const results = []
  // Root node (body) is passed as its own single-element sibling list so
  // buildSegment never appends :nth for it.
  walkDom(domTreeJson.tree, '', [domTreeJson.tree], results)

  // Filter: drop tiny nodes (likely decorative) and any residual skip-tags
  const filtered = results.filter(n =>
    !SKIP_TAGS.has(n.tag) && n.rect.w >= 8 && n.rect.h >= 8
  )

  // Sort by area descending — visually prominent elements rank first
  filtered.sort((a, b) => (b.rect.w * b.rect.h) - (a.rect.w * a.rect.h))

  return filtered.slice(0, 80)
}

// ---------------------------------------------------------------------------
// Part 2 — Virtual scroll detection
// ---------------------------------------------------------------------------

/**
 * Detect virtual scroll containers using explicit markers and indirect heuristics.
 * Returns likely Figma components that couldn't be matched due to virtualization.
 *
 * @param {object|null} domTreeJson - Bookmarklet output { url, viewport, tree }
 * @param {string[]}    unmatchedFigmaNames - Names of unmatched Figma elements
 * @returns {{
 *   hasVirtualScroll: boolean,
 *   virtualScrollSelector: string | null,
 *   likelyCandidates: string[],
 *   detectionMethod: 'explicit' | 'indirect' | null,
 *   message: string | null
 * }}
 */
export function detectVirtualScrollComponents(domTreeJson, unmatchedFigmaNames = []) {
  if (!domTreeJson?.tree) {
    return {
      hasVirtualScroll: false,
      virtualScrollSelector: null,
      likelyCandidates: [],
      detectionMethod: null,
      message: null,
    }
  }

  const flat = flattenDomTree(domTreeJson)

  // Strategy 1: Look for explicit virtual scroll markers
  const VS_PATTERNS = [
    'cdk-virtual-scroll-viewport',
    'cdk-virtual-scroll',
    'virtual-scroll-viewport',
    'mat-virtual-scroll',
    'virtual-scroller',
    'cdk-virtual',
  ]

  const foundVS = flat.find(node =>
    VS_PATTERNS.some(p =>
      node.tag.includes(p) ||
      (node.classes && node.classes.toLowerCase().includes(p))
    )
  )

  // Strategy 2: Indirect detection
  // If more than 40% of Figma elements are unmatched AND
  // the unmatched ones include card/item/job/req type names,
  // assume virtual scroll is responsible
  const CARD_PATTERNS = /card|item|row|req|job|list.?item/i
  const likelyCandidates = unmatchedFigmaNames.filter(n =>
    CARD_PATTERNS.test(n)
  )

  const unmatchedRatio = unmatchedFigmaNames.length /
    Math.max(1, unmatchedFigmaNames.length + 16)

  const indirectDetection = likelyCandidates.length >= 2 &&
    unmatchedRatio > 0.4

  const hasVirtualScroll = !!foundVS || indirectDetection

  let message = null
  if (hasVirtualScroll && likelyCandidates.length > 0) {
    const names = likelyCandidates.slice(0, 3).join(', ')
    const more = likelyCandidates.length > 3 ? ` and ${likelyCandidates.length - 3} more` : ''
    message = `${names}${more} couldn't be reached — they're likely inside a virtual scroll container. Use the element picker on one card to get exact values for these components.`
  }

  return {
    hasVirtualScroll,
    virtualScrollSelector: foundVS
      ? (foundVS.tag || 'virtual-scroll-container')
      : (indirectDetection ? 'detected-indirect' : null),
    likelyCandidates,
    detectionMethod: foundVS ? 'explicit' : (indirectDetection ? 'indirect' : null),
    message,
  }
}

// ---------------------------------------------------------------------------
// Part 3 — Gemini semantic matching
// ---------------------------------------------------------------------------

/**
 * Build a lean, prompt-friendly representation of a flat node.
 * - Omits empty / null / zero fields (JSON.stringify drops undefined)
 * - Summarises four padding values into a single shorthand string
 */
function compressNode(node) {
  const { path, tag, classes, textContent, rect, styles } = node

  const padParts = [
    styles.paddingTop,
    styles.paddingRight,
    styles.paddingBottom,
    styles.paddingLeft,
  ]
  const padding = padParts.every(v => !v || v === '0px')
    ? undefined
    : padParts.join(' ')

  return {
    path,
    tag,
    classes:     classes     || undefined,
    textContent: textContent || undefined,
    rect,
    styles: {
      backgroundColor: styles.backgroundColor || undefined,
      fontSize:        styles.fontSize        || undefined,
      fontWeight:      styles.fontWeight      || undefined,
      borderRadius:    styles.borderRadius    || undefined,
      padding,
    },
  }
}

/**
 * Use Gemini to semantically match Figma named elements to live DOM nodes.
 *
 * Steps:
 *   1. Flatten the DOM tree
 *   2. Read viewport dimensions
 *   3. Build a compressed node list for the prompt
 *   4. Ask Gemini to produce a structured match list
 *   5. Parse the response
 *   6. Enrich each match with the full DOM node from flatNodes
 *   7. (Optional) If elementPickerJson is provided, run a second pass on
 *      unmatched candidates and merge results
 *
 * Non-fatal: if domTreeJson is null or Gemini fails, returns { matches: [], unmatched: [] }.
 *
 * @param {object[]}    figmaNamedElements   Output of extractNamedElements()
 * @param {object|null} domTreeJson          Bookmarklet JSON { url, viewport, tree }
 * @param {string}      geminiApiKey         Value of GEMINI_API_KEY
 * @param {object|null} elementPickerJson    (Optional) Element picker JSON from targeted extraction
 * @returns {Promise<{
 *   matches: Array<{
 *     figmaName:    string,
 *     figmaElement: object,
 *     domNode:      object,
 *     domPath:      string,
 *     confidence:   "high" | "medium",
 *     reasoning:    string,
 *     viewport:     { w: number, h: number },
 *     source:       "page-level" | "element-picker",
 *   }>,
 *   unmatched: string[]
 * }>}
 */
export async function matchElements(figmaNamedElements, domTreeJson, geminiApiKey, elementPickerJson = null, confidenceThreshold = 'balanced') {
  const empty = { matches: [], unmatched: [] }

  if (!figmaNamedElements?.length) return empty

  // Use element picker as primary DOM if page-level DOM not provided
  const primaryDomTree = domTreeJson || elementPickerJson
  if (!primaryDomTree)             return empty

  // --- Define confidence level filtering ---
  const CONFIDENCE_LEVELS = {
    strict:   ['high'],
    balanced: ['high', 'medium'],
    lenient:  ['high', 'medium', 'low']
  }
  const allowedConfidence = CONFIDENCE_LEVELS[confidenceThreshold] ?? CONFIDENCE_LEVELS['balanced']

  // --- Step 1: Flatten DOM tree ---
  const flatNodes = flattenDomTree(primaryDomTree)
  if (!flatNodes.length) return empty

  // --- Step 2: Extract viewport ---
  const vp = domTreeJson.viewport ?? {}
  const viewport = {
    w: vp.width ?? vp.w ?? 0,
    h: vp.height ?? vp.h ?? 0,
  }

  // --- Step 3: Compress nodes for prompt ---
  const compressedDomNodes = flatNodes.map(compressNode)

  // --- Step 4: Initialize Gemini client with fallback models ---
  const client = new GoogleGenerativeAI(geminiApiKey)

  // Helper: call Gemini with retry + model fallback on 503
  async function callGeminiWithRetry(prompt) {
    const MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash']
    const MAX_RETRIES = 2
    const RETRY_DELAY_MS = 3000

    for (const modelName of MODELS) {
      const model = client.getGenerativeModel({
        model: modelName,
        generationConfig: {
          temperature: 0,
          responseMimeType: 'application/json',
        },
      })

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const response = await model.generateContent(prompt)
          const text = response.response.text()
          return JSON.parse(text)
        } catch (err) {
          const is503 = err.message?.includes('503') || err.message?.includes('Service Unavailable') || err.message?.includes('high demand')
          const isLast = attempt === MAX_RETRIES
          if (is503 && !isLast) {
            console.warn(`[matchService] Gemini ${modelName} 503, retrying in ${RETRY_DELAY_MS}ms (attempt ${attempt + 1}/${MAX_RETRIES})`)
            await new Promise(r => setTimeout(r, RETRY_DELAY_MS))
            continue
          }
          if (is503) {
            console.warn(`[matchService] Gemini ${modelName} still 503 after ${MAX_RETRIES} retries, trying next model`)
            break // try next model
          }
          throw err // non-503 error — propagate immediately
        }
      }
    }
    throw new Error('All Gemini models unavailable (503). Please try again later.')
  }

  // --- Step 5: Call Gemini for page-level matching ---
  const prompt = `You are a UI component matching engine.

You will be given:
1. A list of named Figma design elements with their design-specified properties
2. A list of DOM nodes extracted from the live implementation

Your job is to match each Figma element to the most likely corresponding DOM node.

Match based on:
- Visual role (a button labeled "Create Job" in Figma matches a button with text "Create Job" in DOM)
- Structural position (a top-navigation element in Figma matches a DOM node with a small y rect value)
- Visual properties (similar background color, border-radius, size)
- Dimensional fit (for container elements like bars/headers/panels, prefer the element whose width and height most closely match the Figma element)
- Text content where available

Rules:
- Only return matches you are confident about
- One Figma element maps to at most one DOM node
- It is fine to leave a Figma element unmatched if no good match exists
- Do NOT guess — an unmatched element is better than a wrong match
- For container elements (bars, headers, panels): match to the OUTER container, not inner children. Prefer dimensional fit.

Figma elements:
${JSON.stringify(figmaNamedElements, null, 2)}

DOM nodes:
${JSON.stringify(compressedDomNodes, null, 2)}

Return a JSON object ONLY, no preamble:
{
  "matches": [
    {
      "figmaName": "exact Figma layer name",
      "domPath": "exact path string from the DOM nodes list",
      "confidence": "high" | "medium" | "low",
      "reasoning": "one sentence"
    }
  ],
  "unmatched": ["figmaName1", "figmaName2"]
}

Include matches with any confidence level (high, medium, low).
The confidence level will be used to filter matches based on user settings.`

  let geminiResult
  try {
    geminiResult = await callGeminiWithRetry(prompt)
  } catch (err) {
    console.warn('[matchService] Gemini element matching failed:', err.message)
    return empty
  }

  // --- Step 6 & 7: Enrich matches with full DOM node data ---
  const nodeByPath  = new Map(flatNodes.map(n => [n.path, n]))
  const figmaByName = new Map(figmaNamedElements.map(e => [e.name, e]))

  let matches = (geminiResult.matches ?? [])
    .map(m => {
      const domNode      = nodeByPath.get(m.domPath)
      const figmaElement = figmaByName.get(m.figmaName)
      if (!domNode || !figmaElement) return null   // stale path/name — skip

      // PART 2 FIX: Mark whether this node has real computed styles from bookmarklet
      // Check if domNode has actual spacing/style values (from bookmarklet extraction)
      const hasComputedStyles = !!(
        domNode.styles && (
          domNode.styles.paddingTop ||
          domNode.styles.paddingLeft ||
          domNode.styles.paddingRight ||
          domNode.styles.paddingBottom ||
          domNode.styles.backgroundColor ||
          domNode.styles.color
        )
      )

      return {
        figmaName:    m.figmaName,
        figmaElement,
        domNode,
        domPath:      m.domPath,
        confidence:   m.confidence,
        reasoning:    m.reasoning,
        viewport,
        source:       'page-level',
        hasComputedStyles,  // true if this node has real computed styles
      }
    })
    .filter(Boolean)

  // --- Filter matches by confidence threshold ---
  const thresholdFiltered = []

  matches = matches.filter(match => {
    if (allowedConfidence.includes(match.confidence)) {
      // Tag low confidence matches for UI warning
      if (match.confidence === 'low') {
        match.lowConfidenceWarning = true
      }
      return true
    } else {
      // Track filtered-out matches to add to unmatched
      thresholdFiltered.push(match.figmaName)
      return false
    }
  })

  let unmatched = [
    ...(geminiResult.unmatched ?? []),
    ...thresholdFiltered
  ]

  // --- Step 7 (Optional): Second pass with element picker data ---
  // Only run second pass if we had a page-level DOM (domTreeJson was provided)
  // AND we have element picker data for enrichment
  if (domTreeJson && elementPickerJson) {
    try {
      // Flatten element picker tree
      const pickerFlatNodes = flattenDomTree(elementPickerJson)
      if (pickerFlatNodes.length > 0) {
        // Extract candidates to re-match
        const { likelyCandidates } = detectVirtualScrollComponents(domTreeJson, unmatched)
        const candidateElements = figmaNamedElements.filter(e =>
          likelyCandidates.includes(e.name)
        )

        if (candidateElements.length > 0) {
          // Build second prompt with only candidates
          const compressedPickerNodes = pickerFlatNodes.map(compressNode)
          const secondPrompt = `You are a UI component matching engine.

You will be given:
1. A list of Figma design elements that were not found in the initial page-level extraction
2. DOM nodes from a targeted element picker (a single component and its children)

Your job is to match each Figma element to the DOM node if possible.

Match based on:
- Visual role (a button labeled "Create Job" in Figma matches a button with text "Create Job" in DOM)
- Text content
- Visual properties (similar background color, border-radius, size)

Rules:
- Only return matches you are confident about
- One Figma element maps to at most one DOM node
- It is fine to leave a Figma element unmatched if no good match exists
- Do NOT guess — an unmatched element is better than a wrong match

Figma elements:
${JSON.stringify(candidateElements, null, 2)}

DOM nodes from element picker:
${JSON.stringify(compressedPickerNodes, null, 2)}

Return a JSON object ONLY, no preamble:
{
  "matches": [
    {
      "figmaName": "exact Figma layer name",
      "domPath": "exact path string from the DOM nodes list",
      "confidence": "high" | "medium" | "low",
      "reasoning": "one sentence"
    }
  ],
  "unmatched": ["figmaName1", "figmaName2"]
}

Include matches with any confidence level (high, medium, low).
The confidence level will be used to filter matches based on user settings.`

          const pickerMatches = await callGeminiWithRetry(secondPrompt)

          // Merge picker matches into main result
          const pickerNodeMap = new Map(pickerFlatNodes.map(n => [n.path, n]))
          const pickerMatchObjects = (pickerMatches.matches ?? [])
            .map(m => {
              const domNode = pickerNodeMap.get(m.domPath)
              const figmaElement = figmaByName.get(m.figmaName)
              if (!domNode || !figmaElement) return null

              // PART 2 FIX: Mark whether this node has real computed styles from bookmarklet
              const hasComputedStyles = !!(
                domNode.styles && (
                  domNode.styles.paddingTop ||
                  domNode.styles.paddingLeft ||
                  domNode.styles.paddingRight ||
                  domNode.styles.paddingBottom ||
                  domNode.styles.backgroundColor ||
                  domNode.styles.color
                )
              )

              return {
                figmaName:    m.figmaName,
                figmaElement,
                domNode,
                domPath:      m.domPath,
                confidence:   m.confidence,
                reasoning:    m.reasoning,
                viewport,
                source:       'element-picker',
                hasComputedStyles,
              }
            })
            .filter(Boolean)

          // Add picker matches and remove from unmatched
          matches.push(...pickerMatchObjects)
          const matchedNames = new Set(pickerMatchObjects.map(m => m.figmaName))
          unmatched = unmatched.filter(name => !matchedNames.has(name))
        }
      }
    } catch (err) {
      // Non-fatal: if element picker matching fails, continue with page-level results
      console.warn('[matchService] Element picker matching failed:', err.message)
    }
  }

  return {
    matches,
    unmatched,
  }
}
