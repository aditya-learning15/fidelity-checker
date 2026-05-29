// Test the share link encoding/decoding logic

// Sample report data
const report = {
  sessionId: 'test-session-123',
  overallScore: 85,
  pixelMismatch: { percent: 5.2, pixels: 1000, total: 19200 },
  summary: 'Overall layout matches well with minor spacing adjustments needed.',
  figmaFrameName: 'Login Modal',
  categories: {
    layout: {
      score: 90,
      issues: [
        {
          severity: 'minor',
          confidence: 'high',
          description: 'Button padding is 2px off',
          location: 'top right',
          referencedElement: 'Submit Button',
          suggestion: 'Adjust padding to 12px',
          boundingBox: { x: 0.7, y: 0.1, width: 0.2, height: 0.05 }
        }
      ]
    },
    spacing: {
      score: 80,
      issues: []
    }
  },
  images: {
    figmaBase64: 'data:image/png;base64,...LONG_DATA...',
    screenshotBase64: 'data:image/png;base64,...LONG_DATA...',
    diffBase64: 'data:image/png;base64,...LONG_DATA...'
  }
};

// Test encoding (as per handleShare implementation)
const reportForShare = {
  ...report,
  images: {
    figmaBase64: null,
    screenshotBase64: null,
    diffBase64: null
  }
};

const encoded = btoa(
  encodeURIComponent(JSON.stringify(reportForShare))
);

const url = 'http://localhost:5174/report?data=' + encoded;

console.log('✓ Share link encoding test:');
console.log('  URL length:', url.length);
console.log('  URL (first 150 chars):', url.substring(0, 150) + '...');

// Test decoding (as per ReportPage useEffect)
try {
  const decoded = JSON.parse(
    decodeURIComponent(atob(encoded))
  );
  
  console.log('\n✓ Share link decoding test:');
  console.log('  Decoded score:', decoded.overallScore);
  console.log('  Decoded frameName:', decoded.figmaFrameName);
  console.log('  Categories present:', Object.keys(decoded.categories).join(', '));
  console.log('  Images nulled:', decoded.images.figmaBase64 === null);
  console.log('  Issues preserved:', decoded.categories.layout.issues.length, 'layout issue(s)');
  
  if (decoded.overallScore === reportForShare.overallScore &&
      decoded.figmaFrameName === reportForShare.figmaFrameName &&
      decoded.images.figmaBase64 === null) {
    console.log('\n✓✓✓ SHARE LINK TEST PASSED\n');
  } else {
    console.log('\n✗✗✗ SHARE LINK TEST FAILED\n');
  }
} catch (e) {
  console.error('\n✗ Decoding failed:', e.message);
}
