// Layout core for spike A. One description of laid-out text (lines -> placed glyph runs and icon boxes)
// from which the picture is drawn, so measuring and drawing cannot disagree (PRD §16.2).
//
//   spans:  [{ text, font, size, color, features? } | { icon, size, scale?, color }]
//   fonts:  { id: shaper }            (shaper = createHbFont / createFkFont result)
//   chain:  [fontId, ...]             fallback order tried per character when a font lacks the glyph
import bidiFactory from 'bidi-js'
import LineBreaker from 'linebreak'

const bidi = bidiFactory()
const ICON = '' // private-use stand-in: behaves like a letter, so an icon never splits from its neighbours
const isSpace = ch => /\s/u.test(ch)

/** Shape cache: the same text in the same font/direction is shaped once (a re-render after an edit reuses most of it). */
export function createShapeCache() { return new Map() }

function shapeCached(cache, fontId, shaper, text, rtl, features) {
  const key = `${fontId}|${rtl ? 1 : 0}|${features.join(',')}|${text}`
  let hit = cache?.get(key)
  if (!hit) { hit = shaper.shape(text, rtl, features); cache?.set(key, hit) }
  return hit
}

/** Break the paragraph into atoms: a run of one span, one font, one bidi level, either a word or spaces. */
function itemize(spans, fonts, chain, rtlPara) {
  let text = ''
  const owner = [] // UTF-16 index -> span index
  spans.forEach((s, i) => { const t = s.icon ? ICON : s.text; for (let k = 0; k < t.length; k++) owner.push(i); text += t })
  const levels = bidi.getEmbeddingLevels(text, rtlPara ? 'rtl' : 'ltr').levels

  const breaks = new Set([0, text.length])
  const forced = new Set()
  const lb = new LineBreaker(text)
  for (let b; (b = lb.nextBreak());) { breaks.add(b.position); if (b.required) forced.add(b.position) }

  // Which font draws each character: the span's own, else the first fallback that has the glyph
  const fontOf = new Array(text.length)
  for (let i = 0; i < text.length;) {
    const cp = text.codePointAt(i), n = cp > 0xffff ? 2 : 1
    const s = spans[owner[i]]
    let f = null
    if (!s.icon) {
      const order = [s.font, ...chain.filter(c => c !== s.font)]
      f = isSpace(text[i])
        ? (i > 0 && owner[i - 1] === owner[i] && fontOf[i - 1] ? fontOf[i - 1] : s.font) // spaces stay in the surrounding run's font
        : order.find(id => fonts[id].has(cp)) ?? s.font
    }
    for (let k = 0; k < n; k++) fontOf[i + k] = f
    i += n
  }

  // Split points: break opportunities, and every change of span, bidi level, font or space/non-space
  const cuts = new Set(breaks)
  for (let i = 1; i < text.length; i++) {
    if (owner[i] !== owner[i - 1] || levels[i] !== levels[i - 1] || fontOf[i] !== fontOf[i - 1] || isSpace(text[i]) !== isSpace(text[i - 1])) cuts.add(i)
  }
  const pos = [...cuts].sort((a, b) => a - b)
  const atoms = []
  for (let k = 0; k + 1 < pos.length; k++) {
    const a = pos[k], b = pos[k + 1]
    if (a === b) continue
    const span = spans[owner[a]]
    atoms.push({
      start: a, end: b, text: text.slice(a, b), span, level: levels[a],
      font: fontOf[a], space: !span.icon && isSpace(text[a]),
      breakAfter: breaks.has(b) && b !== text.length, mustBreak: forced.has(b),
      newline: text[b - 1] === '\n'
    })
  }
  return atoms
}

/**
 * Shape whole RUNS (same span, font and direction), not words, so kerning across spaces and between words is kept;
 * then hand each glyph to the atom (word or spaces) its cluster belongs to. This is what makes measured = drawn.
 */
function measureAtoms(atoms, fonts, cache) {
  const missing = []
  for (let i = 0; i < atoms.length;) {
    const a = atoms[i]
    if (a.span.icon) {
      a.iconSize = (a.span.scale ?? 1) * a.span.size
      a.width = a.iconSize; a.glyphs = null; i++
      continue
    }
    if (a.newline) { a.glyphs = []; a.width = 0; i++; continue }
    let j = i + 1
    while (j < atoms.length && !atoms[j].newline && !atoms[j].span.icon && atoms[j].span === a.span && atoms[j].font === a.font && atoms[j].level === a.level) j++
    const run = atoms.slice(i, j)
    const sh = fonts[a.font], k = a.span.size / sh.upem
    const rtl = a.level % 2 === 1
    const base = run[0].start
    const glyphs = shapeCached(cache, a.font, sh, run.map(x => x.text).join(''), rtl, a.span.features ?? [])
    for (const x of run) x.glyphs = []
    for (const g of glyphs) {
      let t = run.length - 1
      while (t > 0 && run[t].start - base > g.cluster) t--
      run[t].glyphs.push(g)
      if (g.gid === 0) missing.push(run[t].text)
    }
    for (const x of run) x.width = x.glyphs.reduce((w, g) => w + g.ax, 0) * k
    i = j
  }
  return missing
}

