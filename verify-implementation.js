const fs = require('fs');
const path = require('path');

console.log('Verifying Share Link and PDF Export Implementation\n');
console.log('=' .repeat(60) + '\n');

const checks = [
  {
    name: 'ReportPage imports useEffect, useLocation, useNavigate',
    file: 'client/src/pages/ReportPage.jsx',
    test: (content) => {
      return content.includes('useEffect') && 
             content.includes('useLocation') && 
             content.includes('useNavigate');
    }
  },
  {
    name: 'ReportPage has share link decoding effect',
    file: 'client/src/pages/ReportPage.jsx',
    test: (content) => {
      return content.includes('Decode shared report from URL') &&
             content.includes('const decoded = JSON.parse(decodeURIComponent(atob(data)))') &&
             content.includes('setReport(decoded)');
    }
  },
  {
    name: 'ReportPage has handleShare function',
    file: 'client/src/pages/ReportPage.jsx',
    test: (content) => {
      return content.includes('const handleShare = async') &&
             content.includes('encodeURIComponent(JSON.stringify(reportForShare))') &&
             content.includes("btoa(");
    }
  },
  {
    name: 'ReportPage has handleExport function for PDF',
    file: 'client/src/pages/ReportPage.jsx',
    test: (content) => {
      return content.includes('const handleExport = async') &&
             content.includes("import('html2pdf.js')") &&
             content.includes('html2pdf().set(opt).from(rightPanel).save()');
    }
  },
  {
    name: 'TopBar receives shareLabel, exportLabel props',
    file: 'client/src/components/report/TopBar.jsx',
    test: (content) => {
      return content.includes('shareLabel') &&
             content.includes('exportLabel') &&
             content.includes('exportDisabled') &&
             content.includes('onShare');
    }
  },
  {
    name: 'TopBar renders updated button text',
    file: 'client/src/components/report/TopBar.jsx',
    test: (content) => {
      return content.includes('{exportLabel}') &&
             content.includes('{shareLabel}');
    }
  },
  {
    name: 'RightPanel has id="right-panel"',
    file: 'client/src/components/report/RightPanel.jsx',
    test: (content) => {
      return content.includes('id="right-panel"');
    }
  },
  {
    name: 'AISummary has id="sb" on body',
    file: 'client/src/components/report/AISummary.jsx',
    test: (content) => {
      return content.includes('id="sb"');
    }
  },
  {
    name: 'HomePage reads error from location.state',
    file: 'client/src/pages/HomePage.jsx',
    test: (content) => {
      return content.includes('location.state?.error') &&
             content.includes('useLocation');
    }
  },
  {
    name: 'html2pdf.js is installed',
    file: 'client/package.json',
    test: (content) => {
      return content.includes('html2pdf.js');
    }
  }
];

let passed = 0;
let failed = 0;

checks.forEach(check => {
  const filePath = path.join(__dirname, check.file);
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const result = check.test(content);
    
    if (result) {
      console.log(`✓ ${check.name}`);
      passed++;
    } else {
      console.log(`✗ ${check.name}`);
      failed++;
    }
  } catch (e) {
    console.log(`✗ ${check.name} (file not readable)`);
    failed++;
  }
});

console.log('\n' + '='.repeat(60));
console.log(`\nResults: ${passed} passed, ${failed} failed\n`);

if (failed === 0) {
  console.log('✓✓✓ ALL IMPLEMENTATION CHECKS PASSED\n');
} else {
  console.log(`✗✗✗ ${failed} CHECK(S) FAILED\n`);
  process.exit(1);
}
