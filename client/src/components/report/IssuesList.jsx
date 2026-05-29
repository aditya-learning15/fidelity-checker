import { forwardRef, useImperativeHandle, useRef } from 'react'
import { useReport } from '../../lib/ReportContext.jsx'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CATEGORY_META = {
  layout:     { label: 'Layout' },
  color:      { label: 'Color' },
  typography: { label: 'Typography' },
  spacing:    { label: 'Spacing' },
}

const SEVERITY_META = {
  critical: {
    label:  'Critical',
    border: 'border-l-red-500',
    badge:  'bg-red-50 text-red-700',
    numBg:  'bg-red-500',
  },
  major: {
    label:  'Major',
    border: 'border-l-amber-500',
    badge:  'bg-amber-50 text-amber-700',
    numBg:  'bg-amber-500',
  },
  minor: {
    label:  'Minor',
    border: 'border-l-gray-300',
    badge:  'bg-gray-50 text-gray-500',
    numBg:  'bg-gray-400',
  },
}

// ---------------------------------------------------------------------------
// WrenchIcon
// ---------------------------------------------------------------------------

function WrenchIcon() {
  return (
    <svg
      className="h-3.5 w-3.5 shrink-0"
      fill="none" viewBox="0 0 24 24"
      stroke="currentColor" strokeWidth={2}
    >
      <path
        strokeLinecap="round" strokeLinejoin="round"
        d="M21.75 6.75a4.5 4.5 0 01-4.884 4.484c-1.076-.091-2.264.071-2.95.904l-7.152
           8.684a2.548 2.548 0 11-3.586-3.586l8.684-7.152c.833-.686.995-1.874.904-2.95a4.5
           4.5 0 016.336-4.486l-3.276 3.276a3.004 3.004 0 002.25 2.25l3.276-3.276c.256.565.398
           1.192.398 1.852z"
      />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// IssueCard
// ---------------------------------------------------------------------------

function IssueCard({ issue, isActive, onIssueClick, cardRefCallback, index = 0 }) {
  const { overrides, flagIssue, acceptIssue } = useReport()
  const override = overrides[issue.globalIndex]

  const severity = SEVERITY_META[issue.severity] ?? SEVERITY_META.minor
  const catLabel = CATEGORY_META[issue.category]?.label ?? issue.category

  const isFlagged = override === 'incorrect'
  const isAccepted = override === 'accepted'

  return (
    <div
      ref={cardRefCallback}
      role="button"
      tabIndex={0}
      onClick={() => onIssueClick(issue.globalIndex)}
      onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && onIssueClick(issue.globalIndex)}
      style={{ animationDelay: `${index * 40}ms` }}
      className={`issue-card-animate rounded-lg p-4 shadow-sm
        cursor-pointer transition-colors group
        ${isAccepted
          ? 'border border-green-200 bg-green-50/30'
          : isFlagged
          ? 'border border-l-4 border-l-amber-500 border-amber-200 bg-amber-50/20'
          : `border-l-4 ${severity.border} border border-gray-100 bg-white hover:border-gray-200`
        }`}
    >
      {/* Top row: badges on left, buttons on right */}
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <div className="flex flex-wrap items-center gap-2 flex-1">
          {/* Numbered badge — matches image annotation */}
          <span
            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full
              text-[10px] font-bold text-white shadow-sm ${severity.numBg}`}
          >
            {issue.globalIndex + 1}
          </span>

          {isAccepted ? (
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">
              Accepted
            </span>
          ) : isFlagged ? (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
              Flagged as incorrect
            </span>
          ) : (
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${severity.badge}`}>
              {severity.label}
            </span>
          )}

          <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700">
            {catLabel}
          </span>

          {issue.location && (
            <span className="text-xs text-gray-400 truncate">{issue.location}</span>
          )}

          {issue.referencedElement && (
            <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-600 truncate">
              {issue.referencedElement}
            </span>
          )}

          {issue.source === 'element-picker' && (
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
              Element pick
            </span>
          )}
        </div>

        {/* Flag and Accept buttons */}
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          {/* Flag as incorrect — thumbs down */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              flagIssue(issue.globalIndex)
            }}
            className={`p-1.5 rounded transition-colors ${
              isFlagged
                ? 'text-amber-600 bg-amber-100'
                : 'text-gray-400 hover:text-amber-600 hover:bg-amber-50'
            }`}
            title="Flag as incorrect — AI got this wrong"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M10 14H5.236a2 2 0 01-1.789-2.894l3.5-7A2 2 0 018.736 3h4.018a2 2 0 01.485.06l3.76.94m-7 10v5a2 2 0 002 2h.096c.5 0 .905-.405.905-.904 0-.715.211-1.413.608-2.008L17 13V4m-7 10h2m5-10h2a2 2 0 012 2v6a2 2 0 01-2 2h-2.5" />
            </svg>
          </button>

          {/* Accept as known deviation — checkmark */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              acceptIssue(issue.globalIndex)
            }}
            className={`p-1.5 rounded transition-colors ${
              isAccepted
                ? 'text-green-600 bg-green-50'
                : 'text-gray-400 hover:text-green-600 hover:bg-green-50'
            }`}
            title="Accept — known deviation, intentional"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Description */}
      <p className={`text-sm leading-relaxed mb-2 ${
        isAccepted
          ? 'text-gray-500 line-through'
          : isFlagged
          ? 'text-gray-800 italic'
          : 'text-gray-800'
      }`}>
        {issue.description}
      </p>

      {/* Suggestion */}
      {issue.suggestion && (
        <div className="flex items-start gap-1.5 text-indigo-700">
          <WrenchIcon />
          <p style={{ fontSize: '13px' }} className="leading-relaxed">
            <span className="font-bold">Fix:</span> {issue.suggestion}
          </p>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// IssuesList
// ---------------------------------------------------------------------------

/**
 * Renders a list of pre-filtered issues.
 * Filter state lives in RightPanel; this component only renders.
 *
 * Exposes scrollToIssue(globalIndex) via useImperativeHandle so the parent
 * can trigger programmatic scroll when an annotation pin is clicked.
 *
 * @param {{
 *   issues:            Array<{ globalIndex, severity, category, ... }>,
 *   activeIssueIndex:  number | null,
 *   onIssueClick:      (globalIndex: number) => void,
 *   scrollContainerRef: React.RefObject,
 * }} props
 */
const IssuesList = forwardRef(function IssuesList(
  { issues = [], activeIssueIndex = null, onIssueClick = () => {}, scrollContainerRef },
  ref,
) {
  // issueRefs keyed by globalIndex so scrollToIssue always finds the right card
  // regardless of which issues are currently visible after filtering.
  const issueRefs = useRef({})

  useImperativeHandle(ref, () => ({
    scrollToIssue(globalIndex) {
      const container = scrollContainerRef?.current
      const issueEl   = issueRefs.current[globalIndex]
      if (!container || !issueEl) return

      const containerTop = container.getBoundingClientRect().top
      const issueTop     = issueEl.getBoundingClientRect().top
      const rawOffset    = issueTop - containerTop + container.scrollTop
      const stickyOffset = 90  // approximate height of sticky filter bar

      container.scrollTo({ top: rawOffset - stickyOffset, behavior: 'smooth' })
    },
  }), [scrollContainerRef])

  return (
    <div className="p-4">
      {/* AI-identified issues */}
      <div className="space-y-3">
      {issues.length > 0 ? (
        issues.map((issue, i) => (
          <IssueCard
            key={String(issue.globalIndex)}
            issue={issue}
            isActive={issue.globalIndex === activeIssueIndex}
            onIssueClick={onIssueClick}
            cardRefCallback={el => { issueRefs.current[issue.globalIndex] = el }}
            index={i}
          />
        ))
      ) : (
        <div className="flex items-center justify-center py-16">
          <p className="text-sm text-gray-400">
            No issues in this category — looks good here. ✓
          </p>
        </div>
      )}
      </div>
    </div>
  )
})

export default IssuesList
