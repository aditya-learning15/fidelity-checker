# Production Smoke Test Checklist

Run this checklist against the live Vercel URL after deployment.

## Pre-Test Setup
```bash
# Backend should be running at: https://fidelity-checker-api.fly.dev
# Frontend should be at: https://fidelity-checker.vercel.app (or your custom domain)

# Open browser DevTools console before starting
```

## Test Checklist

### 1. Page Load ✓
- [ ] Homepage loads without errors
- [ ] No 404 errors in console
- [ ] No CORS errors in console
- [ ] All assets load (CSS, JS bundles)
- [ ] Navigation links visible (History, Feedback if history exists)

### 2. API Connectivity ✓
- [ ] Paste valid Figma URL in form field
- [ ] No CORS errors in console
- [ ] Console shows no API connection errors
- [ ] Backend health check: `curl https://fidelity-checker-api.fly.dev/api/health`
  - Expected: `{"status":"ok"}`

### 3. Analysis Submission ✓
- [ ] Upload screenshot file
- [ ] Paste DOM JSON from bookmarklet
- [ ] Click "Run Analysis"
- [ ] Loading spinner appears
- [ ] No JavaScript errors in console
- [ ] Request completes without timeout

### 4. Report Display ✓
- [ ] Report page loads at /report
- [ ] Overall score displays correctly
- [ ] Category scores visible (Layout, Color, Typography, Spacing)
- [ ] Pixel mismatch percentage shows
- [ ] Issue count displays correctly
- [ ] At least one issue appears in list with:
  - [ ] Element name
  - [ ] Property name
  - [ ] Expected vs actual value
  - [ ] Severity badge (critical/major/minor)
- [ ] Confidence threshold displays in score strip
  - Shows: "Threshold: Balanced (high + medium)"

### 5. Share Functionality ✓
- [ ] Click "Copy link" button
- [ ] Button text changes to "Link copied"
- [ ] No console errors
- [ ] Open incognito window
- [ ] Paste URL from clipboard
- [ ] Report loads correctly in incognito
- [ ] All scores and issues visible in shared view

### 6. PDF Export ✓
- [ ] Click "Export PDF" button
- [ ] Button text changes to "Exporting..."
- [ ] PDF downloads to local machine
- [ ] PDF opens and displays:
  - [ ] Header with analysis info
  - [ ] Overall score
  - [ ] Review section with issues
  - [ ] Figma screenshot included

### 7. History Feature ✓
- [ ] After completing analysis, navigate to /history
- [ ] History page loads without errors
- [ ] Current analysis appears in list
- [ ] Entry shows:
  - [ ] Frame name
  - [ ] Score with color coding
  - [ ] Timestamp (relative time)
  - [ ] Category scores
  - [ ] Issue count
- [ ] "Clear all" button visible and functional
- [ ] Run second analysis
- [ ] New entry appears at top (newest first)
- [ ] Refresh page
- [ ] History still shows both entries (localStorage persisting)

### 8. Feedback Page ✓
- [ ] Navigate to /feedback
- [ ] Page loads without errors
- [ ] Four stat cards visible:
  - [ ] Total feedback
  - [ ] Flagged incorrect
  - [ ] Accepted deviations
  - [ ] Active suppressions
- [ ] All show 0 initially (or correct number if feedback exists)
- [ ] Three sections render:
  - [ ] Suppressed patterns (empty state if no flags)
  - [ ] Accepted deviations (empty state if no accepts)
  - [ ] Recent feedback (empty state if no feedback)
- [ ] Back button works, returns to homepage

### 9. Mobile Responsiveness ✓
- [ ] Open DevTools device emulation (iPhone 12 or similar)
- [ ] Homepage loads and is readable
- [ ] Form fields are accessible
- [ ] Mobile nudge appears when width < 1024px
- [ ] "Continue anyway" button functions
- [ ] Report page layout adapts

## Console Error Check
After completing all tests above:
```javascript
// In console, any of these indicate issues:
// - Uncaught errors
// - Network 4xx/5xx responses
// - Unhandled promise rejections
// - Failed API calls not shown to user
```

## Results Summary

| Test | Status | Notes |
|------|--------|-------|
| Page Load | ✓/✗ | |
| API Connectivity | ✓/✗ | |
| Analysis Submission | ✓/✗ | |
| Report Display | ✓/✗ | |
| Share Functionality | ✓/✗ | |
| PDF Export | ✓/✗ | |
| History Feature | ✓/✗ | |
| Feedback Page | ✓/✗ | |
| Mobile Responsiveness | ✓/✗ | |

## Pass/Fail Criteria
- **PASS**: All 9 tests check ✓, no console errors
- **FAIL**: Any test fails or console errors appear during testing
