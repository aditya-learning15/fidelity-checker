import fs from 'fs/promises'
import { readFileSync, existsSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FEEDBACK_FILE = path.join(__dirname, '../data/feedback.json')

// ---------------------------------------------------------------------------
// Load and analyze feedback patterns
// ---------------------------------------------------------------------------

/**
 * Load feedback from feedback.json and extract suppression + acceptance patterns.
 *
 * Suppression patterns (flagged as incorrect ≥2 times):
 *   Used to remove issues from future reports completely.
 *   Pattern key: {category}:{property}:{referencedElement}
 *
 * Accepted deviations (marked as accepted):
 *   Used to downgrade severity in future reports.
 *   Pattern key: {category}:{property}:{referencedElement}
 *
 * @returns {Promise<{
 *   suppressionPatterns: Set<string>,
 *   acceptedDeviations: Map<string, number>,  // maps to count of times accepted
 *   totalFeedbackEntries: number
 * }>}
 */
export async function loadFeedbackPatterns() {
  const suppressionPatterns = new Set()
  const acceptedDeviations = new Map()
  let totalFeedbackEntries = 0

  try {
    const content = await fs.readFile(FEEDBACK_FILE, 'utf-8')
    const allFeedback = JSON.parse(content)

    if (!Array.isArray(allFeedback)) {
      console.warn('[feedbackService] feedback.json is not an array')
      return { suppressionPatterns, acceptedDeviations, totalFeedbackEntries }
    }

    totalFeedbackEntries = allFeedback.length

    // Count occurrences by pattern key
    const patternCounts = {
      incorrect: {},   // grouped by pattern key
      accepted: {},
    }

    for (const entry of allFeedback) {
      const { feedbackType, issue } = entry
      if (!issue) continue

      const patternKey = buildPatternKey(issue)
      if (!patternKey) continue

      if (feedbackType === 'incorrect') {
        patternCounts.incorrect[patternKey] = (patternCounts.incorrect[patternKey] ?? 0) + 1
      } else if (feedbackType === 'accepted') {
        patternCounts.accepted[patternKey] = (patternCounts.accepted[patternKey] ?? 0) + 1
      }
    }

    // Build suppression patterns: "incorrect" feedback ≥3 times
    for (const [patternKey, count] of Object.entries(patternCounts.incorrect)) {
      if (count >= 3) {
        suppressionPatterns.add(patternKey)
      }
    }

    // Build accepted deviations: track count for severity downgrade
    for (const [patternKey, count] of Object.entries(patternCounts.accepted)) {
      acceptedDeviations.set(patternKey, count)
    }

    console.log(
      `[feedbackService] Loaded ${totalFeedbackEntries} feedback entries: ` +
      `${suppressionPatterns.size} suppression patterns, ` +
      `${acceptedDeviations.size} accepted deviation patterns`
    )
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn('[feedbackService] Error loading feedback patterns:', err.message)
    }
    // feedback.json doesn't exist yet — return empty patterns
  }

  return { suppressionPatterns, acceptedDeviations, totalFeedbackEntries }
}

/**
 * Build a pattern key from an issue.
 * Key format: {category}:{property}:{referencedElement}
 *
 * @param {object} issue - The issue object
 * @returns {string | null} Pattern key, or null if required fields missing
 */
function buildPatternKey(issue) {
  if (!issue.category || !issue.property) {
    return null
  }

  // If referencedElement is present, use it; otherwise use property as fallback
  const element = issue.referencedElement || issue.property
  return `${issue.category}:${issue.property}:${element}`
}

// ---------------------------------------------------------------------------
// Apply feedback filters to issues
// ---------------------------------------------------------------------------

/**
 * Apply suppression and acceptance patterns to a list of issues.
 *
 * - Removes any issue matching a suppression pattern
 * - Downgrades severity for issues matching acceptance patterns
 *
 * @param {Array} issues - List of issues with category, severity, property, referencedElement
 * @param {object} patterns - From loadFeedbackPatterns()
 * @returns {{
 *   filtered: Array,           // issues after applying filters
 *   suppressed: number,        // count of removed issues
 *   downgraded: number,        // count of severity-downgraded issues
 * }}
 */
export function applyFeedbackFilters(issues, patterns) {
  const { suppressionPatterns, acceptedDeviations } = patterns

  if (!Array.isArray(issues)) {
    return { filtered: issues, suppressed: 0, downgraded: 0 }
  }

  let suppressed = 0
  let downgraded = 0
  const filtered = []

  for (const issue of issues) {
    const patternKey = buildPatternKey(issue)

    // Check if this issue should be suppressed
    if (patternKey && suppressionPatterns.has(patternKey)) {
      suppressed++
      continue  // skip this issue
    }

    // Check if this issue should have severity downgraded
    if (patternKey && acceptedDeviations.has(patternKey)) {
      const downgradedIssue = downgradeSeverity(issue)
      filtered.push(downgradedIssue)
      downgraded++
    } else {
      filtered.push(issue)
    }
  }

  return { filtered, suppressed, downgraded }
}

/**
 * Downgrade an issue's severity by one level.
 * critical → major, major → minor, minor → stays minor
 *
 * @param {object} issue - The issue to downgrade
 * @returns {object} New issue with downgraded severity
 */
function downgradeSeverity(issue) {
  const severityMap = {
    critical: 'major',
    major: 'minor',
    minor: 'minor',
  }

  return {
    ...issue,
    severity: severityMap[issue.severity] || issue.severity,
  }
}

// ---------------------------------------------------------------------------
// Load raw feedback entries
// ---------------------------------------------------------------------------

/**
 * Load raw feedback entries from feedback.json.
 * Used for dashboard/summary views.
 *
 * @returns {Array} Array of feedback entries, or empty array if file doesn't exist
 */
export function loadRawFeedback() {
  try {
    if (!existsSync(FEEDBACK_FILE)) return []
    const raw = readFileSync(FEEDBACK_FILE, 'utf8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}
