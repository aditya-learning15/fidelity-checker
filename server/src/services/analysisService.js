import { randomUUID } from 'crypto'
import { writeFileSync } from 'fs'
import { extractTokens, extractNamedElements, parseComputedStyles, diffTokenSets } from './tokenService.js'
import { runPixelDiff, computePropertyDiff, buildDomBoundingBox, extractDiffRegions } from './diffService.js'
import { runAIComparison } from './aiService.js'
import { bufferToBase64 } from './imageService.js'
import { detectVirtualScrollComponents, matchElements } from './matchService.js'
import { loadFeedbackPatterns, applyFeedbackFilters } from './feedbackService.js'

// ---------------------------------------------------------------------------
// Vision pass control
// ---------------------------------------------------------------------------

/**
 * DISABLE_VISION: Set to true to skip the vision pass entirely.
 * Vision (Gemini image comparison) was timing out at 30s and was the primary
 * source of false positives in earlier testing. The tool now does deterministic
 * arithmetic comparison on matched elements instead.
 *
 * When disabled:
 * - Only 1 Gemini call per analysis (matching/arithmetic only)
 * - No image processing overhead (faster, under 10s total)
 * - No measurement guesses or phantom element claims
 * - Report shows only concrete arithmetic issues with exact figmaValue + domValue
 *
 * If re-enabling later, increase timeout to 60s (images need processing time).
 */
const DISABLE_VISION = true

// ---------------------------------------------------------------------------
// Evidence-based filtering
// ---------------------------------------------------------------------------

/**
 * PART 1 FIX: Filter issues without concrete evidence.
 * Every issue in the report must cite specific values from Figma and/or computed styles.
 *
 * Allowed to remain:
 * - Arithmetic issues: figmaValue AND domValue both present and specific
 * - Color issues: both Figma hex AND computed hex (no vision-only color claims)
 * - Presence issues: only high confidence, with "(visual check — please verify)" qualifier
 *
 * @param {object[]} issues - All issues from analysis
 * @returns {object[]} Filtered issues with evidence
 */
function filterIssuesWithoutEvidence(issues) {
  const filteredIssues = issues.filter(issue => {
    // Determine whether this is an arithmetic issue (has computed values) or a vision issue.
    // Vision issues from the AI never have figmaValue/domValue — they're categorical observations.
    // Arithmetic issues from computePropertyDiff always have both figmaValue and domValue.
    //
    // undefined != null is FALSE in JS loose equality, so this correctly detects
    // issues where neither field was set (pure vision output).
    const hasAnyEvidence = issue.figmaValue != null || issue.domValue != null

    if (hasAnyEvidence) {
      // ── Arithmetic issue ── require both values to be concrete
      if (issue.category === 'color') {
        // Color arithmetic: both sides must be valid hex codes
        const hasFigmaHex = issue.figmaValue && /^#[0-9A-Fa-f]{6}$/.test(issue.figmaValue)
        const hasDomHex   = issue.domValue   && /^#[0-9A-Fa-f]{6}$/.test(issue.domValue)
        return hasFigmaHex && hasDomHex
      }
      // All other arithmetic (typography, spacing, radius): both values must be non-empty
      return issue.figmaValue != null && issue.figmaValue !== '' &&
             issue.domValue   != null && issue.domValue   !== ''
    }

    // ── Vision issue (no figmaValue or domValue) ──
    // Keep only high-confidence observations. Medium/low confidence vision claims are unreliable.
    if (issue.confidence !== 'high') return false

    // Presence/absence claims get a "please verify" qualifier
    const desc = issue.description ?? ''
    if (/missing|absent|not present|not visible/i.test(desc)) {
      if (!desc.includes('visual check')) {
        issue.description = `${desc} (visual check — please verify)`
      }
    }

    return true
  })

  const arithmeticOut = filteredIssues.filter(i => i.source === 'arithmetic').length
  const visionOut     = filteredIssues.filter(i => i.source !== 'arithmetic').length
  console.log(`[analysisService] Evidence filter: ${issues.length} in → ${filteredIssues.length} out (arithmetic: ${arithmeticOut}, vision: ${visionOut})`)
  return filteredIssues
}

