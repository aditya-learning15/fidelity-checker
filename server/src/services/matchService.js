import { GoogleGenerativeAI } from '@google/generative-ai'
import { createHash } from 'crypto'
import { writeFileSync } from 'fs'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SKIP_TAGS = new Set(['script', 'style', 'meta', 'head', 'html'])

// REDUCTION 1: In-memory cache for matchElements results
// Key: hash of (figmaFileKey + nodeId + domDataHash)
// Value: { result, timestamp } with 1-hour TTL
const MATCH_CACHE = new Map()
const MATCH_CACHE_TTL_MS = 3600000 // 1 hour

function getCacheKey(figmaFileKey, nodeId, domTreeJson, figmaNamedElements) {
  const hash = createHash('sha256')
    .update(
      figmaFileKey + '::' +
      nodeId + '::' +
      JSON.stringify(domTreeJson) + '::' +
      // Include figma element names so cache busts when extraction changes
      (figmaNamedElements ?? []).map(e => e.name).sort().join(',')
    )
    .digest('hex')
  return hash
}

function getCachedMatch(cacheKey) {
  const entry = MATCH_CACHE.get(cacheKey)
  if (!entry) return null
  const age = Date.now() - entry.timestamp
  if (age > MATCH_CACHE_TTL_MS) {
    MATCH_CACHE.delete(cacheKey)
    return null
  }
  console.log('[matchService] Cache hit — reusing previous match result')
  return entry.result
}

function setCachedMatch(cacheKey, result) {
  MATCH_CACHE.set(cacheKey, { result, timestamp: Date.now() })
}

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
  // Accept both a raw JSON string and an already-parsed object.
  // analysisService passes computedStylesJson as a string; parse it here.
  let parsed = domTreeJson
  if (typeof domTreeJson === 'string') {
    try { parsed = JSON.parse(domTreeJson) } catch { return [] }
  }
  if (!parsed?.tree) return []

  const results = []
  // Root node (body) is passed as its own single-element sibling list so
  // buildSegment never appends :nth for it.
  walkDom(parsed.tree, '', [parsed.tree], results)

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
 * Build a minimal prompt representation of a DOM node for matching only.
 * The matcher only needs enough to PAIR elements — not the full style data.
 * Full styles stay in the stored flatNodes for computePropertyDiff to use after matching.
 *
 * Sends ONLY: tag+classes, textContent (30 chars), w×h integers, backgroundColor, fontSize.
 * Drops: path (long), x/y coords, fontWeight, borderRadius, padding, border, gap, display.
 */
