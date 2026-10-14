/**
 * PRD §14.5: "All user-facing strings are in a single strings file".
 * This test reads the real source (Svelte templates, scripts, and the main process) and fails if
 * any user-visible text is written inline instead of coming from src/shared/strings.js. It also
 * checks that every key the code asks for exists and that no catalog entry is unused.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative } from 'path'
import { parse as parseSvelte } from 'svelte/compiler'
import { parse as parseJs } from 'acorn'
import { strings } from '../../src/shared/strings.js'
import { tr, setCatalog } from '../../src/shared/i18n.js'

const ROOT = join(process.cwd(), 'src')
const LETTERS = /[A-Za-z]{2}/
const walkFiles = (dir, ext, out = []) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walkFiles(p, ext, out)
    else if (name.endsWith(ext)) out.push(p)
  }
  return out
}
const rel = p => relative(process.cwd(), p)

const TEXT_ATTRS = new Set(['title', 'aria-label', 'placeholder', 'alt', 'label'])
const CALLS = new Set(['toast', 'confirm', 'prompt', 'alert'])
const TEXT_KEYS = new Set(['label', 'title', 'message', 'description', 'placeholder', 'text', 'hint', 'tooltip', 'heading'])

/** Strings that are identifiers or developer-facing, not user-visible. */
const ALLOW = [
  /^Unknown table/, /^No IPC handler/, /^unexpected require/,   // internal errors, never shown as UI text
  /^image\//,                                                    // MIME types
  /^\{\{.*\}\}$/,                                                 // template token syntax shown as an example
  /^(SVG|PNG|JPEG|CMYK|RGB|PDF\/X-4|PDF\/X-1a|https:\/\/)$/                // file-format and colour-model names, and a URL start: not translatable words
]

const isUserText = s => typeof s === 'string' && LETTERS.test(s) && !ALLOW.some(rx => rx.test(s))
const textOf = node => {
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value
  if (node?.type === 'TemplateLiteral') return node.quasis.map(q => q.value.cooked).join('')
  if (node?.type === 'BinaryExpression' && node.operator === '+') return [textOf(node.left), textOf(node.right)].filter(Boolean).join('')
  return null
}

/** Every inline user-visible string found in a piece of ESTree. */
function findInline(node, file, found, { inTemplateText = false } = {}) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) { node.forEach(n => findInline(n, file, found, { inTemplateText })); return }
  // tr('area.key', params): the key is not text; only the parameters can hide inline strings
  if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'tr') {
    findInline(node.arguments.slice(1), file, found, { inTemplateText })
    return
  }
  if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && CALLS.has(node.callee.name)) {
    const s = textOf(node.arguments[0]); if (isUserText(s)) found.push(`${file}: ${node.callee.name}(${JSON.stringify(s)})`)
  }
  if ((node.type === 'NewExpression' || node.type === 'CallExpression') && node.callee.type === 'Identifier' && node.callee.name === 'Error') {
    const s = textOf(node.arguments[0]); if (isUserText(s)) found.push(`${file}: Error(${JSON.stringify(s)})`)
  }
  if (node.type === 'Property' && !node.computed) {
    const key = node.key.name ?? node.key.value
    if (TEXT_KEYS.has(key)) { const s = textOf(node.value); if (isUserText(s)) found.push(`${file}: ${key}: ${JSON.stringify(s)}`) }
  }
  // `x === 'error'` compares against a value; it is not text shown to the user
  if (node.type === 'BinaryExpression' && ['===', '!==', '==', '!='].includes(node.operator)) {
    findInline([node.left, node.right].filter(n => n.type !== 'Literal'), file, found, { inTemplateText })
    return
  }
  if (inTemplateText && (node.type === 'Literal' || node.type === 'TemplateLiteral')) {
    const s = textOf(node); if (isUserText(s)) found.push(`${file}: {…${JSON.stringify(s)}…} in markup`)
    return
  }
  for (const [k, v] of Object.entries(node)) {
    if (k === 'loc' || k === 'start' || k === 'end' || k === 'range') continue
    if (v && typeof v === 'object') findInline(v, file, found, { inTemplateText })
  }
}

