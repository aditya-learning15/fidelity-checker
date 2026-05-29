import { useRef, useState, useMemo, useEffect } from 'react'
import { useReport } from '../../lib/ReportContext.jsx'
import CompactScoreStrip from './CompactScoreStrip.jsx'
import AISummary from './AISummary.jsx'
import FilterBar from './FilterBar.jsx'
import IssuesList from './IssuesList.jsx'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SEVERITY_ORDER = { critical: 0, major: 1, minor: 2 }

// ---------------------------------------------------------------------------
// RightPanel
// ---------------------------------------------------------------------------

/**
 * Scrollable right column (42% width). Owns ALL vertical scrolling.
 *
 * Structure (top → bottom):
 *   CompactScoreStrip  — flex-shrink-0, never scrolls away
 *   ─── scrollable area ───────────────────────────────────
 *   AISummary          — collapsible
 *   FilterBar          — sticky top-0 within scroll container
 *   IssuesList         — filtered issue cards
 *
 * The scrollContainerRef is created here and forwarded to IssuesList so that
 * scrollToIssue() scrolls this container, not window.
 *
 * @param {{
 *   report:            object,
 *   allIssues:         Array,
 *   activeIssueIndex:  number | null,
 *   onIssueClick:      (globalIndex: number) => void,
 *   issuesListRef:     React.RefObject,
 * }} props
 */
export default function RightPanel({
  report,
  allIssues,
  activeIssueIndex,
  onIssueClick,
  issuesListRef,
}) {
  const { effectiveScore, overrides } = useReport()
  const scrollContainerRef = useRef(null)

  const [activeCategory, setActiveCategory] = useState('all')
  const [activeSeverity, setActiveSeverity] = useState('all')
  const [namingTipDismissed, setNamingTipDismissed] = useState(
    () => localStorage.getItem('namingGuideDismissed') === 'true'
  )

  // Count flagged and accepted issues
  const flaggedCount = Object.values(overrides).filter(v => v === 'incorrect').length
  const acceptedCount = Object.values(overrides).filter(v => v === 'accepted').length

  // Calculate match rate for naming tip
  const matchRate = report?.matchingSummary
    ? Math.max(0, report.matchingSummary.matchedWithDom) /
      Math.max(1, report.matchingSummary.totalFigmaElements)
    : 1

  // Show naming tip if match rate is low and not dismissed
  const showNamingTip = matchRate < 0.4 && !namingTipDismissed

  const handleDismissNamingTip = () => {
    localStorage.setItem('namingGuideDismissed', 'true')
    setNamingTipDismissed(true)
  }

  // Filter + sort — runs only when deps change
  const filtered = useMemo(() =>
    allIssues
      .filter(issue =>
        (activeCategory === 'all' || issue.category === activeCategory) &&
        (activeSeverity === 'all' || issue.severity === activeSeverity)
      )
      .sort((a, b) =>
        (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99)
      ),
    [allIssues, activeCategory, activeSeverity]
  )

  return (
    <div
      id="right-panel"
      className="flex flex-col overflow-hidden border-l border-gray-200 bg-white"
      style={{ width: '42%' }}
    >
      {/* Score strip — never scrolls */}
      <CompactScoreStrip
        overallScore={report.overallScore}
        effectiveScore={effectiveScore}
        categories={report.categories}
        pixelMismatch={report.pixelMismatch}
        issues={allIssues}
        flaggedCount={flaggedCount}
        acceptedCount={acceptedCount}
        confidenceThreshold={report.confidenceThreshold}
      />

      {/* Naming guide tip — shows when match rate is low */}
      {showNamingTip && (
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
            padding: '8px 14px',
            borderBottom: '0.5px solid #e5e7eb',
            background: '#FAEEDA',
          }}
        >
          <svg
            style={{
              fontSize: 14,
              color: '#BA7517',
              flexShrink: 0,
              marginTop: 1,
              width: 14,
              height: 14,
            }}
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
          </svg>
          <span
            style={{
              fontSize: 11,
              color: '#633806',
              flex: 1,
              lineHeight: 1.5,
            }}
          >
            Low match rate — {Math.round(matchRate * 100)}% of design elements
            were matched precisely. Name your Figma layers to improve results.
          </span>
          <button
            onClick={handleDismissNamingTip}
            aria-label="Dismiss naming tip"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
              color: '#BA7517',
              flexShrink: 0,
              width: 13,
              height: 13,
            }}
          >
            <svg
              style={{ width: 13, height: 13 }}
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z" />
            </svg>
          </button>
        </div>
      )}

      {/* Scrollable content area */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">

        {/* AI summary — collapsible */}
        <AISummary summary={report.summary} />

        {/* Filter bar — sticky within scroll container */}
        <div className="sticky top-0 z-10 bg-white border-b border-gray-100">
          <FilterBar
            issues={allIssues}
            activeCategory={activeCategory}
            activeSeverity={activeSeverity}
            onCategoryChange={setActiveCategory}
            onSeverityChange={setActiveSeverity}
          />
        </div>

        {/* Issues list */}
        <IssuesList
          ref={issuesListRef}
          issues={filtered}
          activeIssueIndex={activeIssueIndex}
          onIssueClick={onIssueClick}
          scrollContainerRef={scrollContainerRef}
        />
      </div>
    </div>
  )
}
