/**
 * The style sheets of exported SVG (Illustrator writes `.st0{fill:#fff}`, Sketch and Affinity do much the same), reduced to
 * what an editable template wants: every rule that can be understood is moved onto the elements it applies to as
 * presentation attributes, so a later edit of an attribute is not overruled by a class. Rules that cannot be understood
 * (descendant selectors, pseudo-classes, attribute selectors) leave the style block in place.
 */

/** Presentation properties that exist as attributes (the rest of a declaration list stays in `style`). */
export const PRESENTATION = new Set([
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin',
  'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'opacity', 'font-family', 'font-size', 'font-weight',
  'font-style', 'letter-spacing', 'word-spacing', 'text-anchor', 'text-decoration', 'display', 'visibility', 'clip-path',
  'mask', 'filter', 'mix-blend-mode', 'stop-color', 'stop-opacity', 'transform'
])

/** Declarations of a `style` attribute or rule body, as an ordered object. */
export function parseDeclarations(text) {
  const out = {}
  for (const part of String(text ?? '').replace(/\/\*[\s\S]*?\*\//g, '').split(';')) {
    const i = part.indexOf(':')
    if (i < 1) continue
    const name = part.slice(0, i).trim().toLowerCase()
    const value = part.slice(i + 1).replace(/!important/i, '').trim()
    if (name && value) out[name] = value
  }
  return out
}

export const declarationsToText = d => Object.entries(d).map(([k, v]) => `${k}:${v}`).join(';')

const SIMPLE = /^(\*|[a-zA-Z][\w-]*)?((?:\.[\w-]+|#[\w-]+)*)$/

function parseSelector(sel) {
  const m = SIMPLE.exec(sel.trim())
  if (!m || !sel.trim()) return null
  const tag = m[1] && m[1] !== '*' ? m[1] : null
  const classes = [], ids = []
  for (const part of (m[2] ?? '').match(/[.#][\w-]+/g) ?? []) (part[0] === '.' ? classes : ids).push(part.slice(1))
  if (!tag && !classes.length && !ids.length && sel.trim() !== '*') return null
  return { tag, classes, ids, specificity: ids.length * 100 + classes.length * 10 + (tag ? 1 : 0) }
}

/**
 * @returns {{ rules: { selector: object, decls: object, order: number }[], complex: boolean, fontFaces: number, imports: number }}
 */
export function parseStyleSheet(css) {
  let text = String(css ?? '').replace(/\/\*[\s\S]*?\*\//g, '')
  const out = { rules: [], complex: false, fontFaces: 0, imports: 0 }
  out.imports = (text.match(/@import\b/gi) ?? []).length
  text = text.replace(/@import[^;]*;/gi, '')
  // @font-face and other at-rules with a block are not applied (PRD §19.5: fonts are matched by name)
  let guard = 0
  while (/@[\w-]+[^{;]*\{/.test(text) && guard++ < 1000) {
    const at = /@([\w-]+)[^{;]*\{/.exec(text)
    let depth = 1, j = at.index + at[0].length
    for (; j < text.length && depth; j++) { if (text[j] === '{') depth++; else if (text[j] === '}') depth-- }
    if (at[1].toLowerCase() === 'font-face') out.fontFaces++
    else out.complex = true
    text = text.slice(0, at.index) + text.slice(j)
  }
  let order = 0
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m
  while ((m = re.exec(text))) {
    const decls = parseDeclarations(m[2])
    for (const sel of m[1].split(',')) {
      const s = parseSelector(sel)
      if (s) out.rules.push({ selector: s, decls, order: order++ })
      else if (sel.trim()) out.complex = true
    }
  }
  return out
}

/** Whether a rule applies to an element. */
export function matches(selector, el) {
  if (selector.tag && selector.tag !== el.tag) return false
  const classes = (el.attrs.class ?? '').split(/\s+/)
  if (!selector.classes.every(c => classes.includes(c))) return false
  return selector.ids.every(i => el.attrs.id === i)
}

/** The declarations that apply to an element from the style sheets, weakest first (specificity, then source order). */
export function appliedDeclarations(rules, el) {
  const hits = rules.filter(r => matches(r.selector, el)).sort((a, b) => a.selector.specificity - b.selector.specificity || a.order - b.order)
  const out = {}
  for (const r of hits) Object.assign(out, r.decls)
  return out
}

/** Font families named in a style sheet or an attribute value, first name of each list, quotes removed. */
export function familiesIn(value) {
  return String(value ?? '').split(',').map(s => s.trim().replace(/^["']|["']$/g, '').trim()).filter(Boolean)
}
