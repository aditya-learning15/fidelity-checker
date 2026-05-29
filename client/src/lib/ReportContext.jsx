import { createContext, useContext, useState } from 'react'
import apiClient from './apiClient.js'

const ReportContext = createContext(null)

// ---------------------------------------------------------------------------
// Feedback posting helper
// ---------------------------------------------------------------------------

/**
 * POST feedback to the server for learning loop training.
 * Fire-and-forget: errors are logged but don't affect UI.
 *
 * @param {object} feedback - { sessionId, issueIndex, feedbackType, issue, context }
 * @returns {Promise<void>}
 */
async function postFeedback(feedback) {
  try {
    const { data: result } = await apiClient.post('/api/analyze/feedback', feedback)
    console.log('[ReportContext] Feedback posted:', result.feedbackId)
  } catch (err) {
    console.warn('[postFeedback] Error:', err.message)
    // Silently fail — feedback collection is best-effort and shouldn't block user workflows
  }
}

/**
 * Extract a specific issue by its global index from a report.
 * Flattens all categories and returns the issue at the specified index.
 *
 * @param {object} report - The report object with categories
 * @param {number} globalIndex - The global index of the issue
 * @returns {object | null} The issue object, or null if not found
 */
function getIssueFromReport(report, globalIndex) {
  if (!report?.categories) return null

  let index = 0
  for (const [_cat, data] of Object.entries(report.categories)) {
    for (const issue of (data.issues ?? [])) {
      if (index === globalIndex) {
        return issue
      }
      index++
    }
  }
  return null
}

/**
 * Provides full report context including manual issue overrides.
 *
 * Shape:
 *   report: { overallScore, categories, ... }
 *   setReport: (newReport) => void
 *   overrides: { [globalIndex]: 'incorrect' | 'accepted' }
 *   flagIssue: (globalIndex) => void        // Mark as "AI got this wrong"
 *   acceptIssue: (globalIndex) => void      // Mark as "known deviation"
 *   effectiveScore: number (0-100, adjusted for overrides)
 *   figmaUrl, figmaToken, setAnalysisInputs
 */
export function ReportProvider({ children }) {
  const [report, setReport] = useState(null)
  const [figmaUrl, setFigmaUrl] = useState('')
  const [figmaToken, setFigmaToken] = useState('')
  const [overrides, setOverrides] = useState({})

  const setAnalysisInputs = (url, token) => {
    setFigmaUrl(url)
    setFigmaToken(token)
  }

  const flagIssue = (globalIndex) => {
    setOverrides(prev => ({
      ...prev,
      [globalIndex]: 'incorrect',
    }))

    // Fire-and-forget feedback POST (don't block UI)
    if (report?.sessionId) {
      const issue = getIssueFromReport(report, globalIndex)
      if (issue) {
        postFeedback({
          sessionId: report.sessionId,
          issueIndex: globalIndex,
          feedbackType: 'incorrect',
          issue,
          context: { action: 'flagged_issue' },
        })
      }
    }
  }

  const acceptIssue = (globalIndex) => {
    setOverrides(prev => ({
      ...prev,
      [globalIndex]: 'accepted',
    }))

    // Fire-and-forget feedback POST (don't block UI)
    if (report?.sessionId) {
      const issue = getIssueFromReport(report, globalIndex)
      if (issue) {
        postFeedback({
          sessionId: report.sessionId,
          issueIndex: globalIndex,
          feedbackType: 'accepted',
          issue,
          context: { action: 'accepted_issue' },
        })
      }
    }
  }

  // Compute effective score accounting for flagged/accepted issues
  const effectiveScore = (() => {
    if (!report) return 0

    let score = report.overallScore

    // Map severity/category to full and half points
    const severityPoints = {
      arithmetic: { critical: 8, major: 4, minor: 1 },
      vision: { critical: 6, major: 3, minor: 0.5 },
    }

    // Flatten all issues with their globalIndex
    let globalIndex = 0
    for (const [cat, data] of Object.entries(report.categories ?? {})) {
      const isArithmetic = ['typography', 'spacing'].includes(cat)
      const pointsMap = isArithmetic ? severityPoints.arithmetic : severityPoints.vision

      for (const issue of (data.issues ?? [])) {
        const override = overrides[globalIndex]
        if (override === 'incorrect') {
          // Flagged: add back full points this issue cost
          const penalty = pointsMap[issue.severity] ?? 0
          score += penalty
        } else if (override === 'accepted') {
          // Accepted: add back half points this issue cost
          const penalty = (pointsMap[issue.severity] ?? 0) / 2
          score += penalty
        }
        globalIndex++
      }
    }

    return Math.max(0, Math.min(100, Math.round(score)))
  })()

  return (
    <ReportContext.Provider value={{
      report,
      setReport,
      figmaUrl,
      figmaToken,
      setAnalysisInputs,
      overrides,
      flagIssue,
      acceptIssue,
      effectiveScore,
    }}>
      {children}
    </ReportContext.Provider>
  )
}

/**
 * Hook to consume the report context.
 * Throws if used outside <ReportProvider>.
 */
export function useReport() {
  const ctx = useContext(ReportContext)
  if (!ctx) {
    throw new Error('useReport must be used inside <ReportProvider>')
  }
  return ctx
}
