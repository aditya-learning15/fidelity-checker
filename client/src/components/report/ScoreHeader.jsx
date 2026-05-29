// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function scoreTextColor(score) {
  if (score >= 80) return 'text-green-600'
  if (score >= 60) return 'text-amber-500'
  return 'text-red-600'
}

function scoreBarColor(score) {
  if (score >= 80) return 'bg-green-500'
  if (score >= 60) return 'bg-amber-500'
  return 'bg-red-500'
}

// Flatten all issues across every category into one array
function collectIssues(categories) {
  return Object.values(categories).flatMap(cat => cat.issues ?? [])
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function CategoryCard({ label, score }) {
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          {label}
        </span>
        <span className={`text-sm font-bold ${scoreTextColor(score)}`}>
          {score}
        </span>
      </div>
      {/* Progress bar — width is dynamic so inline style is intentional */}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
        <div
          className={`h-1.5 rounded-full transition-all duration-500 ${scoreBarColor(score)}`}
          style={{ width: `${score}%` }}
        />
      </div>
    </div>
  )
}

function SeverityPill({ count, label, colorClass }) {
  if (!count) return null
  return (
    <span className={`font-medium ${colorClass}`}>
      {count} {label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// ScoreHeader
// ---------------------------------------------------------------------------

const CATEGORY_LABELS = {
  layout:     'Layout',
  color:      'Color',
  typography: 'Typography',
  spacing:    'Spacing',
}

/**
 * @param {{
 *   overallScore:  number,
 *   categories:    { layout, color, typography, spacing },
 *   summary:       string,
 *   pixelMismatch: { percent: number, pixels: number, total: number }
 * }} props
 */
export default function ScoreHeader({ overallScore, categories, summary, pixelMismatch }) {
  const allIssues = collectIssues(categories)
  const critical  = allIssues.filter(i => i.severity === 'critical').length
  const major     = allIssues.filter(i => i.severity === 'major').length
  const minor     = allIssues.filter(i => i.severity === 'minor').length

  const severityParts = [
    critical && { count: critical, label: 'critical', color: 'text-red-600' },
    major    && { count: major,    label: 'major',    color: 'text-amber-600' },
    minor    && { count: minor,    label: 'minor',    color: 'text-gray-500' },
  ].filter(Boolean)

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-8 shadow-sm">

      {/* ── Main row ── */}
      <div className="flex flex-col gap-6 sm:flex-row sm:gap-10">

        {/* Left: big score + summary */}
        <div className="flex-1">
          {/* Score number — 72px is a design-specific size, use inline style */}
          <div
            className={`font-semibold leading-none ${scoreTextColor(overallScore)}`}
            style={{ fontSize: '72px' }}
          >
            {overallScore}
          </div>
          <p className="mt-1 text-sm text-gray-400">Fidelity Score</p>
          <p className="mt-4 text-sm leading-relaxed text-gray-600">{summary}</p>
        </div>

        {/* Right: 2×2 category grid */}
        <div className="grid w-full grid-cols-2 gap-3 sm:w-72 sm:shrink-0">
          {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
            <CategoryCard
              key={key}
              label={label}
              score={categories[key]?.score ?? 0}
            />
          ))}
        </div>
      </div>

      {/* ── Bottom stats row ── */}
      <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-gray-100 pt-5 text-sm text-gray-500">

        {/* Pixel mismatch */}
        <span>
          <span className="font-semibold text-gray-700">
            {pixelMismatch.percent.toFixed(1)}%
          </span>
          {' '}of pixels differ{' '}
          <span className="text-gray-400">
            ({pixelMismatch.pixels.toLocaleString()} px)
          </span>
        </span>

        <span className="text-gray-200 hidden sm:inline">|</span>

        {/* Issue summary */}
        <span className="flex flex-wrap items-center gap-1.5">
          <span>
            <span className="font-semibold text-gray-700">{allIssues.length}</span>
            {' '}issue{allIssues.length !== 1 ? 's' : ''} found
          </span>
          {severityParts.length > 0 && (
            <>
              <span className="text-gray-300">(</span>
              {severityParts.map((p, i) => (
                <span key={p.label} className="flex items-center gap-1">
                  <span className={`font-medium ${p.color}`}>
                    {p.count} {p.label}
                  </span>
                  {i < severityParts.length - 1 && (
                    <span className="text-gray-300">,</span>
                  )}
                </span>
              ))}
              <span className="text-gray-300">)</span>
            </>
          )}
        </span>
      </div>
    </div>
  )
}
