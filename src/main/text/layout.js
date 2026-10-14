/**
 * The text engine's layout (PRD §16.2): real font measurements, Unicode line breaking and bidirectional text.
 *
 * One description of laid-out text (lines of placed glyph runs and icon boxes) is produced here; the picture is
 * drawn from that description (outline.js), so what is measured is what is drawn.
 *
 *   spans: [{ text, chain, size, fill?, letterSpacing?, features? }  |  { icon, size, scale?, fill? }]
 *     chain  the faces to try for each character, first choice first (fonts.js)
 *
 * Vertical model (kept from PRD §7.4): a line is `size × lineHeight` tall, and its baseline sits 0.85 × size below
 * the top of the line, so existing templates keep their positions. Mixed sizes use the largest on the line.
 */
import bidiFactory from 'bidi-js'
import LineBreaker from 'linebreak'

export const ASCENT = 0.85

const bidi = bidiFactory()
const ICON = '' // private-use stand-in in the text: it behaves like a letter, so an icon never separates from a touching word or mark

// Collapsible spaces. No-break spaces (U+00A0, U+2007, U+202F) are deliberately not here: they are glue.
const SPACE = /[ \t  -  -  　]/
export const isSpace = ch => SPACE.test(ch)

// ---------------------------------------------------------------------------
// Shaping, with a cache: the same text in the same face and direction is shaped once
// ---------------------------------------------------------------------------

const shapeMemo = new Map()
const SHAPE_MEMO_LIMIT = 4000

function shapeCached(face, text, rtl, features) {
  const key = `${face.file}|${rtl ? 1 : 0}|${features.join(',')}|${text}`
  let hit = shapeMemo.get(key)
  if (!hit) {
    if (shapeMemo.size >= SHAPE_MEMO_LIMIT) shapeMemo.clear()
    hit = face.shape(text, rtl, features)
    shapeMemo.set(key, hit)
  }
  return hit
}

// ---------------------------------------------------------------------------
// Atoms: the smallest pieces a line is made of (a word or a run of spaces, in one span, face and direction)
// ---------------------------------------------------------------------------

function itemize(spans, rtlPara) {
  let text = ''
  const owner = []
  spans.forEach((s, i) => { const t = s.icon ? ICON : s.text; for (let k = 0; k < t.length; k++) owner.push(i); text += t })
  const levels = text ? bidi.getEmbeddingLevels(text, rtlPara === undefined ? undefined : rtlPara ? 'rtl' : 'ltr').levels : []

  const breaks = new Set([0, text.length])
  const forced = new Set()
  if (text) { const lb = new LineBreaker(text); for (let b; (b = lb.nextBreak());) { breaks.add(b.position); if (b.required) forced.add(b.position) } }

  // The face that draws each character: the first in the span's chain that has a glyph for it
  const faceOf = new Array(text.length)
  for (let i = 0; i < text.length;) {
    const cp = text.codePointAt(i), n = cp > 0xffff ? 2 : 1
    const s = spans[owner[i]]
    let f = null
    if (!s.icon) {
      f = isSpace(text[i]) && i > 0 && owner[i - 1] === owner[i] && faceOf[i - 1] // spaces stay in the surrounding run's face
        ? faceOf[i - 1]
        : s.chain.find(face => face.has(cp)) ?? s.chain[0]
    }
    for (let k = 0; k < n; k++) faceOf[i + k] = f
    i += n
  }

  const cuts = new Set(breaks)
  for (let i = 1; i < text.length; i++) {
    if (owner[i] !== owner[i - 1] || levels[i] !== levels[i - 1] || faceOf[i] !== faceOf[i - 1] || isSpace(text[i]) !== isSpace(text[i - 1]) || text[i] === '\n' || text[i - 1] === '\n') cuts.add(i)
  }
  const pos = [...cuts].sort((a, b) => a - b)
  const atoms = []
  for (let k = 0; k + 1 < pos.length; k++) {
    const a = pos[k], b = pos[k + 1]
    if (a === b) continue
    const span = spans[owner[a]]
    atoms.push({
      start: a, end: b, text: text.slice(a, b), span, level: levels[a], face: faceOf[a],
      space: !span.icon && isSpace(text[a]), newline: text[a] === '\n',
      breakAfter: breaks.has(b) && b !== text.length, mustBreak: forced.has(b)
    })
  }
  return { text, atoms }
}

