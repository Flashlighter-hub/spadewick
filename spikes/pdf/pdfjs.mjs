// Spike C: a third reader, pdf.js (the engine of Firefox and of many web viewers): does it parse the page, the layers and the colour spaces?
import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
process.chdir(dirname(fileURLToPath(import.meta.url)))
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
const warnings = []
const origWarn = console.log
console.log = (...a) => { const t = a.join(' '); if (/^Warning|Unable|Error/.test(t)) warnings.push(t); else origWarn(...a) }
const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync('out/c.pdf')), verbosity: 1 }).promise
const page = await doc.getPage(1)
const oc = await doc.getOptionalContentConfig()
const layers = [...oc].map(([id, g]) => ({ name: g.name, visible: g.visible }))
const ops = await page.getOperatorList()
const out = { pdfjs: pdfjs.version, pages: doc.numPages, view: page.view, layers, operators: ops.fnArray.length, warnings }
console.log = origWarn
writeFileSync('out/pdfjs.json', JSON.stringify(out, null, 1))
console.log(JSON.stringify(out))
