import fs from 'fs'
import { extractNamedElements } from '../services/tokenService.js'
import { matchElements, flattenDomTree } from '../services/matchService.js'
import 'dotenv/config'

const figmaJson = JSON.parse(fs.readFileSync('./src/tests/figma-sample.json'))
const domJson   = JSON.parse(fs.readFileSync('./src/tests/dom-sample.json'))

const namedElements = extractNamedElements(figmaJson)
console.log('\n--- FIGMA NAMED ELEMENTS ---')
console.log(`Found ${namedElements.length} named elements`)
namedElements.forEach(e => console.log(`  · ${e.name} (${e.type})`))

const flatNodes = flattenDomTree(domJson)
console.log('\n--- DOM FLAT NODES (top 10 by area) ---')
flatNodes.slice(0, 10).forEach(n =>
  console.log(`  · ${n.path} [${n.rect.w}×${n.rect.h}] bg:${n.styles.backgroundColor}`)
)

console.log('\n--- RUNNING MATCH ---')
const result = await matchElements(
  namedElements,
  domJson,
  process.env.GEMINI_API_KEY
)

console.log('\n--- MATCHES ---')
result.matches.forEach(m => {
  console.log(`\n  ${m.figmaName}`)
  console.log(`    → ${m.domPath}`)
  console.log(`    confidence: ${m.confidence}`)
  console.log(`    reason: ${m.reasoning}`)
})

console.log('\n--- UNMATCHED FIGMA ELEMENTS ---')
result.unmatched.forEach(name => console.log(`  · ${name}`))

console.log(`\nSummary: ${result.matches.length} matched,
  ${result.unmatched.length} unmatched`)
