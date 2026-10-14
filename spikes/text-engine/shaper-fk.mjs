// Shaper adapter 2: fontkit (pure JavaScript). Same interface as shaper-hb.mjs.
import * as fontkit from 'fontkit'
import { readFileSync } from 'node:fs'

export function createFkFont(file) {
  const font = fontkit.create(readFileSync(file))
  const upem = font.unitsPerEm
  const pathCache = new Map()
  const glyphs = new Map() // gid -> fontkit glyph
  return {
    engine: 'fontkit',
    upem,
    ascent: font.ascent,
    descent: -font.descent,
    has: cp => font.hasGlyphForCodePoint(cp),
    shape(text, rtl = false, features = []) {
      // features: "-liga" switches a feature off, "kern" / "+kern" on
      const f = {}
      for (const s of features) f[s.replace(/^[-+]/, '')] = !s.startsWith('-')
      const run = font.layout(text, f, undefined, undefined, rtl ? 'rtl' : 'ltr')
      // fontkit gives no cluster numbers, so rebuild them from the code points each glyph covers (logical order)
      const n = run.glyphs.length
      const out = new Array(n)
      let offset = 0
      for (let k = 0; k < n; k++) {
        const i = rtl ? n - 1 - k : k // an RTL run comes back in visual order
        const g = run.glyphs[i], p = run.positions[i]
        glyphs.set(g.id, g)
        out[i] = { gid: g.id, ax: p.xAdvance, dx: p.xOffset, dy: p.yOffset, cluster: offset }
        offset += g.codePoints.reduce((s, cp) => s + (cp > 0xffff ? 2 : 1), 0)
      }
      return out
    },
    path(gid) {
      let p = pathCache.get(gid)
      if (p === undefined) { p = glyphs.get(gid)?.path.toSVG() ?? ''; pathCache.set(gid, p) }
      return p
    },
    extents(gid) {
      const b = glyphs.get(gid)?.bbox
      return b && b.maxX > b.minX ? { x0: b.minX, y0: b.minY, x1: b.maxX, y1: b.maxY } : null
    }
  }
}
