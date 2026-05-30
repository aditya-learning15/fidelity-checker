import { Router } from 'express'
import multer from 'multer'
import { randomUUID } from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import { parseFigmaUrl, fetchFigmaFrame, exportFigmaFrameAsPng } from '../services/figmaService.js'
import { runFullAnalysis } from '../services/analysisService.js'
import { matchElements, detectVirtualScrollComponents } from '../services/matchService.js'
import { extractNamedElements } from '../services/tokenService.js'
import { loadFeedbackPatterns, loadRawFeedback, clearAllFeedback } from '../services/feedbackService.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FEEDBACK_FILE = path.join(__dirname, '../data/feedback.json')

const router = Router()

// ---------------------------------------------------------------------------
// Multer — memory storage, image-only, 10 MB cap
// ---------------------------------------------------------------------------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/png', 'image/jpeg', 'image/webp']
    if (allowed.includes(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error('Only PNG, JPG, and WebP images are accepted'))
    }
  },
})

// ---------------------------------------------------------------------------
// POST /api/analyze
// ---------------------------------------------------------------------------
router.post('/', (req, res) => {
  // Use the callback form so multer errors surface as JSON, not HTML 500s.
  upload.single('screenshot')(req, res, async (err) => {
    // --- multer-level errors ---
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'Screenshot must be under 10MB' })
      }
      return res.status(400).json({ error: err.message })
    }

    // --- fileFilter rejection or other upload errors ---
    if (err) {
      return res.status(400).json({ error: err.message })
    }

    try {
      const { figmaUrl, figmaToken, computedStyles, confidenceThreshold } = req.body

      // --- field validation ---
      if (!figmaToken || !figmaToken.trim()) {
        return res.status(400).json({ error: 'Figma access token is required' })
      }

      if (!figmaUrl || !figmaUrl.trim()) {
        return res.status(400).json({ error: 'Figma URL is required' })
      }

      if (!req.file) {
        return res.status(400).json({ error: 'Screenshot file is required' })
      }

      // --- validate confidence threshold ---
      const VALID_THRESHOLDS = ['strict', 'balanced', 'lenient']
      const threshold = VALID_THRESHOLDS.includes(confidenceThreshold)
        ? confidenceThreshold
        : 'balanced'

      // --- parse + validate the Figma URL ---
      let fileKey, nodeId
      try {
        ;({ fileKey, nodeId } = parseFigmaUrl(figmaUrl))
      } catch (parseErr) {
        return res.status(400).json({ error: parseErr.message })
      }

      // --- fetch Figma frame JSON (tokens) + PNG (pixel diff) in parallel ---
      const [figmaNodeJson, figmaBuffer] = await Promise.all([
        fetchFigmaFrame(fileKey, nodeId, figmaToken),
        exportFigmaFrameAsPng(fileKey, nodeId, figmaToken),
      ])

      // --- run the full three-pass analysis ---
      const report = await runFullAnalysis({
        figmaBuffer,
        screenshotBuffer:  req.file.buffer,
        figmaNodeJson,
        computedStylesJson: computedStyles || null,
        confidenceThreshold: threshold,
        figmaFileKey: fileKey,
      })

      return res.json(report)
    } catch (serviceErr) {
      const msg = serviceErr.message

      if (msg.includes('Invalid Figma access token')) {
        return res.status(401).json({ error: msg })
      }
      if (msg.includes('Frame not found')) {
        return res.status(404).json({ error: msg })
      }
      if (msg.includes('Could not reach Figma API')) {
        return res.status(502).json({ error: msg })
      }
      if (msg.includes('Analysis limit reached')) {
        return res.status(429).json({ error: msg })
      }
      if (msg.includes('AI comparison failed') || msg.includes('AI returned malformed')) {
        return res.status(502).json({ error: msg })
      }
      if (msg.includes('Invalid image data')) {
        return res.status(400).json({ error: msg })
      }

      console.error('[analyze] Unexpected error:', msg)
      return res.status(500).json({ error: 'An unexpected error occurred' })
    }
  })
})

