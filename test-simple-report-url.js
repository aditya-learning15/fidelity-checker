// Test with a simpler, more typical report

const simpleReport = {
  sessionId: 'abc123',
  overallScore: 85,
  figmaFrameName: 'Button',
  summary: 'Minor adjustments needed.',
  pixelMismatch: { percent: 5.2, pixels: 1000, total: 19200 },
  categories: {
    layout: { score: 90, issues: [] },
    spacing: { score: 85, issues: [
      { severity: 'minor', confidence: 'high', category: 'spacing', description: 'Gap is 2px off', location: 'content', referencedElement: 'Button', suggestion: 'Adjust padding', boundingBox: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 } }
    ]},
    color: { score: 88, issues: [] },
    typography: { score: 95, issues: [] }
  },
  images: { figmaBase64: null, screenshotBase64: null, diffBase64: null },
  extractionGaps: { hasVirtualScroll: false, virtualScrollSelector: null, likelyCandidates: [], message: null },
  feedbackApplied: { suppressed: 0, downgraded: 0, totalFeedbackEntries: 0 }
};

const encoded = btoa(encodeURIComponent(JSON.stringify(simpleReport)));
const url = `http://localhost:5174/report?data=${encoded}`;

console.log('Typical Simple Report URL Length');
console.log('='.repeat(60));
console.log(`Total URL Length: ${url.length} characters`);
console.log(`Status: ${url.length < 2083 ? '✓ SAFE' : '⚠ EXCEEDS LIMIT'}`);
console.log(`\n${url.length < 2083 ? 'Can be safely shared in most applications.' : 'Consider splitting into multiple links or using URL shortener service.'}`);
