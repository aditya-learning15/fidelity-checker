import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import sharp from 'sharp'
import FormData from 'form-data'
import http from 'http'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

async function createTestScreenshot() {
  // Create a 1280x1024 screenshot with some variations to ensure there are diffs
  const width = 1280
  const height = 1024

  // Create a light gray background
  const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${width}" height="${height}" fill="#fafafa"/>
      <!-- Navigation bar -->
      <rect x="0" y="0" width="${width}" height="60" fill="#f5f5f5"/>
      <!-- Header text -->
      <text x="20" y="40" font-family="Arial" font-size="18" font-weight="500" fill="#222222">Jobs</text>
      <!-- Button with slightly different styling -->
      <rect x="200" y="15" width="100" height="30" rx="4" fill="#3b82f6"/>
      <text x="220" y="35" font-family="Arial" font-size="14" fill="white">Create</text>
      <!-- Card item -->
      <rect x="20" y="80" width="300" height="150" fill="white" stroke="#e5e7eb" stroke-width="1"/>
      <text x="30" y="110" font-family="Arial" font-size="14" font-weight="600" fill="#222222">Senior Engineer</text>
      <text x="30" y="135" font-family="Arial" font-size="12" fill="#666666">San Francisco, CA</text>
      <text x="30" y="160" font-family="Arial" font-size="11" fill="#999999">Posted 2 days ago</text>
    </svg>
  `

  const buffer = await sharp(Buffer.from(svg))
    .png()
    .toBuffer()

  return buffer
}

async function runTest() {
  try {
    console.log('=== END-TO-END TEST ===\n')

    // Load test data
    const figmaSample = JSON.parse(fs.readFileSync(path.join(__dirname, 'figma-sample.json'), 'utf-8'))
    const domSample = JSON.parse(fs.readFileSync(path.join(__dirname, 'dom-sample.json'), 'utf-8'))
    const screenshotBuffer = await createTestScreenshot()

    console.log('✓ Loaded test data:')
    console.log(`  - Figma JSON: ${JSON.stringify(figmaSample).length} bytes`)
    console.log(`  - DOM JSON: ${JSON.stringify(domSample).length} bytes`)
    console.log(`  - Screenshot: ${screenshotBuffer.length} bytes\n`)

    // Create form data for multipart request
    const form = new FormData()
    form.append('figmaUrl', 'https://www.figma.com/file/test/design?node-id=1-1')
    form.append('figmaToken', 'test-token-12345')
    form.append('computedStyles', JSON.stringify(domSample))
    form.append('screenshot', screenshotBuffer, {
      filename: 'test-screenshot.png',
      contentType: 'image/png',
    })

    console.log('Sending POST /api/analyze...\n')

    // Send request to localhost:3001
    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'localhost',
        port: 3001,
        path: '/api/analyze',
        method: 'POST',
        headers: form.getHeaders(),
      }

      const req = http.request(options, (res) => {
        let data = ''

        res.on('data', (chunk) => {
          data += chunk
        })

        res.on('end', () => {
          try {
            const report = JSON.parse(data)
            console.log('=== RESPONSE ===\n')
            printResults(report)
            resolve(report)
          } catch (err) {
            console.error('Failed to parse response:', err.message)
            console.log('Raw response:', data.slice(0, 500))
            reject(err)
          }
        })
      })

      req.on('error', reject)

      form.pipe(req)
    })
  } catch (err) {
    console.error('Test error:', err.message)
    process.exit(1)
  }
}

function printResults(report) {
  // a. Matching summary
  console.log('a. MATCHING SUMMARY')
  if (report.matchingSummary) {
    console.log('  ', JSON.stringify(report.matchingSummary, null, 2))
  } else {
    console.log('  (not found in response)')
  }
  console.log()

  // b. First 3 arithmetic issues
  console.log('b. FIRST 3 ARITHMETIC ISSUES')
  let arithmeticCount = 0
  for (const [catName, catData] of Object.entries(report.categories || {})) {
    if (arithmeticCount >= 3) break
    for (const issue of (catData.issues || [])) {
      if (arithmeticCount >= 3) break
      if (issue.source === 'arithmetic') {
        arithmeticCount++
        console.log(`\n  Issue ${arithmeticCount}:`)
        console.log(`    source: "${issue.source}"`)
        console.log(`    property: "${issue.property}"`)
        console.log(`    category: "${issue.category}"`)
        console.log(`    severity: "${issue.severity}"`)
        console.log(`    figmaValue: "${issue.figmaValue}"`)
        console.log(`    domValue: "${issue.domValue}"`)
        console.log(`    delta: ${issue.delta ? `"${issue.delta}"` : 'null'}`)
        console.log(`    referencedElement: "${issue.referencedElement}"`)
        console.log(`    boundingBox:`, issue.boundingBox)
      }
    }
  }
  if (arithmeticCount === 0) {
    console.log('  (no arithmetic issues found)')
  }
  console.log()

  // c. Overall score
  console.log('c. OVERALL SCORE')
  console.log(`  ${report.overallScore}`)
  console.log()

  // d. Feedback applied
  console.log('d. FEEDBACK APPLIED')
  if (report.feedbackApplied) {
    console.log('  ', JSON.stringify(report.feedbackApplied, null, 2))
  } else {
    console.log('  (not found)')
  }
  console.log()

  // e. Diff regions
  console.log('e. DIFF REGIONS')
  console.log('  (check console output above for [extractDiffRegions] messages)')
  console.log()

  // Summary stats
  const allIssues = Object.values(report.categories || {})
    .flatMap(cat => cat.issues || [])
  const arithmeticIssues = allIssues.filter(i => i.source === 'arithmetic')
  const visionIssues = allIssues.filter(i => i.source === 'vision')

  console.log('SUMMARY')
  console.log(`  Total issues: ${allIssues.length}`)
  console.log(`  Arithmetic: ${arithmeticIssues.length}`)
  console.log(`  Vision: ${visionIssues.length}`)
}

runTest().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
