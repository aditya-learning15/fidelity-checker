const HISTORY_KEY = 'fidelity-history'
const MAX_ENTRIES = 10

export function saveToHistory(report) {
  if (!report || !report.sessionId) return

  const entry = {
    id: report.sessionId,
    timestamp: new Date().toISOString(),
    figmaFrameName: report.figmaFrameName ?? 'Untitled Frame',
    overallScore: report.overallScore,
    totalIssues: countTotalIssues(report),
    categories: {
      layout:     report.categories?.layout?.score     ?? 0,
      color:      report.categories?.color?.score      ?? 0,
      typography: report.categories?.typography?.score ?? 0,
      spacing:    report.categories?.spacing?.score    ?? 0
    },
    matchingSummary: report.matchingSummary ?? null,
    feedbackApplied: report.feedbackApplied ?? null
  }

  const existing = loadHistory()

  // Don't duplicate the same session
  const deduped = existing.filter(e => e.id !== entry.id)
  const updated = [entry, ...deduped].slice(0, MAX_ENTRIES)

  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated))
  } catch (e) {
    // localStorage may be full — remove oldest and retry
    const trimmed = [entry, ...deduped].slice(0, MAX_ENTRIES - 2)
    localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed))
  }
}

export function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function clearHistory() {
  localStorage.removeItem(HISTORY_KEY)
}

export function getHistoryCount() {
  return loadHistory().length
}

export function relativeTime(isoString) {
  const diff = Date.now() - new Date(isoString).getTime()
  const minutes = Math.floor(diff / 60000)
  const hours   = Math.floor(diff / 3600000)
  const days    = Math.floor(diff / 86400000)
  if (minutes < 1)  return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24)   return `${hours}h ago`
  if (days < 7)     return `${days}d ago`
  return new Date(isoString).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric'
  })
}

function countTotalIssues(report) {
  if (!report.categories) return 0
  return Object.values(report.categories)
    .reduce((sum, cat) => sum + (cat.issues?.length ?? 0), 0)
}
