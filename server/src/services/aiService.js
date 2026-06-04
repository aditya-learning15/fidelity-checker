import { GoogleGenerativeAI } from '@google/generative-ai'

// ---------------------------------------------------------------------------
// Client (lazy singleton — initialised on first call so env vars are loaded)
// ---------------------------------------------------------------------------
let _client = null

function getModel() {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY environment variable is not set')
  }
  if (!_client) {
    _client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  }
  // gemini-1.5-flash: confirmed free tier access in this project (1500 req/day)
  // gemini-2.0-flash has limit:0 in this project (project-level block, not exhaustion)
  // gemini-2.5-flash has only 20/day and was timing out at 30s
  return _client.getGenerativeModel({
    model: 'gemini-1.5-flash',
    generationConfig: {
      temperature: 0,
      topP: 1,
      topK: 1,
      responseMimeType: 'application/json',
    },
  })
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

function buildPrompt(namedElements, tokenDiff = null, matchedElements = null) {
  let prompt = `You are a senior UI/UX design quality analyst. You are comparing a Figma design \
(Image 1) against its built implementation (Image 2).

Your job is to identify every visual discrepancy between the design and the \
implementation, however small. Be precise and technical, not vague.

CRITICAL: Only report issues you are HIGHLY confident about. When uncertain, do not flag.

Named elements extracted from the Figma design file for reference (use these to \
ground your issue descriptions in exact design intent):
${JSON.stringify(namedElements, null, 2)}`

  // If matched elements are provided, add an exclusion list
  if (matchedElements && matchedElements.length > 0) {
    prompt += `\n\nPreviously matched elements (do NOT evaluate these for issues):
The following Figma elements have already been matched to their implementation via \
arithmetic token analysis. Do NOT generate issues for these elements under any \
circumstances, as they have been verified to match correctly:
${JSON.stringify(matchedElements, null, 2)}

If you detect a visual discrepancy in one of these matched elements, it is likely a \
false positive from visual analysis. Trust the arithmetic matching instead.`
  }

  prompt += `

Evaluate these four categories and return a JSON object ONLY — no preamble, \
no explanation, just the JSON:

{
  "overallSummary": "2-3 sentence summary of the fidelity gap",
  "categories": {
    "layout": {
      "score": <0-100, where 100 = perfect match>,
      "issues": [
        {
          "severity": "critical" | "major" | "minor",
          "confidence": "high" | "low",
          "description": "Specific description of what differs",
          "location": "Where on screen (e.g. 'top navigation bar', 'hero section button')",
          "referencedElement": "Name of the Figma element this issue relates to, if identifiable — omit if uncertain",
          "suggestion": "Exact CSS or design fix",
          "boundingBox": {
            "x": <0-1, left edge as fraction of image width>,
            "y": <0-1, top edge as fraction of image height>,
            "width": <0-1, width as fraction of image width>,
            "height": <0-1, height as fraction of image height>
          }
        }
      ]
    },
    "color": { "score": ..., "issues": [...] },
    "typography": { "score": ..., "issues": [...] },
    "spacing": { "score": ..., "issues": [...] }
  }
}

===== CRITICAL RESTRICTION =====
You MUST NOT estimate any measurement, dimension, spacing, padding, or border-radius value.
You cannot measure pixels from an image reliably.
If an issue would require you to estimate a number, DO NOT report it.
Only report differences that are CATEGORICAL and unmistakable to the human eye.

FORBIDDEN WORDS/PATTERNS in your descriptions:
- "px" or any unit (pixels, points, etc.)
- "approximately", "appears to be", "slightly", "around", "about"
- "less than", "more than", "taller", "shorter", "wider", "narrower"
- "estimated", "visually", "looks like it"
- Any measurements or spacing estimates
- Any padding or margin estimates
- Any border-radius observations
- Any shade or subtle color difference

===== PART 3 FIX: TWO-STEP VISION PROCESS =====

For each design element, follow this two-step process:

STEP 1: DETERMINE PRESENCE
Ask ONLY: "Is this element visibly present in the built screenshot?"
- Answer yes or no only. Do not yet comment on any properties.
- If the answer is NO → only report "element appears missing"
- If the answer is YES → proceed to step 2

STEP 2: IF PRESENT, REPORT DIFFERENCES (only if Step 1 = YES)
You may ONLY report these categorical differences:

1. **Text content is different** (when element IS present)
   - The actual words/text displayed are different
   - Example: "Button says 'Delete' but design says 'Cancel'"
   - Not styling, only content

2. **Major structural difference** (when element IS present)
   - Element is in a completely different location (top vs bottom, left vs right)
   - Not "slightly off" — completely different quadrant of the screen
   - Element type is completely wrong (icon vs text, button vs link)

FORBIDDEN IN STEP 2:
- ANY color observations (colors are compared via computed hex values, not vision)
- ANY measurements or spacing estimates
- Reporting properties of elements you judged "absent" in Step 1

Severity guide (for allowed issues only):
- critical: A major element is absent, or text content is completely wrong
- major: Completely wrong color family, major positional difference
- minor: (rarely used — only for clear structural issues)

Confidence guide:
- high: You can unmistakably see this categorical difference in both images
- low: Do not report low-confidence issues for this analysis

For each issue, estimate the bounding box of the affected region as normalised \
coordinates (0–1 range, relative to the full image dimensions). x=0, y=0 is top-left. \
If you cannot confidently locate the region, omit the boundingBox field entirely — \
do not guess randomly.

Be specific. Do NOT say "colors may differ" — say "primary button background appears \
to be #2563EB but the design specifies #3B82F6". If something matches perfectly, do \
not mention it. Only report issues you are HIGHLY confident about.`

  // When computed styles were provided, append exact token diff as grounding data
  if (tokenDiff && tokenDiff.mismatches.length > 0) {
    prompt += `\n\nExact token comparison (Figma design vs computed browser styles):\n${
      JSON.stringify(tokenDiff.mismatches, null, 2)
    }\nUse these exact values for spacing and typography issues instead of visual estimates.`
  }

  return prompt
}