// ---------------------------------------------------------------------------
// State-mismatch helpers (Fix B)
// ---------------------------------------------------------------------------

/** Convert a #RRGGBB hex string to its HSL hue (0–360). */
function hexToHue(hex) {
  if (!hex || !/^#[0-9A-Fa-f]{6}$/i.test(hex)) return null
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  if (max === min) return 0
  const d = max - min
  let h
  switch (max) {
    case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break
    case g: h = ((b - r) / d + 2) / 6; break
    default: h = ((r - g) / d + 4) / 6
  }
  return h * 360
}

/** True if two hex colours are in completely different hue families (>60° apart). */
function isFullHueFamilyChange(hex1, hex2) {
  const h1 = hexToHue(hex1), h2 = hexToHue(hex2)
  if (h1 === null || h2 === null) return false
  return Math.min(Math.abs(h1 - h2), 360 - Math.abs(h1 - h2)) > 60
}

/** True if the colour is white, off-white, or a near-neutral grey. */
function isWhiteOrNeutral(hex) {
  if (!hex || !/^#[0-9A-Fa-f]{6}$/i.test(hex)) return false
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return Math.max(r, g, b) - Math.min(r, g, b) < 40 && Math.max(r, g, b) > 170
}

// ---------------------------------------------------------------------------
// Token mismatch → issue conversion
// ---------------------------------------------------------------------------

const TOKEN_TYPE_TO_CATEGORY = {
  typography: 'typography',
  spacing:    'spacing',
  radius:     'spacing',
  // color: intentionally excluded — color requires hex context and can be noisy globally
}

const SKIP_PROPERTIES = new Set([
  'cornerRadius', 'borderRadius',  // pill-shape sentinel noise
  'borderTopLeftRadius', 'borderTopRightRadius',
  'borderBottomLeftRadius', 'borderBottomRightRadius',
])

/**
 * Convert tokenDiff.mismatches into report issues.
 * These are arithmetic issues with exact figmaValue + domValue pairs.
 * They do NOT require Gemini element matching — they come directly from
 * the token diff between Figma design tokens and computed browser styles.
 *
 * @param {object|null} tokenDiff - Output of diffTokenSets()
 * @returns {object[]} Issues in report format
 */
function tokenMismatchesToIssues(tokenDiff) {
  if (!tokenDiff?.mismatches?.length) return []

  // STEP 1 DIAGNOSTIC: Inspect what mismatches actually contain
  console.log('=== TOKEN DIFF INSPECTION ===')
  console.log('Total mismatches:', tokenDiff.mismatches.length)
  tokenDiff.mismatches.forEach((m, i) => {
    console.log(`Mismatch ${i}:`, {
      type:         m.type,
      property:     m.property,
      figmaValue:   m.figmaValue,
      domValue:     m.computedValue,
      delta:        m.delta,
      figmaElement: m.nodeName ?? m.figmaNodeName ?? m.figmaElementName ?? 'UNKNOWN',
      domElement:   m.domPath ?? m.nodeTag ?? m.domNodeName ?? 'UNKNOWN',
    })
  })
  console.log('=== END TOKEN DIFF ===')

  const issues = []
  const seen = new Set()

  for (const mismatch of tokenDiff.mismatches) {
    const category = TOKEN_TYPE_TO_CATEGORY[mismatch.type]
    if (!category) continue                           // skip color and unknown types
    if (SKIP_PROPERTIES.has(mismatch.property)) continue  // skip noisy radius props

    // Skip sub-pixel differences (rounding artefacts)
    const delta = mismatch.delta ?? null
    if (delta !== null && delta < 1) continue

    // Deduplicate: same property + same value pair
    const key = `${mismatch.property}:${mismatch.figmaValue}:${mismatch.computedValue}`
    if (seen.has(key)) continue
    seen.add(key)

    // Severity from delta
    let severity = 'major'
    if (delta !== null) {
      if (delta >= 8) severity = 'critical'
      else if (delta >= 4) severity = 'major'
      else severity = 'minor'
    }

    // Human-readable property label (camelCase → spaced words)
    const propLabel = mismatch.property
      .replace(/([A-Z])/g, ' $1')
      .toLowerCase()
      .trim()

    issues.push({
      severity,
      confidence: 'high',
      category,
      description: `${propLabel}: design specifies ${mismatch.figmaValue}, build renders ${mismatch.computedValue}`,
      figmaValue:  mismatch.figmaValue,
      domValue:    mismatch.computedValue,
      source:      'arithmetic',
      suggestion:  `Set ${mismatch.property} to ${mismatch.figmaValue} to match the design spec`,
    })
  }

  console.log(`[analysisService] tokenMismatchesToIssues: ${tokenDiff.mismatches.length} mismatches → ${issues.length} issues`)
  return issues
}

// ---------------------------------------------------------------------------
// Score computation
// ---------------------------------------------------------------------------

/**
 * Compute arithmetic (precision) score from categorical issues.
 * Deterministic penalty based on issue severity.
 *
 * @param {object[]} issues - Flattened issues array with category and severity
 * @returns {number} 0-100
 */
function computeArithmeticScore(issues) {
  let score = 100
  for (const issue of issues) {
    if (issue.severity === 'critical') score -= 8
    else if (issue.severity === 'major') score -= 4
    else if (issue.severity === 'minor') score -= 1
  }
  return Math.max(0, score)
}

/**
 * Compute vision score from pixel diff and vision issues.
 *
 * @param {object[]} visionIssues - Issues from layout/color/typography/spacing AI analysis
 * @param {object} diffResult - Output of runPixelDiff()
 * @returns {number} 0-100
 */
function computeVisionScore(visionIssues, diffResult) {
  let score = 100
  score -= diffResult.mismatchPercent * 1.5

  for (const issue of visionIssues) {
    if (issue.severity === 'critical') score -= 6
    else if (issue.severity === 'major') score -= 3
    else if (issue.severity === 'minor') score -= 0.5
  }

  return Math.max(0, Math.round(score))
}

/**
 * Derive per-category and overall fidelity scores from the pixel diff and AI results.
 *
 * Separates arithmetic (precision) scoring from vision scoring, with adaptive weighting
 * based on the proportion of arithmetic issues found.
 *
 * @param {object} diffResult - Output of runPixelDiff()
 * @param {object} aiResult   - Output of runAIComparison()
 * @param {object[]} allIssues - Flattened array of all issues with categories
 * @returns {{ pixelScore: number, overallScore: number }}
 */
function computeScores(diffResult, aiResult, allIssues = []) {
  // Separate issues by type
  const arithmeticCategories = ['typography', 'spacing']
  const arithmeticIssues = allIssues.filter(issue =>
    arithmeticCategories.includes(issue.category)
  )
  const visionIssues = allIssues.filter(issue =>
    !arithmeticCategories.includes(issue.category)
  )

  // Compute individual scores
  const arithmeticScore = computeArithmeticScore(arithmeticIssues)
  const visionScore = computeVisionScore(visionIssues, diffResult)

  // BUG 4 FIX: Cap vision weight at 30% (vision issues are unreliable)
  // Arithmetic issues carry at least 70% of the final score
  const totalIssues = Math.max(1, arithmeticIssues.length + visionIssues.length)
  // Vision weight: capped at 0.3, reduced further if there are arithmetic issues
  const visionWeight = Math.min(0.3,
    0.15 + (visionIssues.length / totalIssues) * 0.15
  )
  const arithmeticWeight = 1 - visionWeight

  const overallScore = Math.round(
    arithmeticScore * arithmeticWeight +
    visionScore * visionWeight
  )

  return { arithmeticScore, visionScore, overallScore }
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

/**
 * Run the full three-pass fidelity analysis and return a structured report.
 *
 * Pass 1 — Token extraction  (Figma JSON)
 * Pass 2 — Pixel diff        (pixelmatch)
 * Pass 3 — AI comparison     (Gemini 2.5 Flash)
 * Pass 4 — Extraction gap detection (virtual scroll heuristic)
 *
 * @param {{
 *   figmaBuffer:     Buffer,  PNG exported from Figma
 *   screenshotBuffer:Buffer,  PNG/JPG uploaded by user
 *   figmaNodeJson:   object,  Node document from fetchFigmaFrame()
 *   computedStylesJson: object, (optional) Bookmarklet DOM extraction
 * }} params
 *
 * @returns {Promise<{
 *   overallScore:    number,
 *   pixelMismatch:   { percent: number, pixels: number, total: number },
 *   categories:      { layout, color, typography, spacing },
 *   summary:         string,
 *   tokens:          object,
 *   images:          { figmaBase64: string, screenshotBase64: string, diffBase64: string },
 *   extractionGaps:  { hasVirtualScroll, virtualScrollSelector, likelyCandidates, message }
 * }>}
 */
export async function runFullAnalysis({ figmaBuffer, screenshotBuffer, figmaNodeJson, computedStylesJson, confidenceThreshold = 'balanced', figmaFileKey = null }) {
  // --- Generate session ID for this analysis run ---
  const sessionId = randomUUID()

  // DIAGNOSTIC: Check if bookmarklet data reached the backend
  console.log('[analysisService] === ENTRY POINT DEBUG ===')
  console.log('[analysisService] computedStylesJson received:', !!computedStylesJson)
  if (computedStylesJson) {
    try {
      const parsed = typeof computedStylesJson === 'string' ? JSON.parse(computedStylesJson) : computedStylesJson
      console.log('[analysisService] computedStylesJson is valid, tree present:', !!parsed?.tree)
    } catch (e) {
      console.log('[analysisService] computedStylesJson parse error:', e.message)
    }
  }

  // --- Load feedback patterns from previous user corrections (scoped to this file) ---
  const feedbackPatterns = await loadFeedbackPatterns(figmaFileKey || 'unknown')

  // --- Pass 1: Named element extraction ---
  // Replaces the old token-summary approach with semantically meaningful
  // element names + properties that give the AI better grounding.
  const namedElements = extractNamedElements(figmaNodeJson)

  // --- Optional: computed styles diff + element matching ---
  // When the user supplies bookmarklet output, we can compare exact token values
  // against the Figma spec and pass the diff to the AI as grounding data.
  // extractTokens() is re-used here only for the token diff; the AI itself
  // receives namedElements, which is richer and more semantically grounded.
  let tokenDiff = null
  let matchedElements = null
  let matchResult = null
  if (computedStylesJson) {
    try {
      const rawTokens      = extractTokens(figmaNodeJson)
      const computedTokens = parseComputedStyles(computedStylesJson)
      tokenDiff = diffTokenSets(rawTokens, computedTokens)

      // --- Element matching ---
      // Try to match Figma elements to DOM nodes to identify which elements
      // have been verified as correct via arithmetic (token) analysis.
      // These matched elements should be excluded from vision AI evaluation.
      try {
        // REDUCTION 1: Pass cache parameters to reuse match results within 1 hour
        const nodeId = figmaNodeJson?.id ?? null
        matchResult = await matchElements(
          namedElements,
          computedStylesJson,
          process.env.GEMINI_API_KEY,
          null,
          'balanced',
          figmaFileKey,
          nodeId
        )
        if (matchResult.matches && matchResult.matches.length > 0) {
          matchedElements = matchResult.matches.map(m => ({
            figmaName: m.figmaName,
            confidence: m.confidence,
          }))
        }
      } catch (matchErr) {
        // Non-fatal — element matching is optional enhancement
        console.warn('[analysisService] Element matching failed:', matchErr.message)
      }
    } catch (err) {
      // Non-fatal — computed styles are optional; log and continue
      console.warn('[analysisService] Could not parse computed styles:', err.message)
    }

    // DIAGNOSTIC: Full arithmetic pipeline verification
    console.log('=== ARITHMETIC PIPELINE DEBUG ===')
    console.log('namedElements count:', namedElements.length)
    console.log('matchResult.matches count:', matchResult?.matches?.length ?? 'NO MATCH RESULT')
    console.log('matchResult.unmatched count:', matchResult?.unmatched?.length ?? 0)

    // Step A: Show first 5 matches — figmaName, domPath, confidence, reasoning
    console.log('--- Match pairings (first 5) ---')
    if (matchResult?.matches?.length > 0) {
      matchResult.matches.slice(0, 5).forEach((m, i) => {
        console.log(`Pairing ${i}: "${m.figmaName}" → "${m.domPath}"`, {
          confidence: m.confidence,
          reasoning:  m.reasoning,
        })
      })
    }

    // Step B: Per-match diff output
    console.log('--- Per-match diffs ---')
    if (matchResult?.matches?.length > 0) {
      matchResult.matches.forEach((m, i) => {
        const diffs = computePropertyDiff(m)
        console.log(`Match ${i}: ${m.figmaName}`, {
          hasComputedStyles: !!m.domNode?.styles,
          diffsGenerated:    diffs.length,
          sampleDiff:        diffs[0]
            ? { property: diffs[0].property ?? diffs[0].description,
                figmaValue: diffs[0].figmaValue,
                domValue:   diffs[0].domValue }
            : null,
        })
      })
    }
    console.log('=== END ARITHMETIC DEBUG ===')
  }

  // --- Pass 2: Pixel diff ---
  // alignImages is called internally by runPixelDiff; the aligned buffers
  // are returned so we can reuse them for the AI pass (same dimensions).
  const diffResult = await runPixelDiff(figmaBuffer, screenshotBuffer)

  // --- Pass 3: AI semantic comparison (DISABLED) ---
  // Vision pass is disabled by default. It was timing out at 30s with image processing
  // and was the primary source of false positives (measurement guesses, phantom elements,
  // color misreads, state-mismatch flips). The tool now does deterministic arithmetic
  // comparison on matched elements only.
  //
  // To re-enable in future:
  // - Set DISABLE_VISION = false above
  // - Increase vision timeout from 30s to 60s (image processing is slower)
  // - Re-evaluate false-positive filters for vision issues
  let aiResult = {
    categories: {
      layout:     { score: 100, issues: [] },
      color:      { score: 100, issues: [] },
      typography: { score: 100, issues: [] },
      spacing:    { score: 100, issues: [] },
    },
    overallSummary: 'Arithmetic analysis only (vision disabled)',
  }

  if (!DISABLE_VISION) {
    const hasUnmatchedElements = matchResult?.unmatched?.length > 0 ||
                                  (matchResult?.matches?.length ?? 0) < (namedElements?.length ?? 0)

    if (hasUnmatchedElements) {
      // Use aligned buffers so both images are the same size when sent to Gemini.
      // Pass matched elements so AI won't generate false positive issues for already-verified elements.
      aiResult = await runAIComparison(
        diffResult.alignedFigmaBuffer,
        diffResult.alignedScreenshotBuffer,
        namedElements,
        tokenDiff,    // null when not provided — aiService handles gracefully
        matchedElements,  // null when no computed styles — aiService handles gracefully
      )
    } else {
      console.log('[analysisService] Skipping vision pass — all Figma elements matched via arithmetic')
    }
  } else {
    console.log('[analysisService] Vision pass disabled (arithmetic comparison only)')
  }

  // --- Filter low-confidence issues ---
  // BUG 4 FIX: Be strict with vision issues (layout, color) — only keep high confidence
  // Arithmetic issues (typography, spacing) can keep medium confidence
  const filterIssuesStrict = (cat) => ({
    ...cat,
    // Vision issues: only high confidence (layout, color are unreliable)
    issues: (cat.issues ?? []).filter(issue => issue.confidence === 'high'),
  })

  const filterIssuesBalanced = (cat) => ({
    ...cat,
    // Arithmetic issues: keep high + medium (already validated by token diff)
    issues: (cat.issues ?? []).filter(issue => issue.confidence !== 'low'),
  })

  const categoriesAfterConfidence = {
    layout:     filterIssuesStrict(aiResult.categories.layout),
    color:      filterIssuesStrict(aiResult.categories.color),
    typography: filterIssuesBalanced(aiResult.categories.typography),
    spacing:    filterIssuesBalanced(aiResult.categories.spacing),
  }

  // --- Generate arithmetic issues from Gemini-matched elements ---
  // tokenDiff.mismatches is NOT used here — it has no element attribution (figmaElement: UNKNOWN)
  // and produces wrong-element-pairing false positives (confirmed by diagnostic).
  // Arithmetic issues come only from computePropertyDiff on verified Gemini matches,
  // which pairs a specific Figma element with its corresponding DOM node.
  if (matchResult?.matches?.length > 0) {
    // ── FIX 1: Deduplicate by DOM path ──────────────────────────────────────
    // Two Figma elements can be matched to the same DOM node (confirmed: "1280"
    // and "Main Container" both resolved to the root div). Keep only the best
    // match per DOM path: higher confidence wins; ties broken by dimensional fit.
    const confRank = { high: 3, medium: 2, low: 1 }
    const dimensionalFit = (m) => {
      const fw = m.figmaElement?.width,  fh = m.figmaElement?.height
      const dw = m.domNode?.rect?.w,     dh = m.domNode?.rect?.h
      if (!fw || !fh || !dw || !dh) return 0
      return (Math.min(fw, dw) / Math.max(fw, dw)) +
             (Math.min(fh, dh) / Math.max(fh, dh))
    }

    const domPathBestMatch = new Map()
    for (const m of matchResult.matches) {
      if (!domPathBestMatch.has(m.domPath)) {
        domPathBestMatch.set(m.domPath, m)
      } else {
        const prev = domPathBestMatch.get(m.domPath)
        const mRank = confRank[m.confidence] ?? 0
        const pRank = confRank[prev.confidence] ?? 0
        if (mRank > pRank || (mRank === pRank && dimensionalFit(m) > dimensionalFit(prev))) {
          domPathBestMatch.set(m.domPath, m)
        }
      }
    }

    // ── FIX 2: Drop SVG element matches ─────────────────────────────────────
    // Icons are matched to both their container div AND the inner svg element.
    // The svg element has no CSS spacing — keep the container div, drop the svg.
    const candidateMatches = Array.from(domPathBestMatch.values())
      .filter(m => m.domNode?.tag !== 'svg')

    // ── Fix B: Build duplicate-name set for state-mismatch detection ─────────
    // Figma components with the same name (e.g. "Tabs" × 8) represent a set of
    // sibling instances that may be in different interaction states in the DOM.
    // A dramatic color flip on one of them is likely a state mismatch, not a bug.
    const figmaNameCounts = new Map()
    for (const m of matchResult.matches) {
      figmaNameCounts.set(m.figmaName, (figmaNameCounts.get(m.figmaName) ?? 0) + 1)
    }
    const duplicateFigmaNames = new Set(
      [...figmaNameCounts.entries()]
        .filter(([, count]) => count > 1)
        .map(([name]) => name)
    )

    const arithmeticSeen = new Set()
    const pairingReport  = []

    for (const match of candidateMatches) {
      // ── FIX 3: Dimensional sanity gate ──────────────────────────────────
      // If either dimension is more than 2× different, the pairing is implausible.
      const fw = match.figmaElement?.width,  fh = match.figmaElement?.height
      const dw = match.domNode?.rect?.w,     dh = match.domNode?.rect?.h
      if (fw && fh && dw && dh) {
        const wRatio = Math.min(fw, dw) / Math.max(fw, dw)
        const hRatio = Math.min(fh, dh) / Math.max(fh, dh)
        if (wRatio < 0.5 || hRatio < 0.5) {
          console.log(`[analysisService] Skipping dimensionally implausible: "${match.figmaName}" (w=${wRatio.toFixed(2)} h=${hRatio.toFixed(2)})`)
          continue
        }
      }

      const isVectorType = match.figmaElement?.type === 'VECTOR'
      const diffs = computePropertyDiff(match)

      // For VECTOR/icon elements allow color diffs only — no spacing
      const filteredDiffs = isVectorType
        ? diffs.filter(d => d.category === 'color')
        : diffs

      const matchIssues = []
      const KNOWN_CATEGORIES = new Set(['layout', 'color', 'typography', 'spacing'])
      for (const diff of filteredDiffs) {
        const cat = diff.category
        if (!KNOWN_CATEGORIES.has(cat)) {
          console.warn(`[analysisService] Issue with unmapped category "${cat}" dropped: ${diff.property} (${diff.figmaValue} vs ${diff.domValue})`)
        }
        if (!categoriesAfterConfidence[cat]) continue

        // ── Fix B: State-mismatch guard ─────────────────────────────────────
        // Identically-named repeated components (e.g. Tabs × 8) may be in
        // different interaction states in the DOM. A full hue-family color flip
        // on one of them (e.g. white Figma default vs blue DOM active state)
        // is a state mismatch, not a design error — suppress it.
        if (cat === 'color' && duplicateFigmaNames.has(match.figmaName)) {
          const fh = diff.figmaValue, dh = diff.domValue
          if (isFullHueFamilyChange(fh, dh) &&
              (isWhiteOrNeutral(fh) || isWhiteOrNeutral(dh))) {
            console.log(`[analysisService] State-mismatch suppressed: "${match.figmaName}" ${fh} vs ${dh}`)
            continue
          }
        }

        const dedupKey = `${match.figmaName}::${diff.property ?? diff.description}`
        if (arithmeticSeen.has(dedupKey)) continue
        arithmeticSeen.add(dedupKey)

        categoriesAfterConfidence[cat] = {
          ...categoriesAfterConfidence[cat],
          issues: [...(categoriesAfterConfidence[cat].issues ?? []),
            { ...diff, source: 'arithmetic' }],
        }
        matchIssues.push({
          property:   diff.property,
          category:   diff.category,
          figmaValue: diff.figmaValue,
          domValue:   diff.domValue,
          severity:   diff.severity,
        })
      }

      const entry = {
        figmaName:        match.figmaName,
        figmaType:        match.figmaElement?.type,
        domPath:          match.domPath,
        confidence:       match.confidence,
        arithmeticIssues: matchIssues,
      }

      // FIX 2: Diagnostic data for icon SVG fill comparison validation
      if (match.figmaElement?.type === 'VECTOR') {
        entry.domDiagnostics = {
          domTag:       match.domNode?.tag,
          domColor:     match.domNode?.styles?.color,
          domFill:      match.domNode?.styles?.fill,
          // If the DOM node has a child SVG, capture its fill style
          childSvgFill: match.domNode?.children?.find((c) => c?.tag === 'svg')?.styles?.fill ?? null,
        }
      }

      pairingReport.push(entry)
    }

    // Write extended pairings dump (survives log buffer truncation)
    try {
      writeFileSync('/tmp/pairings.json', JSON.stringify(pairingReport, null, 2))
      console.log(`[analysisService] Pairings dump: ${candidateMatches.length} after SVG filter, ${pairingReport.length} passed sanity gate`)
    } catch (e) {
      console.warn('[analysisService] Could not write pairings dump:', e.message)
    }
  }

  // Extract diff regions from the pixel diff for vision issue localization
  let diffRegions = []
  try {
    diffRegions = await extractDiffRegions(
      diffResult.diffImageBuffer,
      diffResult.dimensions.width,
      diffResult.dimensions.height
    )
  } catch (err) {
    console.warn('[analysisService] Could not extract diff regions:', err.message)
  }

  // --- Apply feedback filters ---
  // Suppress issues flagged as incorrect ≥2 times, downgrade accepted deviations
  let feedbackApplied = { suppressed: 0, downgraded: 0, totalFeedbackEntries: feedbackPatterns.totalFeedbackEntries }
  const categories = {}

  for (const [catName, catData] of Object.entries(categoriesAfterConfidence)) {
    const { filtered, suppressed, downgraded } = applyFeedbackFilters(
      catData.issues ?? [],
      feedbackPatterns
    )
    categories[catName] = { ...catData, issues: filtered }
    feedbackApplied.suppressed += suppressed
    feedbackApplied.downgraded += downgraded
  }

  // --- Score aggregation ---
  // Flatten all issues and pass to score computation for deterministic calculation
  let allIssues = Object.entries(categories).flatMap(([cat, data]) =>
    (data.issues ?? []).map(issue => ({
      ...issue,
      category: cat,
    }))
  )

  // PART 1 FIX: Filter issues without evidence before scoring and reporting
  allIssues = filterIssuesWithoutEvidence(allIssues)

  // Rebuild categories with filtered issues
  const filteredCategories = {}
  for (const [catName, catData] of Object.entries(categories)) {
    const categoryIssues = allIssues.filter(issue => issue.category === catName)
    filteredCategories[catName] = { ...catData, issues: categoryIssues }
  }

  const { overallScore } = computeScores(diffResult, { ...aiResult, categories: filteredCategories }, allIssues)

  // --- Extraction gap detection ---
  // If computed styles (DOM extraction) was provided, detect virtual scroll containers
  // and identify likely Figma components that might be inside them.
  let extractionGaps = {
    hasVirtualScroll: false,
    virtualScrollSelector: null,
    likelyCandidates: [],
    message: null,
  }

  if (computedStylesJson) {
    // Extract all Figma element names that could be inside virtual scroll
    // (based on naming heuristics: card, item, row, list-item, req, job)
    const allFigmaElementNames = namedElements.map(e => e.name)

    const gaps = detectVirtualScrollComponents(computedStylesJson, allFigmaElementNames)
    extractionGaps = {
      hasVirtualScroll: gaps.hasVirtualScroll,
      virtualScrollSelector: gaps.virtualScrollSelector,
      likelyCandidates: gaps.likelyCandidates,
      detectionMethod: gaps.detectionMethod,
      message: gaps.message,
    }
  }

  // --- Assemble final report ---
  return {
    sessionId,
    figmaFileKey,  // used when posting feedback to scope to this file
    overallScore,
    confidenceThreshold,
    pixelMismatch: {
      percent: diffResult.mismatchPercent,
      pixels:  diffResult.mismatchedPixels,
      total:   diffResult.totalPixels,
    },
    categories: filteredCategories,  // PART 1 FIX: only issues with evidence
    summary: aiResult.overallSummary,
    tokenDiff,    // null when no computed styles were provided
    extractionGaps,
    feedbackApplied,
    images: {
      figmaBase64:      bufferToBase64(diffResult.alignedFigmaBuffer),
      screenshotBase64: bufferToBase64(diffResult.alignedScreenshotBuffer),
      diffBase64:       bufferToBase64(diffResult.diffImageBuffer),
    },
  }
}
