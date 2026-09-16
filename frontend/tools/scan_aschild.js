const ts = require('typescript')
const fs = require('fs')
const path = require('path')

function walkDir(dir) {
  const files = []
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    const st = fs.statSync(full)
    if (st.isDirectory()) {
      files.push(...walkDir(full))
    } else if (full.endsWith('.tsx') || full.endsWith('.ts')) {
      files.push(full)
    }
  }
  return files
}

function isNonWhitespaceText(node) {
  return node.kind === ts.SyntaxKind.JsxText && /\S/.test(node.getText())
}

const root = path.join(__dirname, '..', 'src')
const files = walkDir(root)
const fixes = []

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8')
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

  function visit(node) {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node
      const hasAsChild = opening.attributes && opening.attributes.properties && opening.attributes.properties.some(p => p.name && p.name.escapedText === 'asChild')
      if (hasAsChild) {
        // get children for JsxElement
        const children = ts.isJsxElement(node) ? node.children : []
        const nonEmptyChildren = children.filter(c => {
          if (c.kind === ts.SyntaxKind.JsxExpression) {
            // consider expression children non-empty
            return true
          }
          return isNonWhitespaceText(c) || c.kind === ts.SyntaxKind.JsxElement || c.kind === ts.SyntaxKind.JsxSelfClosingElement || c.kind === ts.SyntaxKind.JsxFragment
        })

        if (nonEmptyChildren.length !== 1 || nonEmptyChildren[0] && nonEmptyChildren[0].kind === ts.SyntaxKind.JsxFragment) {
          // propose a fix: wrap inner children with a span
          const openTag = node.getFullStart() // not precise
          // compute text ranges: find start of inner content and end
          if (ts.isJsxElement(node)) {
            const start = node.openingElement.end
            const end = node.closingElement.pos
            const inner = src.slice(start, end)
            // avoid if already wrapped with a single element
            fixes.push({ file, start, end, inner })
          } else {
            // self-closing: can't fix
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
}

fs.writeFileSync(path.join(__dirname, 'aschild-fixes.json'), JSON.stringify(fixes, null, 2))
console.log('Scan complete. Proposed fixes written to tools/aschild-fixes.json')