// ---------------------------------------------------------------------------
// POST /api/analyze/enrich
// ---------------------------------------------------------------------------
// Generate arithmetic issues from element picker matches.
// Re-runs property diffing on matched elements to find spacing, color, typography issues.
//
// Body: {
//   figmaUrl: string,
//   figmaToken: string,
//   elementPickerJson: string | object,
//   existingReport: object
// }
//
// Returns: {
//   newMatches: number,
//   newIssues: Array,
//   replacedIssues: number,
//   updatedScore: number,
//   updatedMatchingSummary: { totalFigmaElements, matchedWithDom, precisionIssues, ... }
// }
router.post('/enrich', async (req, res) => {
  try {
    const { figmaUrl, figmaToken, elementPickerJson, existingReport, confidenceThreshold } = req.body

    // --- Validation ---
    if (!figmaUrl || !figmaUrl.trim()) {
      return res.status(400).json({ error: 'Figma URL is required' })
    }
    if (!figmaToken || !figmaToken.trim()) {
      return res.status(400).json({ error: 'Figma access token is required' })
    }
    if (!elementPickerJson) {
      return res.status(400).json({ error: 'Element picker JSON is required' })
    }
    if (!existingReport) {
      return res.status(400).json({ error: 'Existing report is required for enrichment' })
    }

    // --- Validate confidence threshold ---
    const VALID_THRESHOLDS = ['strict', 'balanced', 'lenient']
    const threshold = VALID_THRESHOLDS.includes(confidenceThreshold)
      ? confidenceThreshold
      : 'balanced'

    // Parse element picker JSON
    let elementPickerData
    try {
      elementPickerData = typeof elementPickerJson === 'string'
        ? JSON.parse(elementPickerJson)
        : elementPickerJson
    } catch {
      return res.status(400).json({ error: 'Invalid element picker JSON' })
    }

    // Parse + validate Figma URL
    let fileKey, nodeId
    try {
      ;({ fileKey, nodeId } = parseFigmaUrl(figmaUrl))
    } catch (parseErr) {
      return res.status(400).json({ error: parseErr.message })
    }

    // Fetch Figma frame JSON only (no image export)
    const figmaNodeJson = await fetchFigmaFrame(fileKey, nodeId, figmaToken)
    const namedElements = extractNamedElements(figmaNodeJson)

    // Run matching with element picker data
    const matchResult = await matchElements(
      namedElements,
      null,
      process.env.GEMINI_API_KEY,
      elementPickerData,
      threshold
    )

    if (!matchResult.matches || matchResult.matches.length === 0) {
      return res.json({
        newMatches: 0,
        newIssues: [],
        replacedIssues: 0,
        updatedScore: existingReport.overallScore,
        updatedMatchingSummary: {
          totalFigmaElements: namedElements.length,
          matchedWithDom: 0,
          precisionIssues: 0,
          confidenceThreshold: 'balanced',
        },
      })
    }

    // --- Generate arithmetic issues from matched elements ---
    const { computePropertyDiff, buildDomBoundingBox } = await import('../services/diffService.js')
    const newIssues = []

    console.log(`[enrich] Processing ${matchResult.matches.length} matched elements`)
    for (const match of matchResult.matches) {
      const diffs = computePropertyDiff(match)
      const boundingBox = buildDomBoundingBox(match.domNode, match.viewport)

      for (const diff of diffs) {
        newIssues.push({
          severity: diff.severity,
          category: diff.category,
          property: diff.property,
          figmaValue: diff.figmaValue,
          domValue: diff.domValue,
          delta: diff.delta ?? null,
          description: `${diff.property}: expected ${diff.figmaValue}, found ${diff.domValue}${diff.delta ? ' (' + diff.delta + ')' : ''}`,
          location: match.figmaName,
          suggestion: `Update ${diff.property} to ${diff.figmaValue}`,
          referencedElement: match.figmaName,
          boundingBox,
          confidence: match.confidence,
          source: 'arithmetic',
          fromEnrich: true,
        })
      }
    }

    // --- Apply feedback filters ---
    const { loadFeedbackPatterns, applyFeedbackFilters } = await import('../services/feedbackService.js')
    const feedbackPatterns = await loadFeedbackPatterns()
    const { filtered: filteredNewIssues } = applyFeedbackFilters(newIssues, feedbackPatterns)

    console.log(`[enrich] Generated ${newIssues.length} issues, ${filteredNewIssues.length} after feedback filtering`)

    // --- Merge with existing report and deduplicate ---
    const mergedCategories = JSON.parse(JSON.stringify(existingReport.categories ?? {}))
    let replacedCount = 0

    for (const newIssue of filteredNewIssues) {
      const catName = newIssue.category
      if (!mergedCategories[catName]) {
        mergedCategories[catName] = { issues: [], score: 100 }
      }

      // Find if this issue already exists in the category
      const existingIdx = mergedCategories[catName].issues?.findIndex(existing =>
        existing.referencedElement === newIssue.referencedElement &&
        existing.property === newIssue.property
      )

      if (existingIdx >= 0) {
        // Replace existing vision issue with arithmetic version
        mergedCategories[catName].issues[existingIdx] = newIssue
        replacedCount++
      } else {
        // Add new issue
        if (!mergedCategories[catName].issues) {
          mergedCategories[catName].issues = []
        }
        mergedCategories[catName].issues.push(newIssue)
      }
    }

    // --- Compute updated score ---
    const { computeScores } = await import('../services/analysisService.js')
    const allMergedIssues = Object.entries(mergedCategories).flatMap(([cat, data]) =>
      (data.issues ?? []).map(issue => ({
        ...issue,
        category: cat,
      }))
    )

    const { overallScore: updatedScore } = computeScores(
      { mismatchPercent: existingReport.pixelMismatch?.percent ?? 0 },
      { categories: mergedCategories },
      allMergedIssues
    )

    return res.json({
      newMatches: matchResult.matches.length,
      newIssues: filteredNewIssues,
      replacedIssues: replacedCount,
      updatedScore,
      updatedMatchingSummary: {
        totalFigmaElements: namedElements.length,
        matchedWithDom: matchResult.matches.length,
        precisionIssues: filteredNewIssues.length,
        confidenceThreshold: threshold,
        lowConfidenceMatches: matchResult.matches.filter(
          m => m.lowConfidenceWarning
        ).length,
      },
    })
  } catch (err) {
    console.error('[analyze/enrich] Error:', err.message)
    return res.status(500).json({ error: err.message })
  }
})

