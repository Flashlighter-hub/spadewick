/**
 * The text step of the render pipeline (PRD §7.4, §10.5 step 6, §16.2): every <text> element the engine understands
 * is replaced by the outlines of its laid-out text. Templates are still WRITTEN with <text>; the outlines are made
 * when a card is rendered.
 *
 * Two kinds of element:
 *   bound   has data-spadewick-field: filled from the card's field and fitted to its box (wrap, shrink, overflow,
 *           truncate, clip), exactly as dynamicText.js did with estimated widths;
 *   plain   any other <text>: one line (or the lines of its own newlines), drawn where it is.
 *
 * An element that uses something the engine does not do (a text path, rotated glyphs, text decoration, CSS classes
 * from a <style> block, per-glyph positions…) is left alone for the rasterizer, and counted in the report.
 */
import { parseFamilyList, parseWeight } from './fonts.js'
import { layoutFit } from './layout.js'
import { layoutToSvg } from './outline.js'
import { layoutText as estimateLayout } from '../dynamicText.js'
import { parseMarkup } from '../../shared/richText.js'
import { applyKeywordRules } from '../../shared/keywords.js'
import { mergeStyles } from '../../shared/textStyleProps.js'
import { emptyLibrary } from './library.js'
import { lengthPx } from './cssLength.js'
import { readControls, finishSpans, bulletize } from './controls.js'

// ---------------------------------------------------------------------------
// Small XML / CSS helpers
// ---------------------------------------------------------------------------

