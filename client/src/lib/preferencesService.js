const PREFS_KEY = 'fidelity-preferences'

const DEFAULTS = {
  confidenceThreshold: 'balanced'
}

export function getPreferences() {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (!raw) return { ...DEFAULTS }
    return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULTS }
  }
}

export function setPreference(key, value) {
  try {
    const current = getPreferences()
    localStorage.setItem(PREFS_KEY,
      JSON.stringify({ ...current, [key]: value }))
  } catch (e) {
    console.error('Failed to save preference:', e)
  }
}

export function getConfidenceThreshold() {
  return getPreferences().confidenceThreshold
}