/**
 * Lay a paragraph out in a box of the given width.
 * @returns {{ lines, height, width, missing }} lines: [{ x, baseline, width, items }]
 */
export function layoutParagraph(spans, fonts, opts) {
  const { width: boxW = Infinity, align = 'start', rtl = false, lineHeight = 1.2, chain = [], cache } = opts
  const atoms = itemize(spans, fonts, chain, rtl)
  const missing = measureAtoms(atoms, fonts, cache)

  // Greedy fill. A segment = the atoms between two break opportunities; it moves as a unit.
  const lines = []
  let cur = [], curW = 0
  const flush = () => { lines.push(cur); cur = []; curW = 0 }
  for (let i = 0; i < atoms.length;) {
    let j = i
    while (j < atoms.length - 1 && !atoms[j].breakAfter) j++
    const seg = atoms.slice(i, j + 1)
    const full = seg.reduce((w, a) => w + a.width, 0)
    const vis = seg.filter(a => !a.space).reduce((w, a) => w + a.width, 0)
    if (cur.length && curW + vis > boxW + 1e-6) flush()
    cur.push(...seg); curW += full
    if (seg.some(a => a.mustBreak)) flush()
    i = j + 1
  }
  if (cur.length || !lines.length) flush()

  // Per line: drop trailing spaces, reorder visually (UAX #9 rule L2), align, place
  let y = 0
  const out = []
  for (const line of lines) {
    while (line.length && (line[line.length - 1].space || line[line.length - 1].newline)) line.pop()
    const levelsHere = line.map(a => a.level)
    const maxLevel = Math.max(0, ...levelsHere)
    const odd = levelsHere.filter(l => l % 2 === 1)
    const minOdd = odd.length ? Math.min(...odd) : 99
    for (let lvl = maxLevel; lvl >= minOdd && lvl >= 1; lvl--) {
      for (let a = 0; a < line.length;) {
        if (line[a].level < lvl) { a++; continue }
        let b = a; while (b < line.length && line[b].level >= lvl) b++
        const rev = line.slice(a, b).reverse(); line.splice(a, b - a, ...rev); a = b
      }
    }
    const lineW = line.reduce((w, a) => w + a.width, 0)
    const free = Number.isFinite(boxW) ? boxW - lineW : 0
    const toRight = align === 'right' || (align === 'start' && rtl)
    const x0 = align === 'center' ? free / 2 : toRight ? free : 0

    let asc = 0, desc = 0, size = 0
    for (const a of line) {
      size = Math.max(size, a.span.size)
      if (a.span.icon) { asc = Math.max(asc, a.iconSize * 0.85); desc = Math.max(desc, a.iconSize * 0.15) }
      else { const sh = fonts[a.font], k = a.span.size / sh.upem; asc = Math.max(asc, sh.ascent * k); desc = Math.max(desc, sh.descent * k) }
    }
    const step = Math.max(size * lineHeight, asc + desc)
    const baseline = y + (step - (asc + desc)) / 2 + asc
    let x = 0 // item positions are relative to the line start; line.x holds the alignment offset
    const items = []
    for (const a of line) {
      if (a.span.icon) items.push({ kind: 'icon', name: a.span.icon, x, y: baseline - a.iconSize * 0.85, w: a.iconSize, h: a.iconSize, color: a.span.color })
      else if (!a.space) {
        const sh = fonts[a.font], k = a.span.size / sh.upem
        let gx = 0
        const glyphs = a.glyphs.map(g => { const p = { gid: g.gid, x: gx + g.dx, y: g.dy }; gx += g.ax; return p })
        items.push({ kind: 'glyphs', font: a.font, size: a.span.size, k, color: a.span.color, x, glyphs, text: a.text })
      }
      x += a.width
    }
    out.push({ x: x0, baseline, width: lineW, items })
    y += step
  }
  return { lines: out, height: y, width: Math.max(0, ...out.map(l => l.width)), missing }
}

/** Shrink-to-fit (PRD §7.4 "shrink") on the engine: spans keep their size ratios, icons scale with the text. */
export function fitParagraph(spans, fonts, opts, { boxHeight, max, min, step = 0.5 }) {
  let size = max, res
  for (; size >= min - 1e-9; size -= step) {
    const f = size / max
    res = layoutParagraph(spans.map(s => ({ ...s, size: s.size * f })), fonts, opts)
    if (res.height <= boxHeight + 1e-6) return { ...res, size, fits: true }
  }
  return { ...res, size: size + step, fits: false }
}
