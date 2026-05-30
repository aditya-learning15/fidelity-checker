import { randomUUID } from 'crypto'
import { extractTokens, extractNamedElements, parseComputedStyles, diffTokenSets } from './tokenService.js'
import { runPixelDiff, computePropertyDiff, buildDomBoundingBox, extractDiffRegions } from './diffService.js'
import { runAIComparison } from './aiService.js'
import { bufferToBase64 } from './imageService.js'
import { detectVirtualScrollComponents, matchElements } from './matchService.js'
import { loadFeedbackPatterns, applyFeedbackFilters } from './feedbackService.js'

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
  return issues.filter(issue => {
    // Presence/absence issues (vision-only, no exact values)
    if (issue.category === 'layout' && issue.description?.includes('missing')) {
      // Only keep if high confidence, and mark as unverified
      if (issue.confidence === 'high') {
        // Add qualifier if not already present
        if (!issue.description.includes('visual check')) {
          issue.description = `${issue.description} (visual check — please verify)`
        }
        return true
      }
      // Drop medium/low confidence presence claims
      return false
    }

    // Color issues: must have both figmaValue AND domValue (computed hex)
    if (issue.category === 'color') {
      const hasFigmaHex = issue.figmaValue && /^#[0-9A-Fa-f]{6}$/.test(issue.figmaValue)
      const hasDomHex = issue.domValue && /^#[0-9A-Fa-f]{6}$/.test(issue.domValue)

      if (hasFigmaHex && hasDomHex) {
        return true  // Has both hex codes — keep it
      }

      // No computed hex evidence — drop color issue
      return false
    }

    // Arithmetic issues (typography, spacing, etc.): must have both values
    if (issue.figmaValue != null && issue.domValue != null) {
      // Check if values are specific (not vague like "light grey")
      const figmaIsSpecific = issue.figmaValue !== '' && issue.figmaValue !== null
      const domIsSpecific = issue.domValue !== '' && issue.domValue !== null

      if (figmaIsSpecific && domIsSpecific) {
        return true  // Has both concrete values
      }
    }

    // No evidence — drop it
    return false
  })
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
        const matchResult = await matchElements(
          namedElements,
          computedStylesJson,
          process.env.GEMINI_API_KEY
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
  }

  // --- Pass 2: Pixel diff ---
  // alignImages is called internally by runPixelDiff; the aligned buffers
  // are returned so we can reuse them for the AI pass (same dimensions).
  const diffResult = await runPixelDiff(figmaBuffer, screenshotBuffer)

  // --- Pass 3: AI semantic comparison ---
  // Use aligned buffers so both images are the same size when sent to Gemini.
  // Pass matched elements so AI won't generate false positive issues for already-verified elements.
  const aiResult = await runAIComparison(
    diffResult.alignedFigmaBuffer,
    diffResult.alignedScreenshotBuffer,
    namedElements,
    tokenDiff,    // null when not provided — aiService handles gracefully
    matchedElements,  // null when no computed styles — aiService handles gracefully
  )

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

  // --- Generate arithmetic issues from matched elements ---
  // If we have matched elements, compare them for property discrepancies
  let arithmeticIssuesCount = 0
  if (matchedElements && matchedElements.length > 0) {
    // matchedElements from Part 6 is a simplified array of {figmaName, confidence}
    // We need the full match objects to run computePropertyDiff
    // This will be added when we regenerate matches in the enrich endpoint
    // For now, we'll extract diff regions for vision issues to use for bounding boxes
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
