import { useState, useEffect } from 'react'

const STEPS = [
  'Fetching your Figma design...',
  'Exporting frame as image...',
  'Comparing layouts pixel by pixel...',
  'Running AI element matching...',
  'Calculating fidelity score...',
]

/**
 * Full-screen loading overlay shown while the analysis request is in flight.
 * Steps fade in 1.5 s apart to give the user a sense of progress.
 *
 * @param {{ visible: boolean }} props
 */
export default function AnalysisLoader({ visible }) {
  const [activeStep, setActiveStep] = useState(-1)

  useEffect(() => {
    if (!visible) {
      setActiveStep(-1)
      return
    }

    // Steps appear progressively — first 3 fast (Figma fetch ~30s each),
    // then slower to reflect AI analysis phase (can take 60-90s).
    const delays = [0, 20000, 50000, 90000, 150000]
    const timers = STEPS.map((_, i) =>
      setTimeout(() => setActiveStep(i), delays[i])
    )

    return () => timers.forEach(clearTimeout)
  }, [visible])

  if (!visible) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/60 backdrop-blur-sm">
      <div className="w-80 rounded-2xl bg-white px-8 py-8 shadow-2xl">

        {/* Spinner */}
        <div className="flex justify-center mb-5">
          <svg
            className="h-10 w-10 animate-spin text-indigo-600"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12" cy="12" r="10"
              stroke="currentColor" strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        </div>

        <p className="mb-1 text-center text-sm font-semibold text-gray-800">
          Analysing design fidelity…
        </p>
        <p className="mb-5 text-center text-xs text-gray-400">
          This may take 2–3 minutes
        </p>

        {/* Step list */}
        <ul className="space-y-3">
          {STEPS.map((step, i) => {
            const done    = i < activeStep
            const active  = i === activeStep
            const pending = i > activeStep

            return (
              <li
                key={step}
                className={`flex items-center gap-3 transition-opacity duration-500 ${
                  pending ? 'opacity-0' : 'opacity-100'
                }`}
              >
                {/* Status dot */}
                <span
                  className={`h-2 w-2 shrink-0 rounded-full transition-colors duration-300 ${
                    done   ? 'bg-green-500'  :
                    active ? 'bg-indigo-500' :
                             'bg-gray-200'
                  }`}
                />
                <span
                  className={`text-sm transition-colors duration-300 ${
                    pending ? 'text-gray-300' : 'text-gray-700'
                  }`}
                >
                  {step}
                </span>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
