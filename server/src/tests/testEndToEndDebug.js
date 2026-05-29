import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import sharp from 'sharp'
import FormData from 'form-data'
import http from 'http'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

async function createTestScreenshot() {
  const width = 1280
  const height = 1024

  const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${width}" height="${height}" fill="#fafafa"/>
      <rect x="0" y="0" width="${width}" height="60" fill="#f5f5f5"/>
      <text x="20" y="40" font-family="Arial" font-size="18" font-weight="500" fill="#222222">Jobs</text>
      <rect x="200" y="15" width="100" height="30" rx="4" fill="#3b82f6"/>
      <text x="220" y="35" font-family="Arial" font-size="14" fill="white">Create</text>
    </svg>
  `

  const buffer = await sharp(Buffer.from(svg))
    .png()
    .toBuffer()

  return buffer
}

async function runTest() {
  try {
    console.log('Loading test data...\n')

    const figmaSample = JSON.parse(fs.readFileSync(path.join(__dirname, 'figma-sample.json'), 'utf-8'))
    const domSample = JSON.parse(fs.readFileSync(path.join(__dirname, 'dom-sample.json'), 'utf-8'))
    const screenshotBuffer = await createTestScreenshot()

    console.log('✓ Files loaded')
    console.log(`  - Figma: ${JSON.stringify(figmaSample).length} bytes`)
    console.log(`  - DOM: ${JSON.stringify(domSample).length} bytes`)
    console.log(`  - Screenshot: ${screenshotBuffer.length} bytes\n`)

    const form = new FormData()
    form.append('figmaUrl', 'https://www.figma.com/file/test/design?node-id=1-1')
    form.append('figmaToken', 'test-token-12345')
    form.append('computedStyles', JSON.stringify(domSample))
    form.append('screenshot', screenshotBuffer, {
      filename: 'test-screenshot.png',
      contentType: 'image/png',
    })

    console.log('Posting to /api/analyze...')

    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'localhost',
        port: 3001,
        path: '/api/analyze',
        method: 'POST',
        headers: form.getHeaders(),
      }

      const req = http.request(options, (res) => {
        console.log(`Status: ${res.statusCode}\n`)
        
        let data = ''
        res.on('data', (chunk) => { data += chunk })

        res.on('end', () => {
          console.log('Full Response:')
          console.log(data)
          
          try {
            const report = JSON.parse(data)
            console.log('\n✓ Successfully parsed JSON')
            console.log('Keys in report:', Object.keys(report))
            resolve(report)
          } catch (err) {
            console.log('\nFailed to parse JSON:', err.message)
            reject(err)
          }
        })
      })

      req.on('error', reject)
      form.pipe(req)
    })
  } catch (err) {
    console.error('Test error:', err)
    process.exit(1)
  }
}

runTest().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
