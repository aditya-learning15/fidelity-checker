import { useState, useMemo, useRef, useCallback, useEffect } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useReport } from '../lib/ReportContext.jsx'
import TopBar from '../components/report/TopBar.jsx'
import LeftPanel from '../components/report/LeftPanel.jsx'
import RightPanel from '../components/report/RightPanel.jsx'
import ElementPickerDrawer from '../components/report/ElementPickerDrawer.jsx'

/**
 * Fixed-viewport report page. No scrolling at the page/body level.
 *
 * Layout (h-screen, flex-col, overflow-hidden):
 *   TopBar     — 44px, fixed height
 *   ─── flex-1 flex overflow-hidden ──────────────────────
 *   LeftPanel  — 58%, dark, image comparison viewer
 *   RightPanel — 42%, white, owns all vertical scrolling
 *
 * State flow:
 *   activeIssueIndex lives here (shared between both panels)
 *   handleBadgeClick  → sets active + scrolls issue card into view
 *   handleIssueClick  → sets active only (user is already looking at the card)
 *   issuesListRef     → forwarded to RightPanel → IssuesList.scrollToIssue()
 */
export default function ReportPage() {
  const { report, setReport, overrides } = useReport()
  const location = useLocation()
  const navigate = useNavigate()

  const [activeIssueIndex, setActiveIssueIndex] = useState(null)
  const [showElementPickerDrawer, setShowElementPickerDrawer] = useState(false)
  const [shareLabel, setShareLabel] = useState('Copy link')
  const [exportLabel, setExportLabel] = useState('Export PDF')
  const [exportDisabled, setExportDisabled] = useState(false)

  // Per-frame virtual scroll banner skip preference
  const frameKey = `skipPickerPrompt_${report?.figmaFrameId ?? report?.figmaFrameName ?? ''}`
  const [skipForFrame, setSkipForFrame] = useState(
    () => frameKey ? localStorage.getItem(frameKey) === 'true' : false
  )

  // Ref to IssuesList's imperative handle ({ scrollToIssue })
  const issuesListRef = useRef(null)

  // Decode shared report from URL on mount
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const data = params.get('data')
    if (data && !report) {
      try {
        const decoded = JSON.parse(decodeURIComponent(atob(data)))
        setReport(decoded)
      } catch (e) {
        console.error('Failed to decode shared report:', e)
        navigate('/', {
          state: { error: 'This link appears to be invalid.' }
        })
      }
    }
  }, [])

  // Flatten all issues across categories, assigning a stable globalIndex.
  // Memoised so it only recomputes when report changes.
  const allIssues = useMemo(() => {
    if (!report) return []
    let idx = 0
    return Object.entries(report.categories).flatMap(([cat, data]) =>
      (data.issues ?? []).map(issue => ({
        ...issue,
        category:    cat,
        globalIndex: idx++,
      }))
    )
  }, [report])

  // Clicking an annotation badge on the image:
  //   1. Sets the active index → card highlights, annotation pulses
  //   2. Scrolls the right panel to bring the matching card into view
  const handleBadgeClick = useCallback((globalIndex) => {
    setActiveIssueIndex(prev => prev === globalIndex ? null : globalIndex)
    issuesListRef.current?.scrollToIssue(globalIndex)
  }, [])

  // Clicking an issue card in the list:
  //   1. Sets the active index → annotation pulses on the image
  //   2. No scroll — the user is already looking at the card
  const handleIssueClick = useCallback((globalIndex) => {
    setActiveIssueIndex(prev => prev === globalIndex ? null : globalIndex)
  }, [])

  // Share link — encodes report data in URL
  const handleShare = async () => {
    const reportForShare = {
      ...report,
      images: {
        figmaBase64: null,
        screenshotBase64: null,
        diffBase64: null
      }
    }

    const encoded = btoa(
      encodeURIComponent(JSON.stringify(reportForShare))
    )
    const url = window.location.origin + '/report?data=' + encoded

    try {
      await navigator.clipboard.writeText(url)
      setShareLabel('Copied!')
      setTimeout(() => setShareLabel('Copy link'), 2000)
    } catch {
      // Fallback for browsers that block clipboard without HTTPS
      const ta = document.createElement('textarea')
      ta.value = url
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      setShareLabel('Copied!')
      setTimeout(() => setShareLabel('Copy link'), 2000)
    }
  }

  // Export PDF — renders right panel to PDF with header and review section
  const handleExport = async () => {
    setExportLabel('Generating...')
    setExportDisabled(true)

    // Temporarily prepare the report for PDF capture
    const rightPanel = document.getElementById('right-panel')
    const originalWidth = rightPanel.style.width
    const originalOverflow = rightPanel.style.overflow

    // Expand right panel to full width for PDF
    rightPanel.style.width = '100%'
    rightPanel.style.overflow = 'visible'
    rightPanel.style.maxHeight = 'none'

    // Expand summary if collapsed
    const summaryBody = document.querySelector('[id="sb"]')
    const wasSummaryClosed = summaryBody && summaryBody.style.maxHeight === '0px'
    if (wasSummaryClosed && summaryBody) {
      summaryBody.style.maxHeight = '500px'
      summaryBody.style.paddingBottom = '10px'
    }

    // Add PDF header
    const header = document.createElement('div')
    header.id = 'pdf-header'
    header.style.cssText = 'padding: 16px 14px 8px; border-bottom: 1px solid #e5e7eb; margin-bottom: 8px;'
    header.innerHTML = `
      <div style="font-size: 18px; font-weight: 500; margin-bottom: 4px;">
        Fidelity Report — ${report.figmaFrameName ?? 'Design Review'}
      </div>
      <div style="font-size: 12px; color: #6b7280;">
        Generated ${new Date().toLocaleDateString('en-GB', {
          day: 'numeric', month: 'long', year: 'numeric'
        })} · Score: ${report.overallScore}/100
      </div>
    `
    rightPanel.prepend(header)

    // Add manually reviewed section if overrides exist
    const dismissedCount = Object.values(overrides ?? {})
      .filter(v => v === 'incorrect').length
    const acceptedCount = Object.values(overrides ?? {})
      .filter(v => v === 'accepted').length

    let reviewedSection = null
    if (dismissedCount > 0 || acceptedCount > 0) {
      reviewedSection = document.createElement('div')
      reviewedSection.id = 'pdf-reviewed'
      reviewedSection.style.cssText = 'padding: 16px 14px; border-top: 1px solid #e5e7eb; margin-top: 16px;'
      reviewedSection.innerHTML = `
        <div style="font-size: 14px; font-weight: 500; margin-bottom: 8px;">
          Manually reviewed
        </div>
        ${dismissedCount > 0 ? `<div style="font-size: 12px; color: #6b7280; margin-bottom: 4px;">
          ${dismissedCount} issue${dismissedCount > 1 ? 's' : ''} flagged as incorrect observation
        </div>` : ''}
        ${acceptedCount > 0 ? `<div style="font-size: 12px; color: #6b7280;">
          ${acceptedCount} issue${acceptedCount > 1 ? 's' : ''} accepted as known deviation
        </div>` : ''}
      `
      rightPanel.appendChild(reviewedSection)
    }

    const opt = {
      margin: [10, 10, 10, 10],
      filename: `fidelity-report-${report.overallScore}-${new Date().toISOString().slice(0, 10)}.pdf`,
      image: { type: 'jpeg', quality: 0.92 },
      html2canvas: {
        scale: 2,
        useCORS: true,
        logging: false,
        windowWidth: 680
      },
      jsPDF: {
        unit: 'mm',
        format: 'a4',
        orientation: 'portrait'
      }
    }

    try {
      const { default: html2pdf } = await import('html2pdf.js')
      await html2pdf().set(opt).from(rightPanel).save()
    } catch (e) {
      console.error('PDF export failed:', e)
      alert('PDF export failed. Please try again.')
    } finally {
      // Restore everything
      rightPanel.style.width = originalWidth
      rightPanel.style.overflow = originalOverflow
      rightPanel.style.maxHeight = ''
      if (wasSummaryClosed && summaryBody) {
        summaryBody.style.maxHeight = '0px'
        summaryBody.style.paddingBottom = '0px'
      }
      header.remove()
      reviewedSection?.remove()

      setExportLabel('Export PDF')
      setExportDisabled(false)
    }
  }

  if (!report) {
    return <Navigate to="/" replace />
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-[#18181B]">

      {/* ── Top bar ── */}
      <TopBar
        score={report.overallScore}
        onExport={handleExport}
        exportLabel={exportLabel}
        exportDisabled={exportDisabled}
        onShare={handleShare}
        shareLabel={shareLabel}
      />

      {/* ── Extraction gap banner ── */}
      {report.extractionGaps?.message && !skipForFrame && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-3">
          <div className="flex items-center justify-between gap-3 mb-2">
            <div className="flex items-center gap-3">
              <svg
                className="h-5 w-5 text-amber-600 shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 8v4m0 4v.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <p className="text-sm text-amber-800">{report.extractionGaps.message}</p>
            </div>
            <button
              type="button"
              onClick={() => setShowElementPickerDrawer(true)}
              className="text-sm font-medium text-amber-700 hover:text-amber-900 transition-colors shrink-0"
            >
              Add element styles →
            </button>
          </div>

          {/* Checkbox to skip this frame */}
          <label style={{
            fontSize: 11,
            color: 'var(--color-text-secondary)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            cursor: 'pointer'
          }}>
            <input
              type="checkbox"
              checked={skipForFrame}
              onChange={e => {
                setSkipForFrame(e.target.checked)
                if (frameKey) {
                  if (e.target.checked) {
                    localStorage.setItem(frameKey, 'true')
                  } else {
                    localStorage.removeItem(frameKey)
                  }
                }
              }}
              style={{ cursor: 'pointer' }}
            />
            Don't ask again for this frame
          </label>
        </div>
      )}

      {/* ── Two-panel area (fills remaining viewport height) ── */}
      <div className="flex-1 flex overflow-hidden">
        <LeftPanel
          figmaBase64={report.images.figmaBase64}
          screenshotBase64={report.images.screenshotBase64}
          diffBase64={report.images.diffBase64}
          issues={allIssues}
          activeIssueIndex={activeIssueIndex}
          onBadgeClick={handleBadgeClick}
        />

        <RightPanel
          report={report}
          allIssues={allIssues}
          activeIssueIndex={activeIssueIndex}
          onIssueClick={handleIssueClick}
          issuesListRef={issuesListRef}
        />
      </div>

      {/* ── Element picker drawer ── */}
      <ElementPickerDrawer
        isOpen={showElementPickerDrawer}
        onClose={() => setShowElementPickerDrawer(false)}
        report={report}
      />

    </div>
  )
}