// ---------------------------------------------------------------------------
// Error classifier
// ---------------------------------------------------------------------------

function classifyError(err) {
  const msg = err.message ?? ''
  const lower = msg.toLowerCase()

  // On 429: quota exceeded — do NOT retry, do NOT fall through to alternatives
  if (
    msg.includes('429') ||
    lower.includes('quota exceeded') ||
    lower.includes('exceeds') ||
    lower.includes('resource exhausted')
  ) {
    return new Error('Gemini quota reached. Please wait a few minutes and try again.')
  }

  // On other rate limits (too-many-requests, etc.)
  if (lower.includes('rate limit') || lower.includes('too many requests')) {
    return new Error('Gemini rate limit reached. Please wait and try again.')
  }

  // On 503 or server errors: these are usually transient
  if (msg.includes('503') || lower.includes('service unavailable')) {
    return new Error('AI service temporarily unavailable. Please try again in a moment.')
  }

  return new Error(`AI comparison failed: ${msg}`)
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Send both images to Gemini 2.5 Flash and return a structured comparison report.
 *
 * @param {Buffer}   figmaBuffer       - PNG buffer of the Figma frame export
 * @param {Buffer}   screenshotBuffer  - PNG buffer of the developer screenshot
 * @param {object[]} namedElements     - Output of extractNamedElements() — grounding data for Gemini
 * @param {object|null} tokenDiff      - Output of diffTokenSets() — optional exact token diff
 * @returns {Promise<{
 *   overallSummary: string,
 *   categories: {
 *     layout:     { score: number, issues: object[] },
 *     color:      { score: number, issues: object[] },
 *     typography: { score: number, issues: object[] },
 *     spacing:    { score: number, issues: object[] },
 *   }
 * }>}
 */
export async function runAIComparison(figmaBuffer, screenshotBuffer, namedElements, tokenDiff = null, matchedElements = null) {
  let model
  try {
    model = getModel()
  } catch (err) {
    throw new Error(`AI comparison failed: ${err.message}`)
  }

  // Build multimodal request — text prompt + both images as inline base64 PNG
  const parts = [
    { text: buildPrompt(namedElements, tokenDiff, matchedElements) },
    {
      inlineData: {
        mimeType: 'image/png',
        data: figmaBuffer.toString('base64'),
      },
    },
    {
      inlineData: {
        mimeType: 'image/png',
        data: screenshotBuffer.toString('base64'),
      },
    },
  ]

  let result
  const GEMINI_TIMEOUT_MS = 30000  // FIX A: Hard 30s timeout
  try {
    console.log(`[aiService] Vision call prompt size: ${JSON.stringify(parts).length} chars`)
    // FIX A: Wrap Gemini vision call in 30s timeout
    result = await Promise.race([
      model.generateContent(parts),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error('Gemini timeout after 30s')),
          GEMINI_TIMEOUT_MS
        )
      ),
    ])
  } catch (err) {
    throw classifyError(err)
  }

  // Extract the text response
  let responseText
  try {
    responseText = result.response.text()
  } catch (err) {
    throw new Error(`AI comparison failed: could not read model response — ${err.message}`)
  }

  // Parse JSON — responseMimeType: "application/json" makes this reliable,
  // but we guard against edge-case model misbehaviour
  let parsed
  try {
    parsed = JSON.parse(responseText)
  } catch {
    throw new Error('AI returned malformed response')
  }

  // Basic structural validation — ensure the shape we promised callers
  if (!parsed.categories || !parsed.overallSummary) {
    throw new Error('AI returned malformed response')
  }

  // PART 1 FIX: Post-process to reject quantitative/unreliable vision issues
  const FORBIDDEN_PATTERNS = [
    /\bpx\b/,
    /approximately|appears to be|slightly|around|about/i,
    /less than|more than|taller|shorter|wider|narrower/i,
    /estimated|visually|looks like/i,
    /padding|margin|spacing|border-radius|radius|measurement|dimension/i,
  ]

  const isQuantitativeClaim = (description) => {
    if (!description || typeof description !== 'string') return false
    return FORBIDDEN_PATTERNS.some(pattern => pattern.test(description))
  }

  // Check for shade comparison (hex codes paired with different hex codes in wrong hue family)
  const isShadeComparison = (description) => {
    if (!description) return false
    // Match patterns like "#E7EEF6 vs #4E4E4E" or "appears #xxx but should be #yyy"
    const hexMatches = description.match(/#[0-9A-Fa-f]{6}/g)
    if (!hexMatches || hexMatches.length < 2) return false

    // If two hex codes are present, check if they're in the same hue family
    // (hue difference < 60 degrees means same color family)
    const hexToHSL = (hex) => {
      const r = parseInt(hex.slice(1, 3), 16) / 255
      const g = parseInt(hex.slice(3, 5), 16) / 255
      const b = parseInt(hex.slice(5, 7), 16) / 255
      const max = Math.max(r, g, b)
      const min = Math.min(r, g, b)
      let h = 0
      if (max === r) h = ((g - b) / (max - min) + (g < b ? 6 : 0)) / 6
      else if (max === g) h = ((b - r) / (max - min) + 2) / 6
      else h = ((r - g) / (max - min) + 4) / 6
      return h * 360
    }

    // Compare hues of first two hex codes
    if (hexMatches.length >= 2) {
      const h1 = hexToHSL(hexMatches[0])
      const h2 = hexToHSL(hexMatches[1])
      const hueDiff = Math.min(Math.abs(h1 - h2), 360 - Math.abs(h1 - h2))
      if (hueDiff < 60) {
        // Same color family — this is a shade comparison, reject it
        return true
      }
    }

    return false
  }

  // Filter all categories to remove quantitative/unreliable issues
  if (parsed.categories) {
    for (const [catName, category] of Object.entries(parsed.categories)) {
      if (!category.issues) continue

      category.issues = category.issues.filter(issue => {
        // Reject if description contains forbidden patterns
        if (isQuantitativeClaim(issue.description)) {
          console.log(`[aiService] Rejected quantitative vision issue: "${issue.description}"`)
          return false
        }

        // Reject if description is a shade comparison (multiple hex codes in same family)
        if (isShadeComparison(issue.description)) {
          console.log(`[aiService] Rejected shade comparison vision issue: "${issue.description}"`)
          return false
        }

        return true
      })
    }
  }

  return parsed
}
