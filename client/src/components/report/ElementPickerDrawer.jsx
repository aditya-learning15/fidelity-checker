import { useState } from 'react'
import apiClient from '../../lib/apiClient.js'
import { useReport } from '../../lib/ReportContext.jsx'
import { saveToHistory } from '../../lib/historyService.js'

// Minified bookmarklet for element picker (focused extraction)
const ELEMENT_PICKER_BOOKMARKLET = `javascript:(function(){const extract=(el,depth)=>{if(depth>4)return null;const cs=getComputedStyle(el);const props=['display','flexDirection','gap','padding','paddingTop','paddingRight','paddingBottom','paddingLeft','margin','marginTop','marginRight','marginBottom','marginLeft','width','height','backgroundColor','color','fontSize','fontFamily','fontWeight','lineHeight','letterSpacing','borderRadius','border','boxShadow','position','alignItems','justifyContent'];const styles={};props.forEach(p=>{styles[p]=cs[p];});const rect=el.getBoundingClientRect();const node={tag:el.tagName.toLowerCase(),id:el.id||null,classes:el.className||null,styles,rect:{x:Math.round(rect.x),y:Math.round(rect.y),w:Math.round(rect.width),h:Math.round(rect.height)},children:[]};for(const child of el.children){const c=extract(child,depth+1);if(c)node.children.push(c);}return node;};const data={url:location.href,viewport:{w:innerWidth,h:innerHeight},tree:extract(document.body,0)};const json=JSON.stringify(data);navigator.clipboard.writeText(json).then(()=>alert('Computed styles copied to clipboard. Paste into the fidelity checker.'),()=>{const ta=document.createElement('textarea');ta.value=json;document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);alert('Copied! Paste into the fidelity checker.');});})();`

export default function ElementPickerDrawer({ isOpen, onClose, report }) {
  const { setReport, figmaUrl, figmaToken } = useReport()
  const [elementPickerJson, setElementPickerJson] = useState('')
  const [jsonError, setJsonError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  const handleBlur = () => {
    if (!elementPickerJson.trim()) {
      setJsonError('')
      return
    }
    try {
      JSON.parse(elementPickerJson)
      setJsonError('')
    } catch {
      setJsonError("This doesn't look like valid extractor output. Try running the bookmarklet again.")
    }
  }

  const handleSubmit = async () => {
    if (!elementPickerJson.trim()) {
      setJsonError('Please paste the element picker output')
      return
    }

    if (!figmaUrl || !figmaToken) {
      setSubmitError('Missing Figma credentials. Please run the analysis again.')
      return
    }

    setIsSubmitting(true)
    setSubmitError('')

    try {
      const { data } = await apiClient.post('/api/analyze/enrich', {
        figmaUrl,
        figmaToken,
        elementPickerJson,
        existingReport: report,
      })

      // Merge new issues and updated score into report
      if (data.newIssues && Array.isArray(data.newIssues)) {
        const updatedReport = {
          ...report,
          categories: JSON.parse(JSON.stringify(report.categories ?? {})),
        }

        // Add new arithmetic issues to their respective categories
        for (const issue of data.newIssues) {
          const catName = issue.category
          if (!updatedReport.categories[catName]) {
            updatedReport.categories[catName] = { issues: [], score: 100 }
          }
          if (!updatedReport.categories[catName].issues) {
            updatedReport.categories[catName].issues = []
          }

          // Check if this issue replaces an existing one
          const existingIdx = updatedReport.categories[catName].issues.findIndex(existing =>
            existing.referencedElement === issue.referencedElement &&
            existing.property === issue.property
          )

          if (existingIdx >= 0) {
            updatedReport.categories[catName].issues[existingIdx] = issue
          } else {
            updatedReport.categories[catName].issues.push(issue)
          }
        }

        if (data.updatedScore !== undefined) {
          updatedReport.overallScore = data.updatedScore
        }

        setReport(updatedReport)
        saveToHistory(updatedReport)
      }

      setElementPickerJson('')
      onClose()
    } catch (err) {
      setSubmitError(err.response?.data?.error ?? 'Failed to process element picker data')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!isOpen) return null

  return (
    <>
      {/* ── Overlay ── */}
      <div
        className="fixed inset-0 z-40 bg-black/50 transition-opacity"
        onClick={onClose}
      />

      {/* ── Drawer panel ── */}
      <div className="fixed right-0 top-0 bottom-0 z-50 w-[420px] bg-white shadow-lg flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">Add element styles</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Close drawer"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Instructions */}
          <div className="space-y-3">
            <p className="text-sm font-medium text-gray-700">Step-by-step:</p>
            <ol className="space-y-2 list-none">
              {[
                <>Drag this link to your bookmarks bar: <a href={ELEMENT_PICKER_BOOKMARKLET} className="inline-block rounded bg-indigo-600 px-2 py-0.5 text-[10px] font-semibold text-white no-underline hover:bg-indigo-700 transition-colors cursor-grab active:cursor-grabbing">Element Picker</a></>,
                'In your app, click on a job card element (or any component inside the virtual scroll)',
                'Click the "Element Picker" bookmark — it captures that element',
                'Paste the result below',
              ].map((step, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-gray-600">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-[10px] font-bold text-indigo-700 mt-0.5">
                    {i + 1}
                  </span>
                  <span className="leading-relaxed pt-0.5">{step}</span>
                </li>
              ))}
            </ol>
          </div>

          {/* Textarea */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">
              Element picker JSON
            </label>
            <textarea
              value={elementPickerJson}
              onChange={e => { setElementPickerJson(e.target.value); setJsonError('') }}
              onBlur={handleBlur}
              placeholder={'{ "url": "...", "viewport": {...}, "tree": {...} }'}
              spellCheck={false}
              className={`w-full rounded-lg border px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition resize-none ${
                jsonError ? 'border-red-400 bg-red-50' : 'border-gray-300 bg-white hover:border-gray-400'
              }`}
              style={{ fontFamily: 'ui-monospace, monospace', height: '160px' }}
            />
            {jsonError && (
              <p className="text-xs text-red-600">{jsonError}</p>
            )}
          </div>

          {submitError && (
            <div className="rounded-lg bg-red-50 border border-red-200 p-3">
              <p className="text-xs text-red-700">{submitError}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 px-6 py-4 space-y-2">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting || !elementPickerJson.trim()}
            className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? 'Analyzing…' : 'Re-analyze with element styles'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
          >
            Cancel
          </button>
        </div>
      </div>
    </>
  )
}
