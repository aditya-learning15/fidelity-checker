import { useState, useRef, useEffect, useCallback, useMemo } from 'react'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TABS = [
  { id: 'slider', label: 'Overlay slider' },
  { id: 'diff',   label: 'Diff view'      },
]

const SEVERITY_BADGE_CLASS = {
  critical: 'bg-red-500',
  major:    'bg-amber-500',
  minor:    'bg-gray-400',
}

const SEVERITY_BORDER_COLOR = {
  critical: '#ef4444',
  major:    '#f59e0b',
  minor:    '#9ca3af',
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/** Track the pixel dimensions of a DOM element via ResizeObserver. */
function useElementSize(ref) {
  const [size, setSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const sync = () => setSize({ width: el.clientWidth, height: el.clientHeight })
    sync()

    const ro = new ResizeObserver(sync)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])

  return size
}

// ---------------------------------------------------------------------------
// AnnotationLayer
// ---------------------------------------------------------------------------

/**
 * Overlays numbered bounding-box rectangles on an image panel.
 *
 * Accounts for object-fit: contain letterboxing: annotations are positioned
 * relative to the actual rendered image area, not the full container.
 */
function AnnotationLayer({ containerRef, naturalSize, issues, activeIssueIndex, onBadgeClick, clipPath }) {
  const { width: cw, height: ch } = useElementSize(containerRef)
  const annotated = issues.filter(i => i.boundingBox)

  // Compute the actual rendered image rect (object-fit: contain, centered)
  const imageRect = useMemo(() => {
    const { width: nw, height: nh } = naturalSize
    if (!cw || !ch || !nw || !nh) return { left: 0, top: 0, width: cw, height: ch }

    const containerAspect = cw / ch
    const imageAspect     = nw / nh

    if (imageAspect > containerAspect) {
      // Image is wider → constrained by width; letterboxed top/bottom
      const imgW = cw
      const imgH = cw / imageAspect
      return { left: 0, top: (ch - imgH) / 2, width: imgW, height: imgH }
    } else {
      // Image is taller → constrained by height; letterboxed left/right
      const imgH = ch
      const imgW = ch * imageAspect
      return { left: (cw - imgW) / 2, top: 0, width: imgW, height: imgH }
    }
  }, [cw, ch, naturalSize])

  if (!cw || !annotated.length) return null

  return (
    <div
      className="absolute inset-0 pointer-events-none"
      aria-hidden="true"
      style={clipPath ? { clipPath } : undefined}
    >
      {annotated.map(issue => {
        const { x, y, width: bw, height: bh } = issue.boundingBox
        const isActive      = issue.globalIndex === activeIssueIndex
        const borderColor   = SEVERITY_BORDER_COLOR[issue.severity] ?? '#9ca3af'

        const px = {
          left:   imageRect.left + x  * imageRect.width,
          top:    imageRect.top  + y  * imageRect.height,
          width:  bw * imageRect.width,
          height: bh * imageRect.height,
        }

        return (
          <div
            key={issue.globalIndex}
            className={isActive ? 'annotation-pulse' : ''}
            style={{
              position:     'absolute',
              left:         px.left,
              top:          px.top,
              width:        px.width,
              height:       px.height,
              border:       `2px solid ${borderColor}`,
              borderRadius: 3,
              boxSizing:    'border-box',
              opacity:      isActive ? 1 : 0.6,
              boxShadow:    isActive ? '0 0 0 1px rgba(255,255,255,0.3) inset' : undefined,
            }}
          >
            <button
              className={`pointer-events-auto absolute -top-3 -left-3 flex h-5 w-5 items-center
                justify-center rounded-full text-[10px] font-bold text-white shadow-md
                ${SEVERITY_BADGE_CLASS[issue.severity] ?? 'bg-gray-400'}`}
              onMouseDown={e => e.stopPropagation()}
              onClick={() => onBadgeClick(issue.globalIndex)}
              title={issue.location ?? ''}
            >
              {issue.globalIndex + 1}
            </button>
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ImageLabel
// ---------------------------------------------------------------------------

function ImageLabel({ text, side = 'left' }) {
  return (
    <span
      className={`pointer-events-none absolute bottom-3 ${
        side === 'left' ? 'left-3' : 'right-3'
      } rounded-full bg-black/50 px-2.5 py-1 text-xs font-medium text-white backdrop-blur-sm`}
    >
      {text}
    </span>
  )
}

// ---------------------------------------------------------------------------
// ImageComparison
// ---------------------------------------------------------------------------

/**
 * Two-mode image viewer (Overlay slider / Diff view) designed for the dark
 * LeftPanel. Fills 100% of its parent height; no card wrapper.
 *
 * @param {{
 *   figmaBase64:      string,
 *   screenshotBase64: string,
 *   diffBase64:       string,
 *   issues:           Array<{ globalIndex: number, severity: string, location?: string, boundingBox?: object }>,
 *   activeIssueIndex: number | null,
 *   onBadgeClick:     (globalIndex: number) => void,
 * }} props
 */
export default function ImageComparison({
  figmaBase64,
  screenshotBase64,
  diffBase64,
  issues = [],
  activeIssueIndex = null,
  onBadgeClick = () => {},
}) {
  const [mode, setMode]             = useState('slider')
  const [sliderPos, setSliderPos]   = useState(50)
  const [isDragging, setIsDragging] = useState(false)
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 })

  const diffPanelRef = useRef(null)
  const sliderRef    = useRef(null)

  // A hidden <img> always fires onLoad regardless of active tab,
  // giving us the figma image's natural dimensions for annotation math.
  const onFigmaLoad = (e) => {
    const { naturalWidth: w, naturalHeight: h } = e.target
    if (w && h) setNaturalSize({ width: w, height: h })
  }

  // ── Slider drag ──
  const updateSlider = useCallback((clientX) => {
    if (!sliderRef.current) return
    const rect = sliderRef.current.getBoundingClientRect()
    setSliderPos(Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100)))
  }, [])

  useEffect(() => {
    if (!isDragging) return
    const onMouseMove = (e) => updateSlider(e.clientX)
    const onTouchMove = (e) => updateSlider(e.touches[0].clientX)
    const onUp        = () => setIsDragging(false)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup',   onUp)
    window.addEventListener('touchmove', onTouchMove, { passive: true })
    window.addEventListener('touchend',  onUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup',   onUp)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend',  onUp)
    }
  }, [isDragging, updateSlider])

  const startDrag = (e) => {
    e.preventDefault()
    setIsDragging(true)
    updateSlider('touches' in e ? e.touches[0].clientX : e.clientX)
  }

  // Shared dark chrome for the bottom control strip
  const darkBar = {
    borderTop:  '1px solid rgba(255,255,255,0.1)',
    background: 'rgba(255,255,255,0.04)',
    flexShrink: 0,
  }

  return (
    <div className="h-full flex flex-col">

      {/* Hidden figma img — always mounted so naturalSize is captured on first load */}
      <img
        src={figmaBase64}
        alt=""
        aria-hidden="true"
        className="hidden"
        onLoad={onFigmaLoad}
      />

      {/* ── Image display area (fills remaining height) ── */}
      <div className="flex-1 relative overflow-hidden min-h-0">

        {/* ── Overlay slider ── */}
        {mode === 'slider' && (
          <div
            ref={sliderRef}
            className="absolute inset-0 select-none cursor-col-resize"
            onMouseDown={startDrag}
            onTouchStart={startDrag}
          >
            <img
              src={screenshotBase64}
              alt="Built version"
              className="absolute inset-0 h-full w-full object-contain"
              draggable={false}
            />
            <img
              src={figmaBase64}
              alt="Figma design"
              className="absolute inset-0 h-full w-full object-contain"
              style={{ clipPath: `inset(0 ${100 - sliderPos}% 0 0)` }}
              draggable={false}
            />

            {/* Divider handle */}
            <div
              className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow-[0_0_8px_rgba(0,0,0,0.6)]"
              style={{ left: `${sliderPos}%`, transform: 'translateX(-50%)' }}
            >
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
                flex h-9 w-9 items-center justify-center rounded-full
                border-2 border-white bg-indigo-600 shadow-lg">
                <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24"
                  stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round"
                    d="M8 9l-3 3 3 3m8-6l3 3-3 3" />
                </svg>
              </div>
            </div>

            <ImageLabel text="Figma Design"  side="left" />
            <ImageLabel text="Built Version" side="right" />

            {/* Annotation layer — clipped to the built-version (right) half */}
            <AnnotationLayer
              containerRef={sliderRef}
              naturalSize={naturalSize}
              issues={issues}
              activeIssueIndex={activeIssueIndex}
              onBadgeClick={onBadgeClick}
              clipPath={`inset(0 0 0 ${sliderPos}%)`}
            />
          </div>
        )}

        {/* ── Diff view ── */}
        {mode === 'diff' && (
          <div ref={diffPanelRef} className="absolute inset-0">
            <img
              src={diffBase64}
              alt="Pixel diff"
              className="absolute inset-0 h-full w-full object-contain"
              draggable={false}
            />
            <AnnotationLayer
              containerRef={diffPanelRef}
              naturalSize={naturalSize}
              issues={issues}
              activeIssueIndex={activeIssueIndex}
              onBadgeClick={onBadgeClick}
            />
          </div>
        )}
      </div>

      {/* ── Mode-specific secondary control ── */}
      {mode === 'slider' && (
        <div style={{ ...darkBar, padding: '6px 12px 2px' }}>
          <input
            type="range" min="0" max="100"
            value={Math.round(sliderPos)}
            onChange={e => setSliderPos(Number(e.target.value))}
            className="w-full accent-indigo-400"
            style={{ margin: 0 }}
          />
        </div>
      )}

      {mode === 'diff' && (
        <div style={{ ...darkBar, padding: '5px 12px 3px', textAlign: 'center' }}>
          <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', margin: 0 }}>
            Red pixels = mismatch · Greyscale = matching
          </p>
        </div>
      )}

      {/* ── Tab bar — bottom of panel ── */}
      <div style={{ ...darkBar, padding: '8px 12px', display: 'flex', gap: '8px' }}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setMode(tab.id)}
            style={{
              padding:      '4px 16px',
              borderRadius: '9999px',
              fontSize:     '13px',
              fontWeight:   '500',
              color:        mode === tab.id ? 'white' : 'rgba(255,255,255,0.5)',
              background:   mode === tab.id ? 'rgba(255,255,255,0.12)' : 'transparent',
              transition:   'color 0.15s, background 0.15s',
              cursor:       'pointer',
              border:       'none',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  )
}
