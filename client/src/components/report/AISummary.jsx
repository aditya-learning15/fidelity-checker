import { useState } from 'react'

function ChevronIcon({ down }) {
  return (
    <svg
      className={`h-4 w-4 text-gray-400 transition-transform duration-200 ${down ? 'rotate-180' : ''}`}
      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  )
}

/**
 * Collapsible AI summary panel. Starts expanded.
 *
 * Header: "Summary" label + chevron (click to toggle)
 * Body:   summary paragraph, smooth max-height transition
 *
 * @param {{ summary: string }} props
 */
export default function AISummary({ summary }) {
  const [expanded, setExpanded] = useState(true)

  return (
    <div className="border-b border-gray-100">
      {/* Header row — always visible */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-gray-50 transition-colors"
      >
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          AI Summary
        </span>
        <ChevronIcon down={expanded} />
      </button>

      {/* Collapsible body — max-height transition */}
      <div
        id="sb"
        style={{
          maxHeight:  expanded ? '200px' : '0',
          overflow:   'hidden',
          transition: 'max-height 200ms ease',
        }}
      >
        <p className="px-4 pb-3 text-xs text-gray-500 leading-relaxed">
          {summary}
        </p>
      </div>
    </div>
  )
}