const advance = (glyphs, k, ls) => glyphs.reduce((w, g) => w + g.ax * k + ls, 0)

// The space added after every glyph: the span's own letter-spacing, and a little more when bold is synthesized (a heavier copy needs room)
const letterSpace = span => (span.letterSpacing ?? 0) + (span.synthBold ? span.size * 0.025 : 0)

/** Shape whole runs (same span, face and direction), then give each atom the glyphs of its own characters. */
function measureAtoms(atoms, missing) {
  for (let i = 0; i < atoms.length;) {
    const a = atoms[i]
    if (a.span.icon) {
      // An icon is a box: as tall as its size, as wide as its picture's shape, with its own space before and after
      a.iconSize = (a.span.scale ?? 1) * a.span.size
      a.iconW = a.iconSize * (a.span.aspect ?? 1)
      a.pad = (a.span.spacing ?? 0) * a.span.size
      a.width = a.iconW + 2 * a.pad + (a.span.marker ? (a.span.afterSpace ?? 0) : 0)
      a.marker = !!a.span.marker
      a.glyphs = null; i++; continue
    }
    if (a.newline) { a.glyphs = []; a.width = 0; i++; continue }
    let j = i + 1
    while (j < atoms.length && !atoms[j].newline && !atoms[j].span.icon && atoms[j].span === a.span && atoms[j].face === a.face && atoms[j].level === a.level) j++
    const run = atoms.slice(i, j)
    const rtl = a.level % 2 === 1
    const ls = letterSpace(a.span)
    // Shaping whole runs keeps kerning across spaces; letter-spacing switches the optional ligatures off, as CSS does
    const features = [...(a.span.features ?? []), ...(a.span.letterSpacing ? ['-liga', '-clig'] : [])]
    const glyphs = shapeCached(a.face, run.map(x => x.text).join(''), rtl, features)
    const base = run[0].start
    for (const x of run) x.glyphs = []
    for (const g of glyphs) {
      let t = run.length - 1
      while (t > 0 && run[t].start - base > g.cluster) t--
      run[t].glyphs.push({ ...g, cluster: g.cluster - (run[t].start - base) })
    }
    const k = a.span.size / a.face.upem
    for (const x of run) {
      x.width = advance(x.glyphs, k, ls)
      if (x.space && a.span.wordSpacing) x.width += a.span.wordSpacing * x.text.length // word spacing is extra space at every space (PRD §16.6)
      if (a.span.marker) { x.width += a.span.afterSpace ?? 0; x.marker = true }  // a bullet: the gap after it belongs to it
      for (const g of x.glyphs) if (g.gid === 0) missing.add(String.fromCodePoint(x.text.codePointAt(g.cluster) ?? 0xfffd))
    }
    i = j
  }
}

/** Cut an atom at a character offset that starts a glyph cluster. Returns [first, second]. */
function splitAtom(atom, at) {
  const k = atom.span.size / atom.face.upem, ls = letterSpace(atom.span)
  const left = atom.glyphs.filter(g => g.cluster < at), right = atom.glyphs.filter(g => g.cluster >= at)
  const a = { ...atom, end: atom.start + at, text: atom.text.slice(0, at), glyphs: left, breakAfter: true, mustBreak: false }
  const b = { ...atom, start: atom.start + at, text: atom.text.slice(at), glyphs: right.map(g => ({ ...g, cluster: g.cluster - at })) }
  a.width = advance(left, k, ls)
  b.width = advance(b.glyphs, k, ls)
  return [a, b]
}

/**
 * A word wider than the box is broken by characters (PRD §7.4): cut the atoms of the segment into pieces that
 * fit `room` each, starting with `first` room on the current line.
 */
