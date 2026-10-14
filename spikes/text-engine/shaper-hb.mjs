// Shaper adapter 1: HarfBuzz compiled to WebAssembly (harfbuzzjs).
// Same interface as shaper-fk.mjs so layout.mjs can run on either:
//   shape(text, rtl, features) -> [{ gid, ax, dx, dy, cluster }] in VISUAL order, font units;
//   cluster = UTF-16 index in `text` of the first character the glyph stands for
//   path(gid) -> SVG path (font units, y up) ; extents(gid) -> { x0, y0, x1, y1 } ; has(cp)
import * as hb from 'harfbuzzjs'
import { readFileSync } from 'node:fs'

export function createHbFont(file) {
  const blob = new hb.Blob(new Uint8Array(readFileSync(file)))
  const face = new hb.Face(blob, 0)
  const font = new hb.Font(face)
  const upem = face.upem
  font.setScale(upem, upem)
  const ext = font.hExtents()
  const pathCache = new Map()
  return {
    engine: 'harfbuzzjs',
    upem,
    ascent: ext.ascender,
    descent: -ext.descender,
    has: cp => { const g = font.nominalGlyph(cp); return g !== undefined && g !== 0 },
    shape(text, rtl = false, features = []) {
      const buf = new hb.Buffer()
      buf.addText(text)
      buf.setDirection(rtl ? hb.Direction.RTL : hb.Direction.LTR)
      buf.guessSegmentProperties() // script + language; direction is already set so it is kept
      hb.shape(font, buf, features.map(f => hb.Feature.fromString(f)).filter(Boolean))
      const infos = buf.getGlyphInfos(), pos = buf.getGlyphPositions()
      return infos.map((g, i) => ({ gid: g.codepoint, ax: pos[i].xAdvance, dx: pos[i].xOffset, dy: pos[i].yOffset, cluster: g.cluster }))
    },
    path(gid) {
      let p = pathCache.get(gid)
      if (p === undefined) { p = font.glyphToPath(gid); pathCache.set(gid, p) }
      return p
    },
    extents(gid) {
      const e = font.glyphExtents(gid)
      return e ? { x0: e.xBearing, y1: e.yBearing, x1: e.xBearing + e.width, y0: e.yBearing + e.height } : null
    }
  }
}
