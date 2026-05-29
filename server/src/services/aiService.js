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
  return _client.getGenerativeModel({
    model: 'gemini-2.5-flash',
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

Severity guide:
- critical: completely wrong, breaks design intent (wrong component, missing element, completely wrong color)
- major: noticeably different, affects visual quality
  • Spacing: delta > 6px
  • Border radius: delta > 4px
  • Font size: delta > 2px
  • Subpixel noise (≤2px spacing, ≤1px radius, ≤2px font) is acceptable—skip reporting
- minor: subtle but meaningful
  • Spacing: 3–6px difference
  • Border radius: 2–4px difference
  • Other: slight color shade, 1–2px misalignment

Confidence guide:
- high: you can clearly see the discrepancy in the images and/or the named elements data confirms it
- low: you are inferring a possible issue but cannot clearly confirm it visually

For each issue, estimate the bounding box of the affected region as normalised \
coordinates (0–1 range, relative to the full image dimensions). x=0, y=0 is top-left. \
If you cannot confidently locate the region, omit the boundingBox field entirely — \
do not guess randomly.

Be specific. Do NOT say "colors may differ" — say "primary button background appears \
to be #2563EB but the design specifies #3B82F6". If something matches perfectly, do \
not mention it. Only report issues you are reasonably confident about.`

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

  if (
    msg.includes('429') ||
    lower.includes('rate limit') ||
    lower.includes('quota') ||
    lower.includes('resource exhausted')
  ) {
    return new Error('Analysis limit reached. Please try again in a minute.')
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
  try {
    result = await model.generateContent(parts)
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

  return parsed
}