function breakByCharacters(seg, boxW, first) {
  const out = []
  let room = first
  for (let atom of seg) {
    while (atom.width > room + 1e-6 && atom.glyphs?.length > 1) {
      const k = atom.span.size / atom.face.upem, ls = letterSpace(atom.span)
      const starts = [...new Set(atom.glyphs.map(g => g.cluster))].filter(c => c > 0).sort((x, y) => x - y)
      let cut = null
      for (const c of starts) {
        const w = advance(atom.glyphs.filter(g => g.cluster < c), k, ls)
        if (w <= room + 1e-6) cut = c; else break
      }
      if (cut === null) { if (room < boxW - 1e-6) { out.push({ wrap: true }); room = boxW; continue } cut = starts[0] }
      if (cut === undefined) break
      const [a, b] = splitAtom(atom, cut)
      out.push(a, { wrap: true })
      atom = b; room = boxW
    }
    out.push(atom)
    room = Math.max(0, room - atom.width)
  }
  return out
}

// ---------------------------------------------------------------------------
// Laying out a paragraph
// ---------------------------------------------------------------------------

/**
 * @param {object[]} spans
 * @param {{ width?: number, align?: 'left'|'center'|'right', rtl?: boolean, lineHeight?: number }} opts
 *   width     the box width, or Infinity / undefined for a single unwrapped line per paragraph
 *   rtl       paragraph direction; undefined takes it from the first strong character (UAX #9)
 * @returns {{ text, lines, height, width, missing }}
 *   lines: [{ start, end, x, top, baseline, size, width, items }]  (start/end: character range in `text`)
 */