// ---------------------------------------------------------------------------
// POST /api/analyze/feedback
// ---------------------------------------------------------------------------
// Store user feedback for a specific issue (flagged or accepted).
// This data is used to build suppression patterns and feedback filters.
//
// Body: {
//   sessionId: string,           // unique analysis run ID
//   issueIndex: number,          // global issue index
//   feedbackType: 'incorrect' | 'accepted',
//   issue: object,               // the issue object (category, severity, description, etc.)
//   context: object              // optional contextual metadata
// }
//
// Returns: { ok: true, feedbackId: string, timestamp: string }
router.post('/feedback', async (req, res) => {
  try {
    const { sessionId, figmaFileKey, issueIndex, feedbackType, issue, context } = req.body

    // --- Validation ---
    if (!sessionId || typeof sessionId !== 'string') {
      return res.status(400).json({ error: 'sessionId is required' })
    }
    if (!figmaFileKey || typeof figmaFileKey !== 'string') {
      return res.status(400).json({ error: 'figmaFileKey is required (scope feedback to file)' })
    }
    if (issueIndex === undefined || typeof issueIndex !== 'number') {
      return res.status(400).json({ error: 'issueIndex is required' })
    }
    if (!['incorrect', 'accepted'].includes(feedbackType)) {
      return res.status(400).json({ error: 'feedbackType must be "incorrect" or "accepted"' })
    }
    if (!issue || typeof issue !== 'object') {
      return res.status(400).json({ error: 'issue object is required' })
    }

    // --- Create feedback entry ---
    const feedbackId = randomUUID()
    const timestamp = new Date().toISOString()
    const feedbackEntry = {
      id: feedbackId,
      sessionId,
      figmaFileKey,  // scope this feedback entry to a specific file
      issueIndex,
      feedbackType,
      issue,
      context: context || {},
      timestamp,
    }

    // --- Ensure data directory exists ---
    const dataDir = path.dirname(FEEDBACK_FILE)
    await fs.mkdir(dataDir, { recursive: true })

    // --- Read existing feedback or initialize empty array ---
    let allFeedback = []
    try {
      const content = await fs.readFile(FEEDBACK_FILE, 'utf-8')
      allFeedback = JSON.parse(content)
      if (!Array.isArray(allFeedback)) allFeedback = []
    } catch (readErr) {
      // File doesn't exist yet, start with empty array
      if (readErr.code !== 'ENOENT') {
        console.warn('[feedback] Error reading feedback.json:', readErr.message)
      }
    }

    // --- Append new feedback ---
    allFeedback.push(feedbackEntry)

    // --- Write back to file ---
    await fs.writeFile(FEEDBACK_FILE, JSON.stringify(allFeedback, null, 2), 'utf-8')

    console.log(`[feedback] Stored feedback ${feedbackId} (${feedbackType}) for session ${sessionId}`)
    return res.json({ ok: true, feedbackId, timestamp })
  } catch (err) {
    console.error('[feedback] Unexpected error:', err.message)
    return res.status(500).json({ error: 'Failed to store feedback' })
  }
})

