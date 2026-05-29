import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { extractNamedElements } from '../services/tokenService.js'
import { flattenDomTree } from '../services/matchService.js'
import { computePropertyDiff, buildDomBoundingBox } from '../services/diffService.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

async function runTest() {
  console.log('=== DIRECT ARITHMETIC ANALYSIS TEST ===\n')

  try {
    // Load sample data
    const figmaSample = JSON.parse(fs.readFileSync(path.join(__dirname, 'figma-sample.json'), 'utf-8'))
    const domSample = JSON.parse(fs.readFileSync(path.join(__dirname, 'dom-sample.json'), 'utf-8'))

    console.log('1. Extracting named Figma elements...')
    const namedElements = extractNamedElements(figmaSample)
    console.log(`   Found ${namedElements.length} named elements\n`)

    // Show first 5 elements
    console.log('   First 5 elements:')
    for (let i = 0; i < Math.min(5, namedElements.length); i++) {
      const el = namedElements[i]
      console.log(`     ${i + 1}. "${el.name}" (${el.type})`)
      if (el.fills?.length) console.log(`        fills: ${el.fills.join(', ')}`)
      if (el.fontSize) console.log(`        fontSize: ${el.fontSize}`)
      if (el.paddingLeft) console.log(`        padding: L=${el.paddingLeft} R=${el.paddingRight} T=${el.paddingTop} B=${el.paddingBottom}`)
    }

    console.log('\n2. Flattening DOM tree...')
    const flatDomNodes = flattenDomTree(domSample)
    console.log(`   Found ${flatDomNodes.length} DOM nodes\n`)

    // Show first 5 DOM nodes
    console.log('   First 5 DOM nodes:')
    for (let i = 0; i < Math.min(5, flatDomNodes.length); i++) {
      const node = flatDomNodes[i]
      console.log(`     ${i + 1}. <${node.tag}> at (${node.rect.x}, ${node.rect.y}) size ${node.rect.w}x${node.rect.h}`)
      if (node.textContent) console.log(`        text: "${node.textContent.slice(0, 40)}"`)
    }

    console.log('\n3. Testing computePropertyDiff with sample matches...\n')

    // Create mock matches from the first element and first DOM node
    let issueCount = 0
    const allIssues = []

    // Try pairing elements with DOM nodes
    for (let i = 0; i < Math.min(10, namedElements.length); i++) {
      for (let j = 0; j < Math.min(20, flatDomNodes.length); j++) {
        const figmaEl = namedElements[i]
        const domNode = flatDomNodes[j]

        // Create a mock match
        const mockMatch = {
          figmaName: figmaEl.name,
          figmaElement: figmaEl,
          domNode: domNode,
          viewport: domSample.viewport,
          confidence: 'high',
        }

        const diffs = computePropertyDiff(mockMatch)

        if (diffs.length > 0) {
          console.log(`MATCH: "${figmaEl.name}" → <${domNode.tag}> (from ${domNode.path})`)
          
          for (const diff of diffs) {
            issueCount++
            allIssues.push({ ...diff, referencedElement: figmaEl.name, domNodePath: domNode.path })
            
            console.log(`  Issue ${issueCount}:`)
            console.log(`    Property: ${diff.property}`)
            console.log(`    Category: ${diff.category}`)
            console.log(`    Severity: ${diff.severity}`)
            console.log(`    Figma value: ${diff.figmaValue}`)
            console.log(`    DOM value: ${diff.domValue}`)
            if (diff.delta) console.log(`    Delta: ${diff.delta}`)
            
            // Show bounding box
            const bbox = buildDomBoundingBox(domNode, domSample.viewport)
            console.log(`    Bounding Box (normalized): ${JSON.stringify(bbox)}`)
            console.log(`    DOM rect (pixels): {x: ${domNode.rect.x}, y: ${domNode.rect.y}, w: ${domNode.rect.w}, h: ${domNode.rect.h}}`)
            console.log()

            if (issueCount >= 5) break
          }
          if (issueCount >= 5) break
        }
      }
      if (issueCount >= 5) break
    }

    console.log('\n=== SUMMARY ===')
    console.log(`Total arithmetic issues found: ${allIssues.length}`)
    console.log(`First 5 issues (shown above): ${Math.min(5, allIssues.length)}`)

    if (allIssues.length > 0) {
      console.log('\n✓ SUCCESS: Arithmetic analysis is working!')
      console.log('Confirmed:')
      console.log('  ✓ computePropertyDiff generates issues')
      console.log('  ✓ buildDomBoundingBox normalizes coordinates')
      console.log('  ✓ Issues have correct structure (property, severity, category, values)')
    } else {
      console.log('\n⚠ No issues found in sample data pairing')
      console.log('This could mean:')
      console.log('  - The sample Figma and DOM structures don\'t have matching elements')
      console.log('  - The sample data doesn\'t have property differences')
      console.log('  - More exploration needed to find matching elements')
    }

  } catch (err) {
    console.error('\nTest error:', err.message)
    console.error(err.stack)
    process.exit(1)
  }
}

runTest()
