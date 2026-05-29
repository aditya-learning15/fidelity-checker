// Test actual share URL length (with images stripped, as done in handleShare)

const sampleReport = {
  sessionId: 'abc123-def456',
  overallScore: 78,
  figmaFrameName: 'Product Card Component',
  summary: 'Minor spacing and color adjustments needed. Layout structure is correct.',
  pixelMismatch: { percent: 8.3, pixels: 2400, total: 28800 },
  categories: {
    layout: { score: 92, issues: [
      { severity: 'minor', confidence: 'high', category: 'layout', description: 'Card border radius appears to be 6px instead of 8px', location: 'card container', referencedElement: 'ProductCardContainer', suggestion: 'Set border-radius to 8px', boundingBox: { x: 0.1, y: 0.2, width: 0.8, height: 0.6 } }
    ]},
    spacing: { score: 75, issues: [
      { severity: 'major', confidence: 'high', category: 'spacing', description: 'Gap between title and price is 12px instead of 16px', location: 'card content', referencedElement: 'CardTitle', suggestion: 'Increase margin-bottom to 16px', boundingBox: { x: 0.15, y: 0.3, width: 0.7, height: 0.15 } },
      { severity: 'minor', confidence: 'medium', category: 'spacing', description: 'Padding on sides is 12px instead of 14px', location: 'card padding', referencedElement: 'CardContent', suggestion: 'Set padding to 14px', boundingBox: { x: 0.1, y: 0.25, width: 0.8, height: 0.5 } }
    ]},
    color: { score: 88, issues: [] },
    typography: { score: 95, issues: [] }
  },
  images: {
    figmaBase64: null,  // ← Images stripped by handleShare
    screenshotBase64: null,
    diffBase64: null
  },
  extractionGaps: { hasVirtualScroll: false, virtualScrollSelector: null, likelyCandidates: [], message: null },
  feedbackApplied: { suppressed: 0, downgraded: 0, totalFeedbackEntries: 0 }
};

const encoded = btoa(encodeURIComponent(JSON.stringify(sampleReport)));
const url = `http://localhost:5174/report?data=${encoded}`;

console.log('Share Link Length Analysis (Images Stripped)');
console.log('='.repeat(60));
console.log(`URL Length: ${url.length} characters`);
console.log(`Data Parameter Length: ${encoded.length} characters`);
console.log(`Breakdown:`);
console.log(`  - Base origin: 29 chars (http://localhost:5174/report)`);
console.log(`  - Parameter: ${encoded.length} chars`);
console.log(`  - Overhead: 6 chars (?data=)`);
console.log(`\nBrowser Limits:`);
console.log(`  - Chrome: 2,083 chars`);
console.log(`  - Firefox: 2,083 chars`);
console.log(`  - Safari: 80,000 chars`);
console.log(`  - Edge: 2,083 chars`);
console.log(`\nStatus: ${url.length < 2083 ? '✓ SAFE - Below 2KB limit for most browsers' : '✗ WARNING - May be truncated in some browsers'}`);
console.log(`\nSample URL (first 100 chars): ${url.substring(0, 100)}...`);