export function layoutParagraph(spans, opts = {}) {
  const { width: boxW = Infinity, align = 'left', rtl, lineHeight = 1.2, lineExact = null, paragraphSpacing = 0, indent = 0 } = opts
  const { text, atoms } = itemize(spans, rtl)
  const missing = new Set()
  measureAtoms(atoms, missing)

  // Greedy fill. A segment is the atoms between two break opportunities and moves as a unit. Every row knows whether it
  // starts a paragraph (a first-line indent) or continues one (the hanging indent of a bullet), and whether it ends one.
  const rows = [], meta = []
  let onLine = []   // the segments of the current line: { atoms, width }
  let curW = 0
  let rowFirst = true, paraPending = true, firstIndent = indent, hang = 0
  const room = () => boxW - (rowFirst ? firstIndent : hang)
  // A hyphen drawn in the face and size of the soft hyphen it stands for
  const hyphenFor = atom => {
    const face = atom.span.chain.find(f => f.has(0x2d)) ?? atom.face
    const glyphs = shapeCached(face, '-', atom.level % 2 === 1, []).map(g => ({ ...g, cluster: 0 }))
    const width = advance(glyphs, atom.span.size / face.upem, letterSpace(atom.span))
    return { start: atom.end, end: atom.end, text: '-', span: atom.span, level: atom.level, face, glyphs, width, space: false, newline: false, hyphen: true }
  }
  const endsAtSoftHyphen = seg => { const last = seg.atoms[seg.atoms.length - 1]; return last && !last.space && last.text.endsWith('\u00AD') ? last : null }
  // End the line. `broke`: it ends because the next word does not fit, so a soft hyphen at its end shows as a hyphen;
  // when that does not fit, the last piece moves down to the next line. `forced`: it ends its paragraph (a newline or the end).
  const flush = (broke, forced = false) => {
    const carry = []
    if (broke) {
      for (;;) {
        const last = onLine[onLine.length - 1]
        const shy = last && endsAtSoftHyphen(last)
        if (!shy) break
        const h = hyphenFor(shy)
        if (curW + h.width <= room() + 1e-6 || onLine.length === 1) { last.atoms.push(h); curW += h.width; break }
        onLine.pop(); curW -= last.width; carry.unshift(last)
      }
    }
    rows.push(onLine.flatMap(sg => sg.atoms))
    meta.push({ first: rowFirst, indent: rowFirst ? firstIndent : hang, forced })
    onLine = carry; curW = carry.reduce((w, sg) => w + sg.width, 0)
    rowFirst = forced; if (forced) paraPending = true
  }
  for (let i = 0; i < atoms.length;) {
    let j = i
    while (j < atoms.length - 1 && !atoms[j].breakAfter) j++
    const seg = atoms.slice(i, j + 1)
    if (paraPending && !onLine.length) { // a new paragraph: a bullet hangs, anything else may have a first-line indent
      paraPending = false
      firstIndent = seg[0].marker ? 0 : indent
      hang = seg[0].marker ? seg[0].width : 0
    }
    const vis = seg.filter(a => !a.space).reduce((w, a) => w + a.width, 0)
    while (onLine.length && curW + vis > room() + 1e-6) flush(true)
    if (vis > room() + 1e-6) {
      // Too wide even for an empty line: break by characters
      for (const p of breakByCharacters(seg, boxW - hang, room() - curW)) {
        if (p.wrap) { if (onLine.length) flush(false); continue }
        onLine.push({ atoms: [p], width: p.width }); curW += p.width
      }
    } else {
      const width = seg.reduce((w, a) => w + a.width, 0)
      onLine.push({ atoms: seg, width }); curW += width
    }
    if (seg.some(a => a.mustBreak)) flush(false, true)
    i = j + 1
  }
  if (onLine.length) flush(false, true)

  // Per line: its size, then visual order (UAX #9 rule L2), alignment and placement
  let top = 0, lastBlank = false
  const lines = []
  for (const [ri, row] of rows.entries()) {
    const size = Math.max(...row.map(a => a.span.size), 0)
    const start = row[0].start
    while (row.length && (row[row.length - 1].space || row[row.length - 1].newline)) row.pop()
    const end = row.length ? row[row.length - 1].end : start
    // With paragraph spacing, a blank line is not a line but the gap between two paragraphs (PRD §16.6)
    if (paragraphSpacing > 0 && !row.length) { if (!lastBlank) top += paragraphSpacing * size; lastBlank = true; continue }
    lastBlank = false

    const lv = row.map(a => a.level), maxLevel = Math.max(0, ...lv)
    const odd = lv.filter(l => l % 2 === 1), minOdd = odd.length ? Math.min(...odd) : 99
    for (let lvl = maxLevel; lvl >= minOdd && lvl >= 1; lvl--) {
      for (let a = 0; a < row.length;) {
        if (row[a].level < lvl) { a++; continue }
        let b = a; while (b < row.length && row[b].level >= lvl) b++
        row.splice(a, b - a, ...row.slice(a, b).reverse()); a = b
      }
    }
    let lineW = row.reduce((w, a) => w + a.width, 0)
    const m = meta[ri]
    const avail = Number.isFinite(boxW) ? boxW - m.indent : Infinity
    let free = Number.isFinite(avail) ? avail - lineW : 0
    // Justified: the spare room goes into the spaces between words, except on the last line of a paragraph (PRD §16.6)
    if (align === 'justify' && !m.forced && free > 1e-6) {
      const gaps = row.filter(a => a.space)
      if (gaps.length) { const extra = free / gaps.length; for (const a of gaps) a.width += extra; lineW += free; free = 0 }
    }
    const x0 = m.indent + (align === 'center' ? free / 2 : align === 'right' ? free : 0)

    const items = []
    const placed = []
    let x = 0
    for (const a of row) {
      if (a.span.icon) items.push({ kind: 'icon', name: a.span.icon, x: x + a.pad, size: a.iconSize, width: a.iconW, vOffset: (a.span.vOffset ?? 0) * a.span.size, fill: a.span.fill })
      else if (!a.space && a.glyphs.length) {
        const k = a.span.size / a.face.upem, ls = letterSpace(a.span)
        let gx = 0
        const glyphs = a.glyphs.map(g => { const p = { gid: g.gid, x: gx + g.dx * k, y: g.dy * k }; gx += g.ax * k + ls; return p })
        items.push({ kind: 'glyphs', face: a.face, size: a.span.size, k, fill: a.span.fill, x, glyphs, synthBold: !!a.span.synthBold, synthItalic: !!a.span.synthItalic, outline: a.span.outline, shadow: a.span.shadow })
      }
      placed.push({ span: a.span, x0: x, x1: x + a.width })
      x += a.width
    }
    // Underline and strikethrough run on across the spaces between words of the same style
    for (const type of ['underline', 'strike']) {
      let cur = null
      const end = () => { if (cur) items.push({ kind: 'rule', type, x: cur.x0, width: cur.x1 - cur.x0, size: cur.size, fill: cur.fill }); cur = null }
      for (const p of placed) {
        if (!p.span[type]) { end(); continue }
        if (cur && cur.fill === p.span.fill && cur.size === p.span.size) cur.x1 = p.x1
        else { end(); cur = { x0: p.x0, x1: p.x1, fill: p.span.fill, size: p.span.size } }
      }
      end()
    }
    const step = lineExact ?? size * lineHeight
    lines.push({ start, end, x: x0, top, baseline: top + size * ASCENT, size, step, width: lineW, items })
    top += step
  }
  return { text, lines, height: top, width: Math.max(0, ...lines.map(l => l.width)), missing: [...missing] }
}