function compressNodeForPrompt(node) {
  const { tag, classes, textContent, rect, styles } = node

  // Truncate classes to first two tokens to avoid bloat
  const shortClass = classes
    ? classes.split(/\s+/).slice(0, 2).join(' ')
    : undefined

  return {
    tag,
    classes:     shortClass || undefined,
    text:        textContent ? textContent.slice(0, 30) : undefined,
    w:           Math.round(rect.w),
    h:           Math.round(rect.h),
    bg:          styles.backgroundColor || undefined,
    fontSize:    styles.fontSize        || undefined,
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
export async function matchElements(
  figmaNamedElements,
  domTreeJson,
  geminiApiKey,
  elementPickerJson = null,
  confidenceThreshold = 'balanced',
  figmaFileKey = null, // REDUCTION 1: cache key parameter
  nodeId = null        // REDUCTION 1: cache key parameter
) {
  const empty = { matches: [], unmatched: [] }

  if (!figmaNamedElements?.length) return empty

  // Parse raw JSON strings — analysisService passes computedStylesJson as a string
  const parsedDomTree = typeof domTreeJson === 'string'
    ? (() => { try { return JSON.parse(domTreeJson) } catch { return null } })()
    : domTreeJson
  const parsedPickerTree = typeof elementPickerJson === 'string'
    ? (() => { try { return JSON.parse(elementPickerJson) } catch { return null } })()
    : elementPickerJson

  // Use element picker as primary DOM if page-level DOM not provided
  const primaryDomTree = parsedDomTree || parsedPickerTree
  if (!primaryDomTree) return empty

  // REDUCTION 1: Check cache before running expensive Gemini call
  if (figmaFileKey && nodeId) {
    const cacheKey = getCacheKey(figmaFileKey, nodeId, primaryDomTree, figmaNamedElements)
    const cached = getCachedMatch(cacheKey)
    if (cached) return cached
  }

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
  const vp = parsedDomTree?.viewport ?? {}
  const viewport = {
    w: vp.width ?? vp.w ?? 0,
    h: vp.height ?? vp.h ?? 0,
  }

  // --- Step 3: Compress nodes for prompt — top 35 by visual area only ---
  // flatNodes is already sorted by area descending (see flattenDomTree).
  // Take the top 35: small/nested nodes rarely match named Figma elements.
  const promptDomNodes = flatNodes.slice(0, 35).map(compressNodeForPrompt)

  // --- Step 4: Initialize Gemini client with fallback models ---
  const client = new GoogleGenerativeAI(geminiApiKey)

  // Helper: call Gemini with timeout + minimal retry on 503
  async function callGeminiWithRetry(prompt) {
    const GEMINI_TIMEOUT_MS = 30000  // 30s — small prompt should return in 2-5s on 2.5-flash
    // gemini-2.5-flash confirmed working (1.3s for small prompt via curl test).
    // gemini-2.0 family: limit:0 in this project. gemini-1.5-flash: 404 on v1beta.
    // Fall through on 429 or timeout — each model has independent quota.
    const MODELS = ['gemini-2.5-flash']
    const MAX_RETRIES = 1  // FIX B: Only 1 retry on 503, not 2
    const RETRY_DELAY_MS = 3000  // FIX B: 3s wait before retry only

    // FIX C: Log prompt size for diagnostic
    console.log(`[matchService] Gemini prompt size: ${prompt.length} chars`)

    for (const modelName of MODELS) {
      const model = client.getGenerativeModel({
        model: modelName,
        generationConfig: {
          temperature: 0.1,  // low — matching is deterministic
          responseMimeType: 'application/json',
          thinkingConfig: {
            thinkingBudget: 0  // disable thinking, respond directly (prevents 30s hangs)
          },
        },
      })

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          // FIX A: Wrap Gemini call in 30s timeout
          const result = await Promise.race([
            model.generateContent(prompt),
            new Promise((_, reject) =>
              setTimeout(
                () => reject(new Error('Gemini timeout after 30s')),
                GEMINI_TIMEOUT_MS
              )
            ),
          ])
          const text = result.response.text()
          return JSON.parse(text)
        } catch (err) {
          const msg = err.message ?? ''
          // LOG RAW ERROR: so we can see exactly what Gemini returned (not our classified version)
          console.error(`[matchService] RAW Gemini error on ${modelName} (attempt ${attempt}): ${msg}`)
          if (err.status !== undefined) console.error(`[matchService] HTTP status: ${err.status}`)
          if (err.errorDetails) console.error(`[matchService] errorDetails: ${JSON.stringify(err.errorDetails)}`)

          const is429 = msg.includes('429') || msg.includes('quota') || msg.includes('rate limit') || msg.includes('exceeds') || msg.includes('Quota exceeded') || msg.includes('RESOURCE_EXHAUSTED')
          const is503 = msg.includes('503') || msg.includes('Service Unavailable') || msg.includes('high demand') || msg.includes('overloaded')
          const is400 = msg.includes('400') || msg.includes('Invalid')
          const isNetworkError = msg.includes('ECONNRESET') || msg.includes('timeout') || msg.includes('ENOTFOUND')
          const isTimeout = msg.includes('Gemini timeout')

          // On 429: each model has independent quota in this project (2.0-family has limit:0,
          // 2.5-family has actual quota). Fall through to next model rather than aborting.
          if (is429) {
            console.error(`[matchService] 429 on ${modelName} — trying next model (independent quotas)`)
            break  // skip remaining retries for this model, try next
          }

          // On 400 (bad request): NEVER retry
          if (is400) {
            console.error(`[matchService] Gemini 400 on ${modelName}: ${msg}`)
            throw new Error(`Gemini request failed: ${msg}`)
          }

          // On timeout: fall through to next model (don't abort — next model may be faster)
          if (isTimeout) {
            console.error(`[matchService] Gemini timeout on ${modelName} — trying next model`)
            break
          }

          // FIX B: On 503, only retry once with 3s wait
          const isLast = attempt === MAX_RETRIES
          if ((is503 || isNetworkError) && !isLast) {
            console.warn(`[matchService] Gemini ${modelName} ${is503 ? '503' : 'network error'}, retrying in ${RETRY_DELAY_MS}ms (attempt ${attempt + 1}/${MAX_RETRIES})`)
            await new Promise(r => setTimeout(r, RETRY_DELAY_MS))
            continue
          }

          if (is503 || isNetworkError) {
            console.warn(`[matchService] Gemini ${modelName} still failing after ${MAX_RETRIES} retries, trying next model`)
            break // try next model
          }

          // Unknown error — propagate immediately
          throw err
        }
      }
    }
    // FIX B: Fail fast after trying all models, no further retries
    throw new Error('Gemini is temporarily overloaded. Please try again in a moment.')
  }

  // --- Step 5: Build minimal matching prompt ---
  // Figma side: trim to 35 most significant elements, send only matching-relevant fields
  const promptFigmaElements = figmaNamedElements.slice(0, 35).map(e => ({
    name: e.name,
    text: e.text ? String(e.text).slice(0, 30) : undefined,
    w:    e.width  ? Math.round(e.width)  : undefined,
    h:    e.height ? Math.round(e.height) : undefined,
  }))

  // DOM side: nodes already sliced to top 35 by area. Use index (not path) to save chars —
  // Gemini returns the index, we look up flatNodes[index] for the full node + path.
  const promptDomNodesIndexed = promptDomNodes.map((n, i) => ({ i, ...n }))

  const prompt = `Match Figma design elements to DOM nodes. Return JSON only.

Figma elements:
${JSON.stringify(promptFigmaElements)}

DOM nodes (use field "i" as the id to return):
${JSON.stringify(promptDomNodesIndexed)}

Rules: match by text content first, then dimensions (w×h), then background color. Each Figma element must match at most ONE DOM node — the single best match only. Do not return multiple DOM nodes for the same Figma element name. Omit uncertain matches.

Return:
{"matches":[{"figmaName":"...","domIndex":0,"confidence":"high"|"medium"|"low","reasoning":"one sentence"}],"unmatched":["figmaName1"]}`

  console.log(`[matchService] Gemini prompt size: ${prompt.length} chars`)

  let geminiResult
  try {
    geminiResult = await callGeminiWithRetry(prompt)
  } catch (err) {
    // Do NOT swallow this — returning empty would produce a false-pass (0 issues, 100/100).
    // Rethrow so the API route returns a 503 and the client shows an error state.
    console.error('[matchService] Gemini element matching failed — propagating error:', err.message)
    throw err
  }

  // --- Step 6 & 7: Enrich matches with full DOM node data ---
  // Gemini now returns domIndex (integer) instead of domPath.
  // Look up the full node from flatNodes by index, then get the path from the node.
  const figmaByName = new Map(figmaNamedElements.map(e => [e.name, e]))

  console.log(`[matchService] Gemini returned ${geminiResult.matches?.length ?? 0} matches, ${geminiResult.unmatched?.length ?? 0} unmatched`)
  // Log every raw Gemini match before any filtering so we can diagnose drop-off
  for (const m of (geminiResult.matches ?? [])) {
    console.log(`[matchService] RAW match: figma="${m.figmaName}" domIndex=${m.domIndex} confidence=${m.confidence}`)
  }

  let matches = (geminiResult.matches ?? [])
    .map(m => {
      const domNode      = flatNodes[m.domIndex]
      const figmaElement = figmaByName.get(m.figmaName)
      if (!domNode) {
        console.warn(`[matchService] DROP (bad index): figma="${m.figmaName}" domIndex=${m.domIndex} flatNodes.length=${flatNodes.length}`)
        return null
      }
      if (!figmaElement) {
        console.warn(`[matchService] DROP (unknown figmaName): "${m.figmaName}"`)
        return null
      }

      // Mark whether this node has real computed styles from bookmarklet
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
        domIndex:     m.domIndex,
        domPath:      domNode.path,   // full path from stored flatNode (not from prompt)
        confidence:   m.confidence,
        reasoning:    m.reasoning,
        viewport,
        source:       'page-level',
        hasComputedStyles,
      }
    })
    .filter(Boolean)

  console.log(`[matchService] After null-lookup filter: ${matches.length} matches`)

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
      console.log(`[matchService] DROP (confidence="${match.confidence}" below threshold="${confidenceThreshold}"): "${match.figmaName}"`)
      // Track filtered-out matches to add to unmatched
      thresholdFiltered.push(match.figmaName)
      return false
    }
  })

  console.log(`[matchService] After confidence filter: ${matches.length} matches (threshold=${confidenceThreshold}, allowed=${JSON.stringify(allowedConfidence)})`)

  // --- Dedup: one Figma element → one DOM node (keep highest confidence, tie-break by smallest domIndex) ---
  const CONFIDENCE_RANK = { high: 0, medium: 1, low: 2 }
  const seenFigmaNames = new Map()
  for (const match of matches) {
    const existing = seenFigmaNames.get(match.figmaName)
    if (!existing) {
      seenFigmaNames.set(match.figmaName, match)
    } else {
      const existingRank = CONFIDENCE_RANK[existing.confidence] ?? 99
      const newRank = CONFIDENCE_RANK[match.confidence] ?? 99
      if (newRank < existingRank || (newRank === existingRank && match.domIndex < existing.domIndex)) {
        seenFigmaNames.set(match.figmaName, match)
      }
    }
  }
  const dedupDropped = matches.filter(m => seenFigmaNames.get(m.figmaName) !== m).map(m => m.figmaName)
  if (dedupDropped.length) {
    console.log(`[matchService] DEDUP dropped ${dedupDropped.length} duplicate figmaName(s): ${dedupDropped.join(', ')}`)
  }
  matches = [...seenFigmaNames.values()]
  console.log(`[matchService] After dedup: ${matches.length} matches`)

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

  // Write pairings to disk so they survive log buffer truncation
  try {
    const pairingDump = matches.map(m => ({
      figmaName:       m.figmaName,
      figmaType:       m.figmaElement?.type,
      domPath:         m.domPath,
      domTag:          m.domNode?.tag,
      domClasses:      m.domNode?.classes,
      domRect:         m.domNode?.rect,
      confidence:      m.confidence,
      reasoning:       m.reasoning,
      domPaddingValues: {
        top:    m.domNode?.styles?.paddingTop,
        right:  m.domNode?.styles?.paddingRight,
        bottom: m.domNode?.styles?.paddingBottom,
        left:   m.domNode?.styles?.paddingLeft,
      },
    }))
    writeFileSync('/tmp/pairings.json', JSON.stringify(pairingDump, null, 2))
    console.log(`[matchService] Pairings written to /tmp/pairings.json (${matches.length} matches)`)
  } catch (writeErr) {
    console.warn('[matchService] Could not write pairings file:', writeErr.message)
  }

  const result = {
    matches,
    unmatched,
  }

  // REDUCTION 1: Cache the result for 1 hour
  if (figmaFileKey && nodeId) {
    const cacheKey = getCacheKey(figmaFileKey, nodeId, primaryDomTree, figmaNamedElements)
    setCachedMatch(cacheKey, result)
    console.log('[matchService] Match result cached (1 hour TTL)')
  }

  return result
}
