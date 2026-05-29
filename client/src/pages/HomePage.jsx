import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import apiClient from '../lib/apiClient.js'
import { useReport } from '../lib/ReportContext.jsx'
import { getConfidenceThreshold, setPreference } from '../lib/preferencesService.js'
import AnalysisLoader from '../components/AnalysisLoader.jsx'

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ---------------------------------------------------------------------------
// Icons (inline SVG — no external library)
// ---------------------------------------------------------------------------
function EyeIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  )
}

function EyeOffIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 4.411m0 0L21 21" />
    </svg>
  )
}

function UploadIcon() {
  return (
    <svg className="mx-auto h-10 w-10 text-gray-300" stroke="currentColor" fill="none" viewBox="0 0 48 48" aria-hidden="true">
      <path d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// AnalysisSettings
// ---------------------------------------------------------------------------
const THRESHOLDS = [
  {
    value: 'strict',
    label: 'Strict',
    description: 'High confidence only. Fewer exact diffs, lowest false positive rate.'
  },
  {
    value: 'balanced',
    label: 'Balanced',
    description: 'High and medium confidence. Recommended for most designs.'
  },
  {
    value: 'lenient',
    label: 'Lenient',
    description: 'Includes lower confidence matches. More exact diffs but some may be incorrect.'
  }
]

function AnalysisSettings() {
  const [isOpen, setIsOpen] = useState(false)
  const [threshold, setThreshold] = useState(() => getConfidenceThreshold())

  const handleThresholdChange = (value) => {
    setThreshold(value)
    setPreference('confidenceThreshold', value)
  }

  const currentThresholdDesc = THRESHOLDS.find(t => t.value === threshold)?.description || ''

  return (
    <div className="space-y-0">
      {/* Header — always visible */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <svg
            className="h-4 w-4"
            style={{ color: 'var(--color-text-secondary)' }}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <circle cx="12" cy="12" r="1" />
            <path d="M12 19v-2m0-12V5" />
            <path d="M19 12h2m-16 0H3" />
            <path d="M16.657 7.343l1.414-1.414m-11.314 0l-1.414 1.414" />
            <path d="M16.657 16.657l1.414 1.414m-11.314 0l-1.414-1.414" />
          </svg>
          <span className="text-sm font-medium text-gray-700">
            Analysis settings
          </span>
        </div>
        <svg
          className={`h-4 w-4 text-gray-400 transition-transform duration-200 ${
            isOpen ? 'rotate-180' : ''
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Expanded content */}
      {isOpen && (
        <div
          style={{
            background: 'var(--color-background-secondary)',
            border: '0.5px solid var(--color-border-tertiary)',
            borderTop: 'none',
            borderRadius: 'var(--border-radius-lg)',
            padding: '14px 16px',
            marginTop: 0
          }}
        >
          <div
            style={{
              fontSize: '12px',
              fontWeight: 500,
              color: 'var(--color-text-primary)',
              marginBottom: '6px'
            }}
          >
            Match confidence threshold
          </div>

          {/* Pill group */}
          <div
            style={{
              display: 'flex',
              border: '0.5px solid var(--color-border-tertiary)',
              borderRadius: 'var(--border-radius-md)',
              overflow: 'hidden',
              marginBottom: '10px'
            }}
          >
            {THRESHOLDS.map((t, i) => (
              <button
                type="button"
                key={t.value}
                onClick={() => handleThresholdChange(t.value)}
                style={{
                  flex: 1,
                  padding: '6px 12px',
                  fontSize: '12px',
                  border: 'none',
                  cursor: 'pointer',
                  transition: 'background 0.15s, color 0.15s',
                  borderRight: i < THRESHOLDS.length - 1
                    ? '0.5px solid var(--color-border-tertiary)'
                    : 'none',
                  background: threshold === t.value
                    ? '#534AB7'
                    : 'var(--color-background-primary)',
                  color: threshold === t.value
                    ? '#fff'
                    : 'var(--color-text-secondary)'
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Description */}
          <div
            style={{
              fontSize: '11px',
              color: 'var(--color-text-secondary)',
              lineHeight: 1.5
            }}
          >
            {currentThresholdDesc}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// NamingGuide
// ---------------------------------------------------------------------------
function NamingGuide() {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className="space-y-0">
      {/* Header — always visible */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <svg
            className="h-4 w-4 text-amber-600"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
          </svg>
          <span className="text-sm font-medium text-gray-700">
            Get more precise results
          </span>
        </div>
        <svg
          className={`h-4 w-4 text-gray-400 transition-transform duration-200 ${
            isOpen ? 'rotate-180' : ''
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Expanded content */}
      {isOpen && (
        <div
          className="px-4 py-4 border-t border-amber-200"
          style={{
            background: '#FAEEDA',
            borderColor: '#FAC775',
          }}
        >
          {/* Two-column layout */}
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            {/* LEFT COLUMN */}
            <div>
              <h3
                className="text-xs font-medium mb-2 uppercase tracking-wider"
                style={{ color: '#633806' }}
              >
                Name these layers
              </h3>
              <div className="space-y-1.5">
                {[
                  ['Navigation bar', 'Navigation Bar'],
                  ['Primary button', 'Primary Button'],
                  ['Sidebar / rail', 'Side Rail'],
                  ['Card container', 'Job Card or [Type] Card'],
                  ['Card title text', 'Job Title / Card Title'],
                  ['Card ID', 'Job ID / Card ID'],
                  ['Search input', 'Search Bar'],
                  ['Filter panel', 'Filter Panel'],
                  ['Tab group', 'Tab Group'],
                  ['Page header', 'Title Bar [Name]'],
                ].map(([layer, recommended], i) => (
                  <div key={i} className="text-xs flex items-center gap-2">
                    <span className="text-gray-500">{layer}</span>
                    <span className="text-gray-400">→</span>
                    <span
                      className="font-medium"
                      style={{ color: '#412402' }}
                    >
                      {recommended}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* RIGHT COLUMN */}
            <div>
              <h3
                className="text-xs font-medium mb-2 uppercase tracking-wider"
                style={{ color: '#633806' }}
              >
                Avoid these names
              </h3>
              <div className="space-y-1.5">
                {[
                  'Frame 1, Frame 47',
                  'Rectangle 23',
                  'Group, Group 2',
                  'Component 12',
                  'Vector, Path',
                  'Any name with only numbers',
                ].map((name, i) => (
                  <div key={i} className="text-xs flex items-center gap-2">
                    <svg
                      className="h-3 w-3 text-red-500 flex-shrink-0"
                      fill="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z" />
                    </svg>
                    <span className="text-gray-600">{name}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Separator + explanation */}
          <div className="mt-3 pt-3 border-t border-amber-300/50">
            <p className="text-xs text-gray-600 leading-relaxed">
              Named layers get exact property comparison. Unnamed layers fall
              back to visual estimation.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// FigmaUrlInput
// ---------------------------------------------------------------------------
function FigmaUrlInput({ figmaUrl, figmaToken, onUrlChange, onTokenChange }) {
  const [showToken, setShowToken] = useState(false)
  const [urlError, setUrlError] = useState('')

  const handleUrlBlur = () => {
    if (figmaUrl.trim() && !figmaUrl.includes('figma.com')) {
      setUrlError('Please enter a valid Figma URL (must contain figma.com)')
    } else {
      setUrlError('')
    }
  }

  return (
    <div className="space-y-4">
      {/* Figma URL */}
      <div>
        <label htmlFor="figma-url" className="block text-sm font-medium text-gray-700 mb-1">
          Figma Frame URL
        </label>
        <input
          id="figma-url"
          type="url"
          value={figmaUrl}
          onChange={e => onUrlChange(e.target.value)}
          onBlur={handleUrlBlur}
          placeholder="https://www.figma.com/design/..."
          className={`w-full rounded-lg border px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition ${
            urlError
              ? 'border-red-400 bg-red-50'
              : 'border-gray-300 bg-white hover:border-gray-400'
          }`}
        />
        {urlError && (
          <p className="mt-1 text-xs text-red-600">{urlError}</p>
        )}
      </div>

      {/* Personal Access Token */}
      <div>
        <label htmlFor="figma-token" className="block text-sm font-medium text-gray-700 mb-1">
          Figma Personal Access Token
        </label>
        <div className="relative">
          <input
            id="figma-token"
            type={showToken ? 'text' : 'password'}
            value={figmaToken}
            onChange={e => onTokenChange(e.target.value)}
            placeholder="figd_••••••••••••••••"
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 pr-10 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition hover:border-gray-400"
          />
          <button
            type="button"
            onClick={() => setShowToken(v => !v)}
            aria-label={showToken ? 'Hide token' : 'Show token'}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition"
          >
            {showToken ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        </div>
        <p className="mt-1.5 text-xs text-gray-400">
          Get your token at{' '}
          <a
            href="https://www.figma.com/settings"
            target="_blank"
            rel="noreferrer"
            className="text-indigo-600 hover:underline"
          >
            figma.com → Account Settings → Personal Access Tokens
          </a>
        </p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ScreenshotUpload
// ---------------------------------------------------------------------------
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp']

function ScreenshotUpload({ file, onFileChange }) {
  const [isDragging, setIsDragging] = useState(false)
  const [previewUrl, setPreviewUrl] = useState(null)
  const inputRef = useRef(null)

  // Create / revoke object URL when file changes to avoid memory leaks
  useEffect(() => {
    if (!file) {
      setPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const handleFile = useCallback((f) => {
    if (!f || !ACCEPTED_TYPES.includes(f.type)) return
    onFileChange(f)
  }, [onFileChange])

  const handleDragOver = (e) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = (e) => {
    e.preventDefault()
    setIsDragging(false)
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setIsDragging(false)
    handleFile(e.dataTransfer.files[0])
  }

  const handleRemove = () => {
    onFileChange(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        Screenshot
      </label>

      {file && previewUrl ? (
        /* Preview state */
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
          <img
            src={previewUrl}
            alt="Screenshot preview"
            className="w-full max-h-52 rounded object-contain bg-white"
          />
          <div className="mt-3 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-700 truncate">{file.name}</p>
              <p className="text-xs text-gray-400 mt-0.5">{formatBytes(file.size)}</p>
            </div>
            <button
              type="button"
              onClick={handleRemove}
              className="shrink-0 text-xs font-medium text-red-500 hover:text-red-700 transition"
            >
              Remove
            </button>
          </div>
        </div>
      ) : (
        /* Drop zone */
        <div
          role="button"
          tabIndex={0}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          onKeyDown={e => e.key === 'Enter' && inputRef.current?.click()}
          className={`cursor-pointer rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors ${
            isDragging
              ? 'border-indigo-400 bg-indigo-50'
              : 'border-gray-300 bg-white hover:border-indigo-300 hover:bg-gray-50'
          }`}
        >
          <UploadIcon />
          <p className="mt-3 text-sm font-medium text-gray-600">
            Drop screenshot here, or{' '}
            <span className="text-indigo-600">browse</span>
          </p>
          <p className="mt-1 text-xs text-gray-400">PNG, JPG, WebP — up to 10 MB</p>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={e => handleFile(e.target.files[0])}
        className="hidden"
      />

      <p className="mt-2 text-xs text-gray-400">
        💡 In Chrome DevTools, press{' '}
        <kbd className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[11px] text-gray-600">
          Cmd+Shift+P
        </kbd>{' '}
        and choose <span className="font-medium text-gray-500">"Capture full size screenshot"</span>
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ComputedStylesInput
// ---------------------------------------------------------------------------

// Minified bookmarklet — extracted from the page on first render.
// Stored as a module-level constant so React never re-creates it.
const BOOKMARKLET = `javascript:(function(){const extract=(el,depth)=>{if(depth>4)return null;const cs=getComputedStyle(el);const props=['display','flexDirection','gap','padding','paddingTop','paddingRight','paddingBottom','paddingLeft','margin','marginTop','marginRight','marginBottom','marginLeft','width','height','backgroundColor','color','fontSize','fontFamily','fontWeight','lineHeight','letterSpacing','borderRadius','border','boxShadow','position','alignItems','justifyContent'];const styles={};props.forEach(p=>{styles[p]=cs[p];});const rect=el.getBoundingClientRect();const node={tag:el.tagName.toLowerCase(),id:el.id||null,classes:el.className||null,styles,rect:{x:Math.round(rect.x),y:Math.round(rect.y),w:Math.round(rect.width),h:Math.round(rect.height)},children:[]};for(const child of el.children){const c=extract(child,depth+1);if(c)node.children.push(c);}return node;};const data={url:location.href,viewport:{w:innerWidth,h:innerHeight},tree:extract(document.body,0)};const json=JSON.stringify(data);navigator.clipboard.writeText(json).then(()=>alert('Computed styles copied to clipboard. Paste into the fidelity checker.'),()=>{const ta=document.createElement('textarea');ta.value=json;document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);alert('Copied! Paste into the fidelity checker.');});})();`

const STEPS = [
  <>Drag this link to your bookmarks bar: <a href={BOOKMARKLET} className="inline-block rounded bg-indigo-600 px-2 py-0.5 text-[11px] font-semibold text-white no-underline hover:bg-indigo-700 transition-colors cursor-grab active:cursor-grabbing">Fidelity Extractor</a></>,
  'Open your built UI in the browser (works behind login too)',
  'Click the "Fidelity Extractor" bookmark — it runs instantly',
  'Paste the result into the box below',
]

function ComputedStylesInput({ value, onChange }) {
  const [expanded, setExpanded] = useState(false)
  const [jsonError, setJsonError] = useState('')

  const handleBlur = () => {
    if (!value.trim()) { setJsonError(''); return }
    try {
      JSON.parse(value)
      setJsonError('')
    } catch {
      setJsonError("This doesn't look like valid extractor output. Try running the bookmarklet again.")
    }
  }

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="flex items-center gap-1.5 text-sm text-indigo-600 hover:text-indigo-800 transition-colors"
      >
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
        </svg>
        Add computed styles for more precise spacing analysis
        <span className="text-gray-400 font-normal">(optional)</span>
      </button>
    )
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-gray-700">
          Page styles{' '}
          <span className="text-xs font-normal text-gray-400">(optional — improves spacing &amp; typography accuracy)</span>
        </p>
        <button
          type="button"
          onClick={() => { setExpanded(false); onChange('') }}
          className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
        >
          Remove
        </button>
      </div>

      {/* Step-by-step instruction panel */}
      <ol className="rounded-lg border border-indigo-100 bg-indigo-50/60 px-4 py-3 space-y-1.5 list-none">
        {STEPS.map((step, i) => (
          <li key={i} className="flex items-start gap-2 text-xs text-gray-600">
            <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-[10px] font-bold text-indigo-700 mt-0.5">
              {i + 1}
            </span>
            <span className="leading-relaxed">{step}</span>
          </li>
        ))}
      </ol>

      {/* Paste area */}
      <textarea
        value={value}
        onChange={e => { onChange(e.target.value); setJsonError('') }}
        onBlur={handleBlur}
        placeholder={'{ "url": "...", "viewport": {...}, "tree": {...} }'}
        spellCheck={false}
        className={`w-full rounded-lg border px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition resize-none ${
          jsonError ? 'border-red-400 bg-red-50' : 'border-gray-300 bg-white hover:border-gray-400'
        }`}
        style={{ fontFamily: 'ui-monospace, monospace', height: '120px' }}
      />

      {jsonError && (
        <p className="text-xs text-red-600">{jsonError}</p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// RunButton
// ---------------------------------------------------------------------------
function RunButton({ disabled, loading }) {
  return (
    <button
      type="submit"
      disabled={disabled || loading}
      className="w-full rounded-lg bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {loading ? (
        <span className="flex items-center justify-center gap-2">
          <svg
            className="h-4 w-4 animate-spin text-white"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          Analyzing…
        </span>
      ) : (
        'Run Analysis'
      )}
    </button>
  )
}

// ---------------------------------------------------------------------------
// HomePage
// ---------------------------------------------------------------------------
export default function HomePage() {
  const navigate     = useNavigate()
  const location = useLocation()
  const { setReport, setAnalysisInputs } = useReport()

  const [figmaUrl, setFigmaUrl] = useState('')
  const [figmaToken, setFigmaToken] = useState('')
  const [screenshot, setScreenshot] = useState(null)
  const [computedStyles, setComputedStyles] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(location.state?.error || '')

  const canSubmit = figmaUrl.trim() !== '' && figmaToken.trim() !== '' && screenshot !== null

  // Clear error from location.state after displaying it once
  useEffect(() => {
    if (location.state?.error) {
      window.history.replaceState({}, document.title)
    }
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const form = new FormData()
      form.append('figmaUrl', figmaUrl.trim())
      form.append('figmaToken', figmaToken.trim())
      form.append('screenshot', screenshot)
      form.append('confidenceThreshold', getConfidenceThreshold())
      // Only send when the user actually pasted something valid
      if (computedStyles.trim()) form.append('computedStyles', computedStyles.trim())

      const { data } = await apiClient.post('/api/analyze', form)
      setReport(data)
      setAnalysisInputs(figmaUrl.trim(), figmaToken.trim())
      navigate('/report')
    } catch (err) {
      const msg =
        err.response?.data?.error ?? 'Something went wrong. Please try again.'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
    <AnalysisLoader visible={loading} />
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4 py-16 relative">

      <div className="w-full max-w-[680px]">

        {/* Header */}
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">
            Design Fidelity Checker
          </h1>
          <p className="mt-2 text-sm text-gray-500">
            Compare your Figma design against what shipped and get an instant fidelity report.
          </p>
        </div>

        {/* Card */}
        <form
          onSubmit={handleSubmit}
          className="rounded-xl border border-gray-200 bg-white px-8 py-8 shadow-sm space-y-6"
        >
          <FigmaUrlInput
            figmaUrl={figmaUrl}
            figmaToken={figmaToken}
            onUrlChange={setFigmaUrl}
            onTokenChange={setFigmaToken}
          />

          <NamingGuide />

          <AnalysisSettings />

          <hr className="border-gray-100" />

          <ScreenshotUpload file={screenshot} onFileChange={setScreenshot} />

          <hr className="border-gray-100" />

          <ComputedStylesInput value={computedStyles} onChange={setComputedStyles} />

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          <RunButton disabled={!canSubmit} loading={loading} />
        </form>

        <p className="mt-6 text-center text-xs text-gray-400">
          Your token is sent directly to Figma and never stored on our servers.
        </p>
      </div>
    </div>
    </>
  )
}