// ---------------------------------------------------------------------------
// Fit modes (PRD §7.4)
// ---------------------------------------------------------------------------

/** The spans covering characters [from, to) of the paragraph text. */
export function sliceSpans(spans, from, to) {
  const out = []
  let pos = 0
  for (const s of spans) {
    const len = s.icon ? 1 : s.text.length
    const a = Math.max(from, pos), b = Math.min(to, pos + len)
    if (b > a) out.push(s.icon ? s : { ...s, text: s.text.slice(a - pos, b - pos) })
    pos += len
  }
  return out
}

const graphemes = text => { const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' }); const out = []; let i = 0; for (const { segment } of seg.segment(text)) { out.push(i); i += segment.length } return out }

/** How many lines of this paragraph fit a box of this height at its own sizes (always at least one). */
const lineCapacity = (layout, boxHeight, maxLines) => {
  let n = 0, used = 0
  for (const l of layout.lines) {
    const step = l.step ?? l.size * (layout.lineHeight ?? 1.2)
    if (Number.isFinite(boxHeight) && used + step > boxHeight + 1e-6 && n > 0) break
    if (maxLines != null && n >= maxLines) break
    used += step; n++
  }
  return Math.max(1, n)
}

const words = (layout, line) => layout.text.slice(line.start, line.end).trim().split(/\s+/).filter(Boolean).length

/**
 * Narrow the paragraph's measure without adding a line (PRD §16.6): "balance lines" evens the lines out by finding the
 * narrowest width that gives the same number of lines; "avoid single-word last lines" looks for a slightly narrower width
 * with a last line of at least two words. The block is placed in the box as its alignment says.
 */
function refine(spans, layout, base, o) {
  const { balance, avoidOrphans } = o
  const full = base.width
  if (!(balance || avoidOrphans) || !Number.isFinite(full) || layout.lines.length < 2) return layout
  const count = layout.lines.length
  let width = full, best = layout
  if (avoidOrphans && words(layout, layout.lines[count - 1]) === 1) {
    for (let k = 1; k <= 30; k++) {
      const w = full * (1 - k * 0.01)
      const l = layoutParagraph(spans, { ...base, width: w })
      if (l.lines.length > count) break
      if (l.lines.length === count && words(l, l.lines[count - 1]) >= 2) { best = l; width = w; break }
    }
  }
  if (balance) {
    // The narrowest measure that still gives the same number of lines: below it a line is added. Lines get shorter as the
    // text is redistributed, so the search starts from nothing, not from the longest line there is now.
    let lo = 0, hi = width
    if (lo < hi) {
      let found = null
      for (let i = 0; i < 14 && hi - lo > 0.25; i++) {
        const mid = (lo + hi) / 2
        const l = layoutParagraph(spans, { ...base, width: mid })
        if (l.lines.length <= count) { found = { l, w: mid }; hi = mid } else lo = mid
      }
      if (found) { best = found.l; width = found.w }
    }
  }
  if (best === layout) return layout
  const shift = base.align === 'center' ? (full - width) / 2 : base.align === 'right' ? full - width : 0
  if (shift) for (const l of best.lines) l.x += shift
  return best
}

/**
 * Lay out text inside a box according to a fit mode.
 * @param {(size: number, tracking?: number) => object[]} makeSpans spans for a nominal font size (other sizes in the text
 *   scale with it) and an extra letter spacing in em (negative to tighten)
 * @param {{ width?: number, height?: number, fit?: string, align?: string, rtl?: boolean, lineHeight?: number, lineExact?: number,
 *           paragraphSpacing?: number, indent?: number, size: number, maxSize?: number, minSize?: number, step?: number,
 *           tighten?: number, maxLines?: number, balance?: boolean, avoidOrphans?: boolean }} o
 *   shrink starts at maxSize and goes down by `step` (default 1) to minSize, tightening the letter spacing down to `tighten`
 *   em (for example 0.03) at each size before it gives up a size; the other modes use `size`. `maxLines` is a limit on
 *   the number of lines, alone or with the box height.
 * @returns the layout plus { size, tracking, overflowText, truncated, fits }
 *   fits is false when shrink reached its minimum and the text still does not fit
 */
export function layoutFit(makeSpans, o) {
  const { width, height, fit = 'wrap', lineHeight = 1.2, lineExact = null, paragraphSpacing = 0, indent = 0, align, rtl, size, maxLines = null } = o
  const base = { width, align, rtl, lineHeight, lineExact, paragraphSpacing, indent }
  const heightLimit = height ?? Infinity
  const fitsBox = l => l.height <= heightLimit + 1e-6 && (maxLines == null || l.lines.length <= maxLines)
  const tag = (layout, extra = {}) => ({ ...layout, lineHeight, size, tracking: 0, overflowText: '', truncated: false, fits: fitsBox(layout), ...extra })
  const settle = (spans, layout) => refine(spans, layout, base, o)

  if (fit === 'shrink') {
    const { maxSize = size, minSize = 1, step = 1, tighten = 0 } = o
    const trackings = [0]
    for (let t = 0.005; t <= tighten + 1e-9; t += 0.005) trackings.push(Math.round(t * 1000) / 1000)
    let nominal = maxSize, layout, used = 0
    const limited = Number.isFinite(heightLimit) || maxLines != null
    for (;;) {
      for (const t of trackings) {
        used = t
        layout = layoutParagraph(makeSpans(nominal, -t), base)
        if (!limited || fitsBox(layout)) return tag(settle(makeSpans(nominal, -t), layout), { size: nominal, tracking: t ? -t : 0 })
      }
      if (nominal - step < minSize - 1e-9) break
      nominal = Math.round((nominal - step) * 1e6) / 1e6
    }
    return tag(settle(makeSpans(nominal, -used), layout), { size: nominal, tracking: used ? -used : 0 })
  }

  const spans = makeSpans(size, 0)
  const layout = layoutParagraph(spans, base)
  if (fit === 'overflow' || fit === 'truncate') {
    const cap = lineCapacity({ ...layout, lineHeight }, heightLimit, maxLines)
    if (layout.lines.length > cap) {
      if (fit === 'overflow') {
        const rest = layout.text.slice(layout.lines[cap].start).replace(/\s*\n\s*/g, ' ').trim()
        const last = layout.lines[cap - 1]
        return tag({ ...layout, lines: layout.lines.slice(0, cap), height: last.top + last.step }, { overflowText: rest, fits: true })
      }
      return truncate(spans, layout, cap, base, tag)
    }
  }
  return tag(settle(spans, layout)) // wrap and clip show everything (clip is applied by the template's clipPath)
}

/** Keep `cap` lines and end the last one with an ellipsis that still fits the box. */
function truncate(spans, layout, cap, base, tag) {
  const from = layout.lines[cap - 1].start
  const last = layout.lines[cap - 1]
  const tailSpans = sliceSpans(spans, from, layout.text.length)
  const tailText = layout.text.slice(from)
  const marks = graphemes(tailText)
  const styleSpan = [...spans].reverse().find(s => !s.icon) ?? spans[0]
  const ellipsis = { ...styleSpan, text: '\u2026', icon: undefined }
  const attempt = n => layoutParagraph([...sliceSpans(tailSpans, 0, marks[n] ?? tailText.length), ellipsis], { ...base, width: base.width, indent: 0 })
  let lo = 0, hi = marks.length, best = attempt(0)
  while (lo <= hi) { // the longest prefix whose last line still holds the ellipsis on a single line
    const mid = (lo + hi) >> 1
    const l = attempt(mid)
    if (l.lines.length <= 1) { best = l; lo = mid + 1 } else hi = mid - 1
  }
  const kept = layout.lines.slice(0, cap - 1)
  const shifted = best.lines.slice(0, 1).map(l => ({ ...l, start: from + l.start, end: from + Math.min(l.end, tailText.length), top: last.top, baseline: last.top + l.size * ASCENT }))
  const lines = [...kept, ...shifted]
  return tag({ ...layout, lines, height: last.top + (shifted[0]?.step ?? last.step), missing: layout.missing }, { truncated: true, fits: true })
}