const svelteFiles = walkFiles(join(ROOT, 'renderer'), '.svelte')
const rendererJs = walkFiles(join(ROOT, 'renderer/src'), '.js')
const mainJs = [
  ...walkFiles(join(ROOT, 'main'), '.js'),
  // code shared by both processes (validation messages, card sizes) is held to the same rule
  ...walkFiles(join(ROOT, 'shared'), '.js').filter(f => !/[\\/](strings|i18n|plural)\.js$/.test(f))
]

describe('single strings file (PRD §14.5)', () => {
  /** Visit every element/attribute/mustache in a Svelte template. */
  function walkTemplate(node, visit) {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) return node.forEach(n => walkTemplate(n, visit))
    visit(node)
    for (const k of ['children', 'attributes', 'else', 'pending', 'then', 'catch']) if (node[k]) walkTemplate(node[k], visit)
  }

  it('has no hard-coded text in Svelte markup', () => {
    const found = []
    for (const f of svelteFiles) {
      const ast = parseSvelte(readFileSync(f, 'utf8'))
      walkTemplate(ast.html, node => {
        if (node.type === 'Text' && LETTERS.test(node.data) && node.data.trim()) found.push(`${rel(f)}: text ${JSON.stringify(node.data.trim().slice(0, 60))}`)
        if (node.type === 'MustacheTag' && node.expression) findInline(node.expression, rel(f), found, { inTemplateText: true })
        if (node.type === 'Attribute' && Array.isArray(node.value)) {
          for (const part of node.value) {
            if (part.type === 'Text') { if (TEXT_ATTRS.has(node.name) && LETTERS.test(part.data)) found.push(`${rel(f)}: ${node.name}="${part.data.slice(0, 50)}"`) }
            else if (part.expression) findInline(part.expression, rel(f), found, { inTemplateText: TEXT_ATTRS.has(node.name) })
          }
        }
      })
    }
    expect(found).toEqual([])
  })

  it('has no inline user-facing strings in component scripts or the renderer logic', () => {
    const found = []
    for (const f of svelteFiles) {
      const ast = parseSvelte(readFileSync(f, 'utf8'))
      for (const part of [ast.instance?.content, ast.module?.content]) findInline(part, rel(f), found)
      walkTemplate(ast.html, node => { if (node.type === 'EventHandler' && node.expression) findInline(node.expression, rel(f), found) })
    }
    for (const f of rendererJs.filter(f => !f.includes('/lib/svgHighlight'))) {
      findInline(parseJs(readFileSync(f, 'utf8'), { ecmaVersion: 'latest', sourceType: 'module' }), rel(f), found)
    }
    expect(found).toEqual([])
  })

  it('has no inline user-facing strings in the main process (menus, dialogs, errors)', () => {
    const found = []
    for (const f of mainJs) {
      const ast = parseJs(readFileSync(f, 'utf8'), { ecmaVersion: 'latest', sourceType: 'module' })
      findInline(ast, rel(f), found)
      // dialog file-type filters: { name: 'Images', extensions: [...] }
      const walk = node => {
        if (!node || typeof node !== 'object') return
        if (Array.isArray(node)) return node.forEach(walk)
        if (node.type === 'ObjectExpression') {
          const keys = node.properties.map(p => p.key?.name)
          if (keys.includes('extensions') && keys.includes('name')) {
            const s = textOf(node.properties.find(p => p.key?.name === 'name').value); if (isUserText(s)) found.push(`${rel(f)}: filter name ${JSON.stringify(s)}`)
          }
        }
        for (const [k, v] of Object.entries(node)) if (v && typeof v === 'object' && k !== 'loc') walk(v)
      }
      walk(ast)
    }
    expect(found).toEqual([])
  })

  it('every key the code uses exists in the strings file', () => {
    const missing = []
    const files = [...svelteFiles, ...rendererJs, ...mainJs]
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      for (const m of src.matchAll(/\btr\(\s*'([A-Za-z0-9_.]+)'/g)) {
        const value = m[1].split('.').reduce((n, p) => n?.[p], strings)
        if (value === undefined) missing.push(`${rel(f)}: ${m[1]}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('has no unused strings left behind', () => {
    const used = new Set()
    for (const f of [...svelteFiles, ...rendererJs, ...mainJs]) {
      for (const m of readFileSync(f, 'utf8').matchAll(/tr\(\s*(?:'([A-Za-z0-9_.]+)'|`([A-Za-z0-9_.]+)\$)/g)) used.add(m[1] ?? m[2])
    }
    const all = []
    const walk = (node, path) => { for (const [k, v] of Object.entries(node)) (typeof v === 'object' ? walk(v, `${path}${k}.`) : all.push(`${path}${k}`)) }
    walk(strings, '')
    const dynamicPrefixes = [...used].filter(k => k.endsWith('.'))
    const unused = all.filter(k => !used.has(k) && !dynamicPrefixes.some(p => k.startsWith(p)))
    expect(unused).toEqual([])
  })

  it('passes every {placeholder} the string needs', () => {
    const problems = []
    const check = (node, file) => {
      if (!node || typeof node !== 'object') return
      if (Array.isArray(node)) return node.forEach(n => check(n, file))
      if (node.type === 'CallExpression' && node.callee?.type === 'Identifier' && node.callee.name === 'tr' && node.arguments[0]?.type === 'Literal') {
        const key = node.arguments[0].value
        const value = key.split('.').reduce((n, part) => n?.[part], strings)
        const arg = node.arguments[1]
        if (typeof value === 'string') {
          const needed = [...value.replace(/(?<!\{)\{\{\w+\}\}(?!\})/g, '').matchAll(/\{(\w+)\}/g)].map(m => m[1])
          if (needed.length) {
            if (!arg) problems.push(`${file}: ${key} needs ${needed}`)
            else if (arg.type === 'ObjectExpression' && !arg.properties.some(p => p.type === 'SpreadElement')) {
              const given = arg.properties.map(p => p.key?.name ?? p.key?.value)
              for (const n of needed) if (!given.includes(n)) problems.push(`${file}: ${key} is missing {${n}} (gets ${given})`)
            }
          }
        }
      }
      for (const [k, v] of Object.entries(node)) if (k !== 'loc' && v && typeof v === 'object') check(v, file)
    }
    for (const f of svelteFiles) check(parseSvelte(readFileSync(f, 'utf8')), rel(f))
    for (const f of [...rendererJs, ...mainJs]) check(parseJs(readFileSync(f, 'utf8'), { ecmaVersion: 'latest', sourceType: 'module' }), rel(f))
    expect(problems).toEqual([])
  })

  it('has no duplicate keys inside any area of the strings file', () => {
    const ast = parseJs(readFileSync(join(ROOT, 'shared/strings.js'), 'utf8'), { ecmaVersion: 'latest', sourceType: 'module' })
    const dupes = []
    const walk = (node, path) => {
      if (!node || typeof node !== 'object') return
      if (Array.isArray(node)) return node.forEach(n => walk(n, path))
      if (node.type === 'ObjectExpression') {
        const seen = new Set()
        for (const p of node.properties) {
          const k = p.key.name ?? p.key.value
          if (seen.has(k)) dupes.push(`${path}${k}`)
          seen.add(k)
          walk(p.value, `${path}${k}.`)
        }
        return
      }
      for (const [k, v] of Object.entries(node)) if (k !== 'loc' && v && typeof v === 'object') walk(v, path)
    }
    walk(ast, '')
    expect(dupes).toEqual([])
  })

  it('substitutes {placeholders}, supports plural functions and falls back to English', () => {
    expect(tr('common.cancel')).toBe('Cancel')
    expect(tr('does.not.exist')).toBe('does.not.exist')
    setCatalog({ common: { cancel: 'Annuler' } })
    expect(tr('common.cancel')).toBe('Annuler')
    expect(tr('common.done')).toBe(strings.common.done)           // missing in the new catalog → English
    setCatalog(null)
    expect(tr('assetBrowser.removeTag', { tag: 'red' })).toBe('Remove tag red')
    expect(tr('assetBrowser.usedByCard', { n: 1 })).toBe('Used by 1 card')
    expect(tr('assetBrowser.usedByCard', { n: 3 })).toBe('Used by 3 cards')
  })
})
