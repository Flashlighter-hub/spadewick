/**
 * Shaping and outlines (PRD §16.2): HarfBuzz compiled to WebAssembly (harfbuzzjs), one face per font file.
 *
 * harfbuzzjs is an ES module that starts its WebAssembly with a top-level await, so the CommonJS main process
 * cannot `require` it; it is loaded once with `import()`. Everything after that is synchronous.
 */
import { readFileSync } from 'fs'

let loading = null

/** Load HarfBuzz (once). Resolves to the module; call before opening any face. */
export function loadHarfBuzz() {
  return (loading ??= import('harfbuzzjs'))
}

// One shaping buffer, reused: harfbuzzjs frees a buffer only when the JavaScript garbage collector gets to it, and that
// collector cannot see WebAssembly memory growing, so a buffer per call could run the module out of memory in a long export.
let buffer = null

const faces = new Map() // file path -> face (font files are never changed in place: project fonts get a fresh name)

/**
 * A shaped, drawable face of one font file.
 *   shape(text, rtl, features) -> [{ gid, ax, dx, dy, cluster }] in visual order, font units;
 *     cluster = UTF-16 index in `text` of the first character the glyph stands for
 *   commands(gid) -> [[type, ...numbers]] outline in font units, y up (M, L, Q, C, Z)
 *   has(codePoint) -> whether the font has a glyph for it
 */
export function openFace(hb, file) {
  let face = faces.get(file)
  if (face) return face
  const blob = new hb.Blob(new Uint8Array(readFileSync(file)))
  const hbFace = new hb.Face(blob, 0)
  const font = new hb.Font(hbFace)
  const upem = hbFace.upem
  font.setScale(upem, upem)
  const ext = font.hExtents()
  const outlines = new Map()
  let features = null
  const featureCache = new Map()
  const parse = f => { let x = featureCache.get(f); if (x === undefined) { x = hb.Feature.fromString(f) ?? null; featureCache.set(f, x) } return x }
  face = {
    file,
    upem,
    ascent: ext.ascender,
    descent: -ext.descender,
    has(cp) { const g = font.nominalGlyph(cp); return g !== undefined && g !== 0 },
    /** Whether the font itself has this OpenType feature (a four-letter tag such as 'smcp'). */
    hasFeature(tag) { features ??= new Set(hbFace.getTableFeatureTags('GSUB')); return features.has(tag) },
    shape(text, rtl = false, features = []) {
      const buf = (buffer ??= new hb.Buffer())
      buf.reset()
      buf.addText(text)
      buf.setDirection(rtl ? hb.Direction.RTL : hb.Direction.LTR)
      buf.guessSegmentProperties() // script and language; the direction is already set, so it is kept
      hb.shape(font, buf, features.map(parse).filter(Boolean))
      const infos = buf.getGlyphInfos(), pos = buf.getGlyphPositions()
      return infos.map((g, i) => ({ gid: g.codepoint, ax: pos[i].xAdvance, dx: pos[i].xOffset, dy: pos[i].yOffset, cluster: g.cluster }))
    },
    commands(gid) {
      let c = outlines.get(gid)
      if (c === undefined) { c = font.glyphToJson(gid).map(s => [s.type, ...s.values]); outlines.set(gid, c) }
      return c
    }
  }
  faces.set(file, face)
  return face
}
