// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function scoreHex(score) {
  if (score >= 80) return '#16a34a'
  if (score >= 60) return '#d97706'
  return '#dc2626'
}

/** Pill tint: green above 75, amber 60-74, red below 60. */
function pillStyle(score) {
  if (score >= 75) return { background: '#f0fdf4', color: '#15803d' }
  if (score >= 60) return { background: '#fffbeb', color: '#b45309' }
  return { background: '#fef2f2', color: '#b91c1c' }
}

const CATEGORY_LABELS = {
  layout:     'Layout',
  color:      'Color',
  typography: 'Typography',
  spacing:    'Spacing',
}

// ---------------------------------------------------------------------------
// CompactScoreStrip
// ---------------------------------------------------------------------------

/**
 * Immediately-scannable score strip. Sticky, never scrolls away.
 *
 * Row 1: large score number  +  four category pills (Label Score format)
 * Row 2: pixel mismatch · N issues (X critical, Y major, Z minor)
 * Row 3 (optional): override info when issues have been dismissed
 * Row 4 (optional): confidence threshold setting
 *
 * @param {{
 *   overallScore:  number,
 *   effectiveScore?: number,
 *   categories:    { layout, color, typography, spacing },
 *   pixelMismatch: { percent: number, pixels: number, total: number },
 *   issues:        Array<{ severity: string }>,
 *   dismissedCount?: number,
 *   confidenceThreshold?: string,
 * }} props
 */
export default function CompactScoreStrip({
  overallScore,
  effectiveScore,
  categories,
  pixelMismatch,
  issues = [],
  flaggedCount = 0,
  acceptedCount = 0,
  confidenceThreshold,
}) {
  const criticalCount = issues.filter(i => i.severity === 'critical').length
  const majorCount    = issues.filter(i => i.severity === 'major').length
  const minorCount    = issues.filter(i => i.severity === 'minor').length
  const totalIssues   = issues.length

  const mismatchPct = pixelMismatch?.percent ?? 0

  // Use effectiveScore if provided and different from overallScore
  const displayScore = effectiveScore ?? overallScore
  const scoreChanged = effectiveScore !== undefined && effectiveScore !== overallScore

  return (
    <div
      className="flex-shrink-0 border-b border-gray-100 bg-white"
      style={{ padding: '12px 16px' }}
    >
      {/* Row 1: score + category pills */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span
            className="font-semibold leading-none"
            style={{ fontSize: '32px', color: scoreHex(displayScore) }}
          >
            {displayScore}
          </span>
          {scoreChanged && (
            <span className="text-xs text-gray-500">
              (was {overallScore})
            </span>
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-1.5">
          {Object.entries(CATEGORY_LABELS).map(([key, label]) => {
            const score = categories[key]?.score ?? 0
            return (
              <span
                key={key}
                className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
                style={pillStyle(score)}
              >
                {label} {score}
              </span>
            )
          })}
        </div>
      </div>

      {/* Row 2: pixel mismatch + issue counts */}
      <p className="mt-1 text-gray-400" style={{ fontSize: '11px' }}>
        {mismatchPct.toFixed(1)}% pixel mismatch
        {totalIssues > 0 && (
          <>
            {' · '}
            {totalIssues} issue{totalIssues !== 1 ? 's' : ''}{' '}
            ({criticalCount} critical, {majorCount} major, {minorCount} minor)
          </>
        )}
        {totalIssues === 0 && ' · no issues found'}
      </p>

      {/* Row 3: override info */}
      {(flaggedCount > 0 || acceptedCount > 0) && (
        <p className="mt-1 text-gray-500" style={{ fontSize: '10px' }}>
          Adjusted · {flaggedCount > 0 && `${flaggedCount} flagged`}{flaggedCount > 0 && acceptedCount > 0 && ' · '}{acceptedCount > 0 && `${acceptedCount} accepted`}
        </p>
      )}

      {/* Row 4: confidence threshold */}
      {confidenceThreshold && (
        <p style={{ fontSize: '10px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>
          Threshold: {
            confidenceThreshold === 'strict' ? 'Strict (high confidence only)' :
            confidenceThreshold === 'balanced' ? 'Balanced (high + medium)' :
            confidenceThreshold === 'lenient' ? 'Lenient (high + medium + low)' :
            confidenceThreshold
          }
        </p>
      )}
    </div>
  )
}
