import { parseFigmaUrl, fetchFigmaFrame } from '../services/figmaService.js'
import fs from 'fs'
import 'dotenv/config'

const FIGMA_URL = process.argv[2]
const TOKEN = process.env.FIGMA_ACCESS_TOKEN

if (!FIGMA_URL) {
  console.error('Usage: node src/tests/fetchFigma.js <figma-frame-url>')
  process.exit(1)
}
if (!TOKEN) {
  console.error('FIGMA_ACCESS_TOKEN not set in .env')
  process.exit(1)
}

console.log('Fetching Figma frame...')
const { fileKey, nodeId } = parseFigmaUrl(FIGMA_URL)
const frameJson = await fetchFigmaFrame(fileKey, nodeId, TOKEN)

fs.mkdirSync('./src/tests', { recursive: true })
fs.writeFileSync('./src/tests/figma-sample.json',
  JSON.stringify(frameJson, null, 2))

console.log('Saved to src/tests/figma-sample.json')
console.log('Node name:', frameJson.name)
console.log('Node type:', frameJson.type)
console.log('Children count:', frameJson.children?.length ?? 0)
