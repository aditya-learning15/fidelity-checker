import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { loadHistory, clearHistory, relativeTime } from '../lib/historyService.js'

export default function HistoryPage() {
  const navigate = useNavigate()
  const [entries, setEntries] = useState(() => loadHistory())

  const handleClear = () => {
    if (window.confirm(
      'Clear all analysis history? This cannot be undone.'
    )) {
      clearHistory()
      setEntries([])
    }
  }

  const scoreColor = (s) => {
    if (s >= 80) return '#3B6D11'  // green
    if (s >= 60) return '#854F0B'  // amber
    return '#A32D2D'               // red
  }

  return (
    <div style={{
      maxWidth: 720,
      margin: '0 auto',
      padding: '24px 16px'
    }}>

      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 24
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={() => navigate('/')}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: 13,
              color: 'var(--color-text-secondary)',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: 0
            }}
          >
            <svg
              style={{ fontSize: 14, width: 14, height: 14 }}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            Back
          </button>
          <span style={{
            fontSize: 16,
            fontWeight: 500,
            color: 'var(--color-text-primary)'
          }}>
            Analysis history
          </span>
        </div>

        {entries.length > 0 && (
          <button
            onClick={handleClear}
            style={{
              fontSize: 12,
              color: 'var(--color-text-secondary)',
              background: 'none',
              border: '0.5px solid var(--color-border-tertiary)',
              borderRadius: 'var(--border-radius-md)',
              padding: '5px 12px',
              cursor: 'pointer'
            }}
          >
            Clear all
          </button>
        )}
      </div>

      {/* Empty state */}
      {entries.length === 0 && (
        <div style={{
          textAlign: 'center',
          padding: '60px 24px',
          color: 'var(--color-text-secondary)'
        }}>
          <svg
            style={{
              fontSize: 36,
              display: 'block',
              marginBottom: 12,
              opacity: 0.4,
              width: 36,
              height: 36,
              margin: '0 auto 12px'
            }}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          <p style={{ fontSize: 14, margin: 0 }}>
            No analyses yet.
          </p>
          <p style={{
            fontSize: 12,
            margin: '4px 0 0',
            opacity: 0.7
          }}>
            Run your first analysis to see history here.
          </p>
        </div>
      )}

      {/* History list */}
      {entries.map(entry => (
        <div
          key={entry.id}
          title="Re-run this analysis to see the full report"
          style={{
            background: 'var(--color-background-primary)',
            border: '0.5px solid var(--color-border-tertiary)',
            borderRadius: 'var(--border-radius-lg)',
            padding: '14px 16px',
            marginBottom: 10,
            cursor: 'default'
          }}
        >
          {/* Top row */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: 10
          }}>
            <span style={{
              fontSize: 14,
              fontWeight: 500,
              color: 'var(--color-text-primary)'
            }}>
              {entry.figmaFrameName}
            </span>
            <span style={{
              fontSize: 11,
              color: 'var(--color-text-secondary)',
              flexShrink: 0,
              marginLeft: 12
            }}>
              {relativeTime(entry.timestamp)}
            </span>
          </div>

          {/* Score row */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginBottom: 8
          }}>
            <span style={{
              fontSize: 24,
              fontWeight: 500,
              color: scoreColor(entry.overallScore),
              lineHeight: 1
            }}>
              {entry.overallScore}
            </span>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {Object.entries(entry.categories).map(([cat, score]) => (
                <span
                  key={cat}
                  style={{
                    fontSize: 10,
                    padding: '2px 7px',
                    borderRadius: 20,
                    fontWeight: 500,
                    background: score >= 80
                      ? '#EAF3DE' : score >= 60
                      ? '#FAEEDA' : '#FCEBEB',
                    color: score >= 80
                      ? '#27500A' : score >= 60
                      ? '#633806' : '#791F1F'
                  }}
                >
                  {cat.charAt(0).toUpperCase() + cat.slice(1)} {score}
                </span>
              ))}
            </div>
          </div>

          {/* Bottom row */}
          <div style={{
            fontSize: 11,
            color: 'var(--color-text-secondary)'
          }}>
            {entry.totalIssues} issue{entry.totalIssues !== 1 ? 's' : ''}
            {entry.matchingSummary && (
              <span>
                {' · '}
                {entry.matchingSummary.matchedWithDom} of{' '}
                {entry.matchingSummary.totalFigmaElements} elements
                matched exactly
              </span>
            )}
            {entry.feedbackApplied?.suppressed > 0 && (
              <span>
                {' · '}
                {entry.feedbackApplied.suppressed} suppressed
                by feedback
              </span>
            )}
          </div>
        </div>
      ))}

    </div>
  )
}
