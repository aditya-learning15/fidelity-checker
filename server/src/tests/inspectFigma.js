import fs from 'fs'

const figmaJson = JSON.parse(
  fs.readFileSync('./src/tests/figma-sample.json')
)

// Walk the full tree and print every node's name, type, and depth
function walk(node, depth = 0) {
  const indent = '  '.repeat(depth)
  const childCount = node.children?.length ?? 0
  console.log(`${indent}[${depth}] "${node.name}" (${node.type}) — ${childCount} children`)
  if (node.children) {
    node.children.forEach(child => walk(child, depth + 1))
  }
}

walk(figmaJson)