// ---------------------------------------------------------------------------
// GET /api/feedback/summary
// ---------------------------------------------------------------------------
// Read-only endpoint: returns summary of collected feedback for the dashboard.
// Includes total entry counts, active suppressions, accepted deviations, and
// recent feedback entries.
//
// Returns: {
//   totalEntries: number,
//   incorrectFlags: number,
//   acceptedDeviations: number,
//   suppressionPatterns: Array<{ referencedElement, property, count, isActive }>,
//   acceptedPatterns: Array<{ referencedElement, property, count }>,
//   recentEntries: Array<{ timestamp, feedbackType, issueCategory, issueSeverity, referencedElement, property }>
// }
router.get('/feedback/summary', async (req, res) => {
  try {
    const patterns = await loadFeedbackPatterns()
    const allFeedback = loadRawFeedback()

    // Build suppression patterns array with isActive flag
    const suppressionPatternsArray = []
    const suppressionSet = patterns.suppressionPatterns

    // Count occurrences of each pattern
    const patternCounts = {}
    for (const entry of allFeedback) {
      if (entry.feedbackType !== 'incorrect' || !entry.issue) continue

      const { category, property, referencedElement } = entry.issue
      if (!category || !property) continue

      const key = `${category}:${property}:${referencedElement || property}`
      patternCounts[key] = (patternCounts[key] ?? 0) + 1
    }

    for (const [key, count] of Object.entries(patternCounts)) {
      if (count >= 2) {
        const [category, property, refElement] = key.split(':')
        suppressionPatternsArray.push({
          category,
          referencedElement: refElement !== property ? refElement : null,
          property,
          count,
          isActive: true
        })
      }
    }

    // Build accepted deviations array
    const acceptedPatternsArray = []
    const acceptedMap = patterns.acceptedDeviations

    const acceptedCounts = {}
    for (const entry of allFeedback) {
      if (entry.feedbackType !== 'accepted' || !entry.issue) continue

      const { category, property, referencedElement } = entry.issue
      if (!category || !property) continue

      const key = `${category}:${property}:${referencedElement || property}`
      acceptedCounts[key] = (acceptedCounts[key] ?? 0) + 1
    }

    for (const [key, count] of Object.entries(acceptedCounts)) {
      const [category, property, refElement] = key.split(':')
      acceptedPatternsArray.push({
        category,
        referencedElement: refElement !== property ? refElement : null,
        property,
        count
      })
    }

    // Build recent entries (last 10, reverse order)
    const recentEntries = allFeedback
      .slice(-10)
      .reverse()
      .map(entry => ({
        timestamp: entry.timestamp,
        feedbackType: entry.feedbackType,
        issueCategory: entry.issue?.category ?? null,
        issueSeverity: entry.issue?.severity ?? null,
        referencedElement: entry.issue?.referencedElement ?? null,
        property: entry.issue?.property ?? null
      }))

    res.json({
      totalEntries: allFeedback.length,
      incorrectFlags: allFeedback.filter(
        e => e.feedbackType === 'incorrect'
      ).length,
      acceptedDeviations: allFeedback.filter(
        e => e.feedbackType === 'accepted'
      ).length,
      suppressionPatterns: suppressionPatternsArray,
      acceptedPatterns: acceptedPatternsArray,
      recentEntries
    })
  } catch (e) {
    console.error('Feedback summary error:', e)
    res.status(500).json({ error: e.message })
  }
})

// ---------------------------------------------------------------------------
// POST /api/feedback/reset — Clear all feedback (for corrupted test data)
// ---------------------------------------------------------------------------
router.post('/feedback/reset', async (req, res) => {
  try {
    const { cleared } = await clearAllFeedback()
    res.json({
      success: true,
      message: `Cleared ${cleared} feedback entries`,
      cleared,
    })
  } catch (err) {
    console.error('[feedback/reset]', err.message)
    res.status(500).json({ error: err.message })
  }
})

export default router
