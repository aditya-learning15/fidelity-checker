import fs from 'fs'

const domJson = JSON.parse(
  fs.readFileSync('./src/tests/dom-sample.json')
)

function walk(node, depth = 0) {
  const indent = '  '.repeat(depth)
  const text = node.textContent
    ? ` "${node.textContent.slice(0, 40)}"` : ''
  const size = `[${node.rect?.w ?? '?'}×${node.rect?.h ?? '?'}]`
  const className = Array.isArray(node.classes) 
    ? node.classes[0] 
    : (typeof node.classes === 'string' ? node.classes.split(' ')[0] : '')
  console.log(
    `${indent}[${depth}] <${node.tag}> .${className}${text} ${size}`
  )
  if (node.children) {
    node.children.forEach(child => walk(child, depth + 1))
  }
}

walk(domJson.tree)
