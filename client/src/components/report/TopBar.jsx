import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useReport } from '../../lib/ReportContext.jsx'
import { getHistoryCount } from '../../lib/historyService.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function scoreHex(score) {
  if (score >= 80) return '#16a34a'
  if (score >= 60) return '#d97706'
  return '#dc2626'
}

function ArrowLeftIcon() {
  return (
    <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24"
      stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// TopBar
// ---------------------------------------------------------------------------

/**
 * Fixed 44px top bar.
 * Left: ← New analysis (clears report context, navigates to /)
 * Right: compact score · Export PDF · Share link
 *
 * @param {{
 *   score: number,
 *   onExport: () => void,
 *   exportLabel: string,
 *   exportDisabled: boolean,
 *   onShare: () => void,
 *   shareLabel: string
 * }} props
 */
export default function TopBar({ score, onExport, exportLabel, exportDisabled, onShare, shareLabel }) {
  const navigate   = useNavigate()
  const { setReport } = useReport()
  const historyCount = getHistoryCount()

  const handleBack = () => {
    setReport(null)
    navigate('/')
  }

  return (
    <div
      className="flex-shrink-0 flex items-center justify-between border-b border-gray-200 bg-white px-4"
      style={{ height: '44px', zIndex: 20 }}
    >
      {/* ── Left — back link + history ── */}
      <div className="flex items-center gap-4">
        <button
          onClick={handleBack}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 transition-colors"
        >
          <ArrowLeftIcon />
          New analysis
        </button>

        <a
          href="/history"
          style={{
            fontSize: '12px',
            color: 'var(--color-text-secondary)',
            textDecoration: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: 5
          }}
        >
          <svg
            style={{ fontSize: 14, width: 14, height: 14 }}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          History
          {historyCount > 0 && (
            <span style={{
              background: '#534AB7',
              color: '#fff',
              fontSize: 9,
              fontWeight: 700,
              width: 16,
              height: 16,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              lineHeight: 1
            }}>
              {historyCount > 9 ? '9+' : historyCount}
            </span>
          )}
        </a>

        {historyCount > 0 && (
          <a
            href="/feedback"
            style={{
              fontSize: '12px',
              color: 'var(--color-text-secondary)',
              textDecoration: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: 5
            }}
          >
            <svg
              style={{ fontSize: 14, width: 14, height: 14 }}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path d="M3 3v7a7 7 0 1 0 14 0V3" />
              <path d="M9 11l3 3 5-5" />
            </svg>
            Feedback
          </a>
        )}
      </div>

      {/* ── Right — score + actions ── */}
      <div className="flex items-center gap-3">
        {/* Compact score */}
        <div className="flex items-baseline gap-0.5">
          <span
            className="text-xl font-semibold leading-none"
            style={{ color: scoreHex(score) }}
          >
            {score}
          </span>
          <span className="text-xs text-gray-400">/100</span>
        </div>

        <div className="h-4 w-px bg-gray-200" />

        {/* Export PDF */}
        <button
          onClick={onExport}
          disabled={exportDisabled}
          className={`rounded border px-2.5 py-1 text-xs font-medium transition-colors ${
            exportDisabled
              ? 'border-gray-100 bg-gray-50 text-gray-400 cursor-not-allowed'
              : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:text-gray-900'
          }`}
        >
          {exportLabel}
        </button>

        {/* Share link */}
        <button
          onClick={onShare}
          className="rounded border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 hover:border-gray-300 hover:text-gray-900 transition-colors"
        >
          {shareLabel}
        </button>
      </div>
    </div>
  )
}
