# Fidelity Checker

A design-to-dev fidelity auditor. Paste a Figma frame URL
and a screenshot of your built UI — get a precision report
showing exactly what differs, with scores, annotations,
and fix suggestions.

## Prerequisites

- Node.js 20+
- Figma account + Personal Access Token
- Google AI Studio account (free Gemini API key)

## Local setup

1. Clone the repo
2. `cd server && cp .env.example .env`
3. Fill in `GEMINI_API_KEY` in `server/.env`
4. `cd server && npm install`
5. `cd ../client && npm install`
6. `cd ../server && node src/index.js`
7. Open a new terminal: `cd client && npm run dev`
8. Open http://localhost:5173

## Get a Figma Personal Access Token

1. Open Figma desktop or web
2. Click your profile picture → Settings
3. Scroll to Personal Access Tokens
4. Click "Generate new token"
5. Name it "Fidelity Checker", copy immediately
6. Paste into the token field in the app

## Get a free Gemini API key

1. Go to aistudio.google.com
2. Sign in with a Google account
3. Click "Get API key" → "Create API key in new project"
4. Copy the key
5. Paste as `GEMINI_API_KEY` in `server/.env`

## Figma layer naming

For best results, name your key Figma layers:
- Navigation Bar, Side Rail, Title Bar
- Primary Button, Search Bar, Filter Panel
- Job Card (or [Type] Card), Job Title, Job ID

Unnamed layers (Frame 1, Rectangle 23) fall back to
visual comparison instead of exact property diffing.

## How it works

1. **Input**: Figma URL + screenshot of your built UI
2. **Analysis**: 
   - Token extraction from Figma JSON
   - Pixel-by-pixel diff analysis
   - AI semantic comparison (Gemini 2.5 Flash)
   - Element matching (optional, with bookmarklet)
3. **Output**: 
   - Overall fidelity score (0-100)
   - Issues by category (layout, color, typography, spacing)
   - Precision annotations on the image
   - Override system (flag false positives, accept deviations)
4. **Share & Export**:
   - Share link (encoded report)
   - PDF export with score and issue summary

## Deployment

### Backend (Fly.io)

```bash
fly auth login
cd server
fly launch --no-deploy --name fidelity-checker-api
fly secrets set GEMINI_API_KEY=your_key_here
fly deploy
```

### Frontend (Vercel)

1. Connect your GitHub repo to vercel.com
2. Set root directory to: `client`
3. Framework preset: Vite
4. Deploy

The frontend will be served from Vercel and proxy API
calls to your Fly.io backend via `vercel.json` rewrites.

## API Reference

### POST /api/analyze

Main analysis endpoint. Uploads Figma URL, screenshot, 
and optional computed styles (from bookmarklet).

**Request:**
- `figmaUrl` (string): URL of a Figma frame
- `figmaToken` (string): Personal Access Token
- `screenshot` (file): PNG/JPG of built UI
- `computedStyles` (JSON, optional): DOM extraction from bookmarklet

**Response:**
```json
{
  "sessionId": "...",
  "overallScore": 78,
  "pixelMismatch": { "percent": 8.3, "pixels": 2400, "total": 28800 },
  "categories": {
    "layout": { "score": 92, "issues": [...] },
    "color": { "score": 88, "issues": [...] },
    "typography": { "score": 95, "issues": [...] },
    "spacing": { "score": 75, "issues": [...] }
  },
  "summary": "...",
  "images": { "figmaBase64": "...", "screenshotBase64": "...", "diffBase64": "..." },
  "extractionGaps": { "hasVirtualScroll": false, ... },
  "feedbackApplied": { "suppressed": 0, "downgraded": 0, ... }
}
```

### POST /api/analyze/enrich

Re-analyze with element picker matches (when user provides
computed styles from the bookmarklet).

**Request:**
- `figmaUrl` (string)
- `figmaToken` (string)
- `elementPickerJson` (JSON): Output from bookmarklet
- `existingReport` (object): Original report to enrich

**Response:**
```json
{
  "newMatches": 35,
  "newIssues": [...],
  "replacedIssues": 8,
  "updatedScore": 82,
  "updatedMatchingSummary": {
    "totalFigmaElements": 100,
    "matchedWithDom": 35,
    "precisionIssues": 12
  }
}
```

### POST /api/analyze/feedback

Store user feedback for learning loop. Fire-and-forget endpoint.

**Request:**
```json
{
  "sessionId": "...",
  "issueIndex": 5,
  "feedbackType": "incorrect",
  "issue": { ... },
  "context": { ... }
}
```

## Architecture

### Backend (Node.js + Express)
- `/services/figmaService.js` — Figma API integration
- `/services/diffService.js` — Pixel diff + property comparison
- `/services/aiService.js` — Gemini 2.5 Flash integration
- `/services/analysisService.js` — Main orchestrator
- `/services/matchService.js` — Element matching (optional)
- `/services/feedbackService.js` — Learning loop + pattern suppression

### Frontend (React + Vite)
- HomePage — Input form (URL, token, screenshot, optional styles)
- ReportPage — Two-panel layout (image viewer + issues list)
- LeftPanel — Figma vs screenshot comparison with annotations
- RightPanel — Issues list, filters, overrides, exports
- ReportContext — Global state (report, overrides, effective score)

### Storage
- `src/data/feedback.json` — Accumulated user feedback (auto-created)
- Environment variables — API keys, Fly.io metadata
- localStorage (client) — Dismissal state for naming tips

## Features

✓ Pixel-perfect visual diffing
✓ Named element property comparison
✓ AI semantic analysis (layout, color, typography, spacing)
✓ Virtual scroll heuristics
✓ Issue annotation on images
✓ Manual overrides (flag false positives)
✓ Learning loop (feedback → suppression patterns)
✓ Share link (encoded report, images stripped)
✓ PDF export (score + issue summary)
✓ Responsive UI (desktop + mobile)

## Limitations

- Reports with 20+ complex issues may exceed URL length limits (use PDF export or share via email)
- PDF rendering uses html2canvas (complex layouts may not be pixel-perfect)
- Virtual scroll detection is heuristic-based (helps identify patterns)
- Requires real Figma + Gemini API keys (no local fallback)

## License

MIT