const TOKEN = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<(\/?)([A-Za-z_][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g
const ATTR = /([^\s=/"']+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g

/** Attribute name -> raw (still entity-encoded) value. */
function parseAttrs(raw) {
  const map = new Map()
  for (const m of raw.matchAll(ATTR)) map.set(m[1], m[2] ?? m[3] ?? '')
  return map
}

export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (m, e) => {
    if (e[0] === '#') { const cp = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m }
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e]
  })
}

function parseStyle(raw) {
  const map = new Map()
  for (const decl of String(raw ?? '').split(';')) {
    const i = decl.indexOf(':')
    if (i > 0) map.set(decl.slice(0, i).trim().toLowerCase(), decl.slice(i + 1).trim())
  }
  return map
}

// Properties the engine does not do: an element that uses one is left to the rasterizer
const UNSUPPORTED_ATTRS = ['rotate', 'textLength', 'lengthAdjust', 'writing-mode', 'text-decoration', 'font-variant', 'font-stretch',
  'font-size-adjust', 'baseline-shift', 'dominant-baseline', 'alignment-baseline', 'xml:space', 'white-space', 'font-feature-settings', 'font-kerning', 'glyph-orientation-vertical', 'glyph-orientation-horizontal']
const FONT_STYLE_KEYS = new Set(['font-family', 'font-size', 'font-weight', 'font-style', 'letter-spacing', 'word-spacing', 'text-anchor', 'direction', 'unicode-bidi'])
// Attributes that describe the layout and leave the element when it is replaced by outlines
const LAYOUT_ATTRS = new Set([...FONT_STYLE_KEYS, 'x', 'y', 'dx', 'dy', 'width', 'height', 'data-spadewick-rich', 'data-spadewick-keywords', 'data-spadewick-field', 'data-spadewick-text-fit', 'data-spadewick-text-max-size',
  'data-spadewick-text-min-size', 'data-spadewick-overflow-target', 'data-spadewick-line-height', 'data-spadewick-text-step', 'data-spadewick-tighten',
  'data-spadewick-icon-scale', 'data-spadewick-text-max-lines', 'data-spadewick-paragraph-spacing', 'data-spadewick-text-align', 'data-spadewick-valign',
  'data-spadewick-indent', 'data-spadewick-bullets', 'data-spadewick-bullet', 'data-spadewick-text-transform', 'data-spadewick-balance',
  'data-spadewick-avoid-orphans', 'data-spadewick-outline', 'data-spadewick-shadow'])

// ---------------------------------------------------------------------------
// Inherited text properties, tracked down the element stack
// ---------------------------------------------------------------------------

const ROOT = { fill: undefined, family: '', size: null, weight: 400, italic: false, letterSpacing: 0, wordSpacing: 0, anchor: 'start', direction: undefined, hidden: false, clip: false, classed: false, bad: false }

/** The text properties an element has after inheriting from its parent and applying its own (style wins over attributes). */
function frameOf(parent, name, attrs, style) {
  const f = { ...parent }
  const get = k => style.get(k) ?? attrs.get(k)
  let v
  if ((v = get('font-family')) != null) f.family = v
  if ((v = get('font-size')) != null) { const px = lengthPx(v, parent.size); if (px === null) f.bad = true; else f.size = px }
  if ((v = get('font-weight')) != null) f.weight = parseWeight(v)
  if ((v = get('font-style')) != null) f.italic = /italic|oblique/i.test(v)
  if ((v = get('letter-spacing')) != null) { const px = v.trim() === 'normal' ? 0 : lengthPx(v, f.size ?? 12); if (px === null) f.bad = true; else f.letterSpacing = px }
  if ((v = get('word-spacing')) != null) { const px = v.trim() === 'normal' ? 0 : lengthPx(v, f.size ?? 12); if (px === null) f.bad = true; else f.wordSpacing = px }
  if ((v = get('text-anchor')) != null) f.anchor = v.trim()
  if ((v = get('direction')) != null) f.direction = v.trim()
  if ((v = get('fill')) != null) f.fill = /^\s*(none|url\()/i.test(v) ? undefined : v.trim() // the colour of the text, for icons that follow it
  if (style.has('font')) f.bad = true // the shorthand sets everything at once; not read
  const display = get('display')
  f.hidden = parent.hidden || /^\s*none\s*$/i.test(display ?? '') || /^\s*(hidden|collapse)\s*$/i.test(get('visibility') ?? '')
  f.clip = parent.clip || name === 'clipPath'
  f.classed = parent.classed || attrs.has('class')
  return f
}

// ---------------------------------------------------------------------------
// The pass
// ---------------------------------------------------------------------------

const DEFAULT_SIZE = 12 // the rasterizer's own default, so unstyled text keeps its size

/**
 * Convert the text elements of one kind.
 * @param {string} svg
 * @param {{ fontSet, fields: object, report?: object, overflow?: Map<string,string> }} env
 * @param {'bound'|'plain'} kind
 * @returns {string}
 */
export function convertText(svg, env, kind) {
  const hasStyleBlock = /<style[\s>]/i.test(svg)
  const stack = [{ name: '#root', frame: ROOT }]
  let out = '', last = 0
  TOKEN.lastIndex = 0
  for (let m; (m = TOKEN.exec(svg));) {
    if (!m[2]) continue // comment, CDATA, processing instruction
    const closing = m[1] === '/', name = m[2], raw = m[3]
    if (closing) { if (stack.length > 1 && stack[stack.length - 1].name === name) stack.pop(); continue }
    const selfClosing = /\/\s*$/.test(raw)
    const attrs = parseAttrs(raw)
    const parent = stack[stack.length - 1].frame

    if (name === 'text') {
      let inner = '', end = TOKEN.lastIndex
      if (!selfClosing) {
        const close = svg.indexOf('</text>', TOKEN.lastIndex)
        if (close < 0) break // damaged markup: leave the rest alone
        inner = svg.slice(TOKEN.lastIndex, close); end = close + 7
      }
      const replacement = convertElement(attrs, inner, parent, kind, env, hasStyleBlock)
      if (replacement !== null) { out += svg.slice(last, m.index) + replacement; last = end }
      TOKEN.lastIndex = end
      continue
    }
    if (!selfClosing) stack.push({ name, frame: frameOf(parent, name, attrs, parseStyle(attrs.get('style'))) })
  }
  return out + svg.slice(last)
}

/** Everything the element uses that the engine does not do, or null when it can be drawn. */
function unsupported(attrs, style, frame, hasStyleBlock) {
  if (frame.bad || (frame.classed && hasStyleBlock)) return 'style'
  for (const k of UNSUPPORTED_ATTRS) if (attrs.has(k) || style.has(k)) return k
  for (const k of ['x', 'y']) if (attrs.has(k) && !/^\s*[+-]?[\d.]+(px)?\s*$/.test(attrs.get(k))) return k // lists of positions
  return null
}

const num = (attrs, k) => { const v = attrs.get(k); if (v == null) return null; const px = lengthPx(v, DEFAULT_SIZE); return px }

/** The replacement markup for one <text> element, or null to leave it for the rasterizer. */
function convertElement(attrs, inner, parent, kind, env, hasStyleBlock) {
  const bound = attrs.has('data-spadewick-field')
  if ((kind === 'bound') !== bound) return null
  const style = parseStyle(attrs.get('style'))
  const frame = frameOf(parent, 'text', attrs, style)
  if (frame.hidden || frame.clip) return null
  const where = { id: attrs.get('data-spadewick-id') ?? attrs.get('id') ?? null, field: attrs.get('data-spadewick-field') ?? null }
  const why = unsupported(attrs, style, frame, hasStyleBlock)
  if (why) { if (env.report) { (env.report.native ??= []).push(why); (env.report.items ??= []).push({ type: 'native', reason: why, where }) } return null }

  const x = num(attrs, 'x') ?? 0, y = num(attrs, 'y') ?? 0
  const dx = attrs.has('dx') ? lengthPx(attrs.get('dx'), frame.size ?? DEFAULT_SIZE) : 0
  const dy = attrs.has('dy') ? lengthPx(attrs.get('dy'), frame.size ?? DEFAULT_SIZE) : 0
  if (dx === null || dy === null || /[\s,]/.test(String(attrs.get('dx') ?? '').trim()) || /[\s,]/.test(String(attrs.get('dy') ?? '').trim())) return null

  const chainFor = f => env.fontSet.chain(parseFamilyList(f.family), { weight: f.weight, italic: f.italic })
  const ctl = readControls(attrs, frame)
  const library = env.library ?? emptyLibrary

  let makeSpans, fit = {}, box = {}, value = null, rich = false
  if (bound) {
    const slug = attrs.get('data-spadewick-field')
    value = String(env.fields[slug] ?? '').replace(/\r\n?/g, '\n')
    // Markup is read in a field of the Rich text type, and in any element that asks for it (PRD §16.3)
    rich = env.fieldTypes?.[slug] === 'rich_text' || attrs.get('data-spadewick-rich') === 'true'
    value = value.split('\n').map(l => l.replace(/[ \t]+/g, ' ').trim()).join('\n')
    if (ctl.bullets) value = bulletize(value)
    const own = frame.size
    const maxSize = Number(attrs.get('data-spadewick-text-max-size')) || own || 14
    const minSize = Number(attrs.get('data-spadewick-text-min-size')) || 7
    const raw = rich ? richMaker(value, frame, env, { slug, where, keywords: attrs.get('data-spadewick-keywords') !== 'off', fixedIcons: ctl.iconsFixed ? maxSize : null }) : plainMaker(value, frame, chainFor(frame))
    makeSpans = (size, tracking = 0) => finishSpans(raw(size, tracking), ctl, library)
    fit = { fit: (attrs.get('data-spadewick-text-fit') ?? 'wrap').toLowerCase(), size: own || maxSize, maxSize, minSize }
    box = { width: Number(attrs.get('width')) || undefined, height: Number(attrs.get('height')) || undefined }
  } else if (attrs.get('data-spadewick-rich') === 'true') {
    // A plain element that asks for markup: its text, after the tokens were filled in, is read as markup
    if (/<(?!!--)/.test(inner)) { if (env.report) { (env.report.native ??= []).push('content'); (env.report.items ??= []).push({ type: 'native', reason: 'content', where }) } return null }
    rich = true
    const text = decodeEntities(inner).replace(/\r\n?/g, '\n').split('\n').map(l => l.replace(/[ \t]+/g, ' ').trim()).join('\n').trim()
    const raw = richMaker(ctl.bullets ? bulletize(text) : text, frame, env, { where, keywords: attrs.get('data-spadewick-keywords') !== 'off' })
    makeSpans = (size, tracking = 0) => finishSpans(raw(size, tracking), ctl, library)
    fit = { fit: 'wrap', size: frame.size ?? DEFAULT_SIZE }
  } else {
    const spans = plainSpans(inner, frame, chainFor)
    if (spans === null) { if (env.report) { (env.report.native ??= []).push('content'); (env.report.items ??= []).push({ type: 'native', reason: 'content', where }) } return null }
    const base = frame.size ?? DEFAULT_SIZE
    makeSpans = (size, tracking = 0) => finishSpans(spans.map(s => ({ ...s, size: s.size * (size / base), letterSpacing: s.letterSpacing + tracking * s.size * (size / base) })), ctl, library)
    fit = { fit: 'wrap', size: base }
  }

  const rtl = frame.direction === 'rtl' ? true : frame.direction === 'ltr' ? false : undefined
  const boxed = !!box.width || !!box.height
  const align = ctl.justify ? 'justify' : frame.anchor === 'middle' ? 'center' : frame.anchor === 'end' ? 'right' : 'left'
  const layout = layoutFit(makeSpans, {
    ...fit, width: box.width, height: box.height, align: box.width ? align : 'left', rtl,
    lineHeight: ctl.lineHeight ?? 1.2, lineExact: ctl.lineExact ?? null, paragraphSpacing: ctl.paragraphSpacing ?? 0, indent: ctl.indent ?? 0,
    tighten: ctl.tighten ?? 0, step: ctl.step ?? 1, maxLines: ctl.maxLines ?? null, balance: ctl.balance, avoidOrphans: ctl.avoidOrphans
  })

  // Where the lines go. With a box, (x, y) is its top-left corner; without one, y is the first baseline and the lines hang
  // from the anchor point (PRD §7.4).
  const factor = frame.anchor === 'middle' ? 0.5 : frame.anchor === 'end' ? 1 : 0
  if (!box.width) for (const l of layout.lines) l.x = -l.width * factor
  let top = boxed ? y + dy : y + dy - (layout.lines[0]?.baseline ?? 0)
  // Where the text sits in a box that is taller than it
  if (box.height && ctl.valign && layout.height < box.height) top += ctl.valign === 'middle' ? (box.height - layout.height) / 2 : box.height - layout.height

  if (env.report) {
    record(env.report, attrs, bound && !rich, value, layout, fit, box)
    const items = (env.report.items ??= [])
    for (const ch of layout.missing) items.push({ type: 'missingGlyph', char: ch, where })
    if (fit.fit === 'shrink' && layout.fits === false) items.push({ type: 'noFit', size: layout.size, min: fit.minSize, where })
    // where the text is drawn, in the template's units (left, top, right, bottom), and its colour: the print preflight reads these
    const left = Math.min(...layout.lines.map(l => x + dx + l.x)), right = Math.max(...layout.lines.map(l => x + dx + l.x + l.width))
    const extent = layout.lines.length && Number.isFinite(left) ? [left, top, right, top + layout.height] : null
    ;(env.report.fits ??= []).push({ where, fit: fit.fit, size: layout.size, tracking: layout.tracking, lines: layout.lines.length, fits: layout.fits, extent, fill: frame.fill ?? null, rotated: attrs.has('transform') })
  }
  if (bound && layout.overflowText && attrs.get('data-spadewick-overflow-target')) env.overflow?.set(attrs.get('data-spadewick-overflow-target'), layout.overflowText)

  const drawing = layoutToSvg(layout, x + dx, top, { resolveIcon: (env.library ?? emptyLibrary).entry, onMissingIcon: name => { if (!env.report) return; (env.report.missingIcons ??= new Set()).add(name); (env.report.items ??= []).push({ type: 'missingIcon', name, where }) } })
  return `<g${keptAttributes(attrs, style)}>${drawing}</g>`
}

/** Spans for plain text in one style, for a nominal size. */
const plainMaker = (text, frame, chain) => (size, tracking = 0) => [{ text, chain, size, letterSpacing: frame.letterSpacing + tracking * size }]

/**
 * Spans for text with markup (PRD §16.3): each run of the parsed markup becomes a span with its own weight, slant,
 * colour, size and font; an icon becomes a box that scales with the text. Keyword rules are applied to the runs, and a
 * run inside {style:name} takes the properties of that text style under whatever the markup itself says (§16.5).
 * Problems the markup has are kept in the report.
 */
function richMaker(text, frame, env, { slug, where = null, keywords = true, fixedIcons = null } = {}) {
  const lib = env.library ?? emptyLibrary
  const { runs: parsed, problems } = parseMarkup(text, { knownStyles: lib.styleKeys })
  if (env.report && problems.length) { (env.report.markup ??= []).push(...problems); (env.report.items ??= []).push(...problems.map(p => ({ type: 'markup', problem: p.type, text: p.text, where }))) }
  const runs = keywords ? applyKeywordRules(parsed, lib.rules, { slug }) : parsed
  const families = parseFamilyList(frame.family)
  return (size, tracking = 0) => runs.map(run => {
    const sp = mergeStyles((run.styles ?? []).map(k => lib.styles.get(k)))
    const spanSize = size * run.size * (sp.size ?? 1)
    if (run.icon) {
      const iconSpan = (fixedIcons ?? size) * run.size * (sp.size ?? 1) // icons keep their size while the text shrinks when asked to
      const e = lib.entry(run.icon)
      const info = e ?? { aspect: 1, size: 1, vOffset: 0, spacing: 0 }
      return { icon: run.icon, size: iconSpan, scale: run.scale * info.size, aspect: info.aspect, spacing: info.spacing, vOffset: info.vOffset, fill: run.iconColor ?? run.color ?? sp.color ?? frame.fill }
    }
    const bold = run.bold || sp.bold, italic = run.italic || sp.italic
    const names = run.font ? [run.font, ...families] : sp.fontFamily ? [sp.fontFamily, ...families] : families
    const info = env.fontSet.chainInfo(names, { weight: bold ? Math.max(700, frame.weight) : frame.weight, italic: italic || frame.italic })
    return {
      text: run.text, chain: info.faces, size: spanSize, fill: run.color ?? sp.color,
      letterSpacing: frame.letterSpacing + (sp.tracking ? sp.tracking / 1000 * spanSize : 0) + tracking * spanSize,
      underline: run.underline || sp.underline, strike: run.strike || sp.strike, synthBold: info.synthBold, synthItalic: info.synthItalic,
      outline: sp.outlineWidth ? { width: sp.outlineWidth * spanSize, color: sp.outlineColor ?? '#000000' } : undefined,
      shadow: sp.shadowX || sp.shadowY ? { dx: (sp.shadowX ?? 0) * spanSize, dy: (sp.shadowY ?? 0) * spanSize, color: sp.shadowColor ?? '#000000' } : undefined,
      smallCaps: !!sp.smallCaps
    }
  })
}

/**
 * Mark the text elements whose content is a token of a Rich text field, so their markup is read even when the element
 * is not bound with data-spadewick-field. Runs before the tokens are filled in.
 */
export function markRichTokens(svg, richSlugs) {
  if (!richSlugs.size) return svg
  return svg.replace(/<text\b([^>]*?)>([\s\S]*?)<\/text>/g, (full, attrs, inner) => {
    if (/data-spadewick-rich\s*=/.test(attrs) || /data-spadewick-field\s*=/.test(attrs)) return full
    for (const m of inner.matchAll(/\{\{\s*([^}\s]+)\s*\}\}/g)) if (richSlugs.has(m[1])) return `<text${attrs} data-spadewick-rich="true">${inner}</text>`
    return full
  })
}

/** The text and tspans of a plain element as spans (whitespace collapsed as SVG does), or null for anything else inside it. */
function plainSpans(inner, frame, chainFor) {
  const spans = []
  const frames = [frame]
  let atStart = true, pendingSpace = false
  const push = (text, f) => {
    if (!text) return
    spans.push({ text, chain: chainFor(f), size: f.size ?? DEFAULT_SIZE, fill: f.fill, letterSpacing: f.letterSpacing })
  }
  const parts = inner.split(/(<[^>]*>)/)
  for (const part of parts) {
    if (!part) continue
    if (part[0] !== '<') {
      let t = decodeEntities(part).replace(/\s+/g, ' ')
      if (atStart || pendingSpace) t = t.replace(/^ /, '')
      if (!t) continue
      push(t, frames[frames.length - 1])
      atStart = false; pendingSpace = t.endsWith(' ')
      continue
    }
    if (part.startsWith('<!--')) continue
    const m = /^<(\/?)([A-Za-z][\w:.-]*)([\s\S]*?)(\/?)>$/.exec(part)
    if (!m || m[2] !== 'tspan') return null
    if (m[1]) { if (frames.length > 1) frames.pop(); continue }
    if (m[4]) continue // an empty <tspan/>
    const a = parseAttrs(m[3]), s = parseStyle(a.get('style'))
    for (const k of ['x', 'y', 'dx', 'dy', 'rotate', 'textLength', 'lengthAdjust', 'baseline-shift', 'class', 'text-decoration', 'dominant-baseline', 'alignment-baseline', 'word-spacing', 'font-variant', 'font-feature-settings']) if (a.has(k) || s.has(k)) return null
    if (a.has('text-anchor') || s.has('text-anchor')) return null // an anchor per tspan starts a new text chunk
    const f = frameOf(frames[frames.length - 1], 'tspan', a, s)
    if (f.bad) return null
    f.fill = s.get('fill') ?? a.get('fill') ?? frames[frames.length - 1].fill
    frames.push(f)
  }
  // No space at the very end
  while (spans.length && /^ *$/.test(spans[spans.length - 1].text)) spans.pop()
  if (spans.length) spans[spans.length - 1].text = spans[spans.length - 1].text.replace(/ $/, '')
  return spans
}

/** The element's own attributes, minus the layout ones, as markup for the <g> that replaces it. */
function keptAttributes(attrs, style) {
  let s = ''
  for (const [k, v] of attrs) {
    if (LAYOUT_ATTRS.has(k)) continue
    if (k === 'style') {
      const kept = [...style].filter(([p]) => !FONT_STYLE_KEYS.has(p)).map(([p, val]) => `${p}:${val}`).join(';')
      if (kept) s += ` style="${kept.replace(/"/g, '&quot;')}"`
      continue
    }
    s += ` ${k}="${v.replace(/"/g, '&quot;')}"`
  }
  return s
}

/** What the report learns about each drawn element (missing characters, and how the old estimate would have laid it out). */
function record(report, attrs, bound, value, layout, fit, box) {
  for (const ch of layout.missing) (report.missing ??= new Set()).add(ch)
  if (!bound || !report.compare) return
  const old = estimateLayout(value, {
    boxWidth: box.width, boxHeight: box.height, fit: fit.fit, fontSize: fit.size, maxSize: fit.maxSize, minSize: fit.minSize, lineHeight: fit.lineHeight,
    bold: false
  })
  const now = layout.lines.map(l => layout.text.slice(l.start, l.end).trim())
  const same = old.fontSize === layout.size && old.lines.length === now.length && old.lines.every((l, i) => l.trim() === now[i])
  if (!same) report.changed = (report.changed ?? 0) + 1
  report.bound = (report.bound ?? 0) + 1
}

/**
 * Put the overflow text of bound elements into their targets (the element with that id gets the text as its content),
 * as the estimator did through markers (PRD §7.4).
 */
export function applyOverflow(svg, overflow) {
  for (const [id, text] of overflow) {
    const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const pattern = new RegExp(`(<[^>]+\\bid="${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>)[\\s\\S]*?(</)`)
    svg = svg.replace(pattern, (_, open, close) => `${open}${escaped}${close}`)
  }
  return svg
}
