// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CATEGORY_META = {
  layout:     { label: 'Layout' },
  color:      { label: 'Color' },
  typography: { label: 'Typography' },
  spacing:    { label: 'Spacing' },
}

// ---------------------------------------------------------------------------
// Pill button
// ---------------------------------------------------------------------------

function Pill({ label, count, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? 'border-indigo-600 bg-indigo-600 text-white'
          : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300 hover:text-gray-700'
      }`}
    >
      {label}
      {count !== undefined && (
        <span
          className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
            active ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500'
          }`}
        >
          {count}
        </span>
      )}
    </button>
  )
}

// ---------------------------------------------------------------------------
// FilterBar
// ---------------------------------------------------------------------------

/**
 * Category + severity filter pills. Placed sticky top-0 inside the right
 * panel scroll container so it doesn't scroll away with the issues.
 *
 * @param {{
 *   issues:            Array<{ category: string, severity: string }>,
 *   activeCategory:    string,
 *   activeSeverity:    string,
 *   onCategoryChange:  (val: string) => void,
 *   onSeverityChange:  (val: string) => void,
 * }} props
 */
export default function FilterBar({
  issues = [],
  activeCategory,
  activeSeverity,
  onCategoryChange,
  onSeverityChange,
}) {
  const categoryCounts = Object.fromEntries(
    Object.keys(CATEGORY_META).map(cat => [
      cat,
      issues.filter(i => i.category === cat).length,
    ])
  )

  const categoryOptions = [
    { value: 'all', label: 'All', count: issues.length },
    ...Object.entries(CATEGORY_META).map(([key, { label }]) => ({
      value: key,
      label,
      count: categoryCounts[key] ?? 0,
    })),
  ]

  const severityOptions = [
    { value: 'all',      label: 'All'      },
    { value: 'critical', label: 'Critical' },
    { value: 'major',    label: 'Major'    },
    { value: 'minor',    label: 'Minor'    },
  ]

  return (
    <div className="px-4 py-3 space-y-2 bg-white">
      <div className="flex flex-wrap gap-2">
        {categoryOptions.map(opt => (
          <Pill
            key={opt.value}
            label={opt.label}
            count={opt.count}
            active={activeCategory === opt.value}
            onClick={() => onCategoryChange(opt.value)}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {severityOptions.map(opt => (
          <Pill
            key={opt.value}
            label={opt.label}
            active={activeSeverity === opt.value}
            onClick={() => onSeverityChange(opt.value)}
          />
        ))}
      </div>
    </div>
  )
}
