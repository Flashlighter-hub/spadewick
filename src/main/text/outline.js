/**
 * Drawing laid-out text as outlines (PRD §16.2): the glyph shapes of the fonts themselves become SVG path data,
 * so the rasterizer never shapes the text again and what was measured is exactly what is drawn.
 */
import { starterIcon, PLACEHOLDER_ICON } from '../../shared/starterIcons.js'

const r2 = n => Math.round(n * 100) / 100

export const ITALIC_SLANT = Math.tan(12 * Math.PI / 180) // the slant of synthesized italic
const BOLD_SMEAR = 0.03                                    // synthesized bold: a second copy this many em to the right

/** Path data for outline commands in a box of scale k at (x, y) (the baseline point), y flipped to point down; `slant` shears them. */
function commandsToPath(commands, x, y, k, slant = 0) {
  let d = ''
  for (const [type, ...v] of commands) {
    if (type === 'Z') { d += 'Z'; continue }
    d += type
    for (let i = 0; i < v.length; i += 2) d += `${i ? ' ' : ''}${r2(x + v[i] * k + v[i + 1] * k * slant)} ${r2(y - v[i + 1] * k)}`
  }
  return d
}

/** Path data for shapes in a 0..100 box, scaled to a box of this width and height at (left, top), y already pointing down. */
function boxPath(commands, left, top, w, h) {
  let d = ''
  for (const [type, ...v] of commands) {
    if (type === 'Z') { d += 'Z'; continue }
    d += type
    for (let i = 0; i < v.length; i += 2) d += `${i ? ' ' : ''}${r2(left + v[i] * w / 100)} ${r2(top + v[i + 1] * h / 100)}`
  }
  return d
}

const rect = (x, y, w, h) => `M${r2(x)} ${r2(y)}L${r2(x + w)} ${r2(y)}L${r2(x + w)} ${r2(y + h)}L${r2(x)} ${r2(y + h)}Z`
const attr = v => String(v).replace(/"/g, '&quot;')

/** Colours that reach the picture only as hex, so nothing else can be written into an attribute. */
const safeColor = c => (typeof c === 'string' && /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(c) ? c : null)

/**
 * SVG elements that draw a laid-out paragraph: one <path> per distinct fill (all glyphs, rules and icons of that fill in
 * one shape), with the shadows of styled text first, then its outlines, then the text; pictures of icons last.
 * @param {{ lines: object[] }} layout from layoutParagraph / layoutFit
 * @param {number} ox x of the line origin (line.x, the alignment offset, is added to it)
 * @param {number} oy y of the paragraph's top; each line's baseline is `line.baseline` below it
 * @param {{ resolveIcon?: (name: string) => object | null, onMissingIcon?: (name: string) => void }} [options]
 *   resolveIcon gives an icon (see library.js), or its outline commands in a 0..100 box, or null; the default is the starter set
 */
export function layoutToSvg(layout, ox, oy, options = {}) {
  const resolveIcon = options.resolveIcon ?? starterIcon
  const fills = new Map(), outlines = new Map(), shadows = new Map()
  const add = (map, key, d) => { if (d) map.set(key, (map.get(key) ?? '') + d) }
  let pictures = ''
  for (const line of layout.lines) {
    const baseline = oy + line.baseline
    for (const item of line.items) {
      const x0 = ox + line.x + item.x
      if (item.kind === 'glyphs') {
        const slant = item.synthItalic ? ITALIC_SLANT : 0
        const smear = item.synthBold ? item.size * BOLD_SMEAR : 0
        const shape = (dx = 0, dy = 0) => {
          let d = ''
          for (const g of item.glyphs) {
            const cmds = item.face.commands(g.gid)
            if (!cmds.length) continue
            d += commandsToPath(cmds, x0 + g.x + dx, baseline - g.y + dy, item.k, slant)
            if (smear) d += commandsToPath(cmds, x0 + g.x + dx + smear, baseline - g.y + dy, item.k, slant)
          }
          return d
        }
        add(fills, item.fill ?? '', shape())
        const sh = item.shadow && safeColor(item.shadow.color)
        if (sh) add(shadows, sh, shape(item.shadow.dx, item.shadow.dy))
        const ol = item.outline && item.outline.width > 0 && safeColor(item.outline.color)
        if (ol) add(outlines, `${ol}|${r2(item.outline.width)}`, shape())
      } else if (item.kind === 'rule') {
        const t = Math.max(0.5, item.size * 0.06)
        const y = item.type === 'underline' ? baseline + item.size * 0.12 : baseline - item.size * 0.3 - t / 2
        add(fills, item.fill ?? '', rect(x0, y, item.width, t))
      } else if (item.kind === 'icon') {
        const found = resolveIcon(item.name)
        const entry = Array.isArray(found) ? { kind: 'commands', commands: found } : found
        const top = baseline - item.size * 0.85 - (item.vOffset ?? 0)
        if (!entry) {
          options.onMissingIcon?.(item.name)
          add(fills, item.fill ?? '', boxPath(PLACEHOLDER_ICON, x0, top, item.width ?? item.size, item.size))
        } else if (entry.kind === 'commands') {
          add(fills, item.fill ?? '', boxPath(entry.commands, x0, top, item.width ?? item.size, item.size))
        } else if (entry.kind === 'svg') {
          const w = item.width ?? item.size
          const own = entry.follow ? safeColor(item.fill) ?? '#000000' : safeColor(entry.parts.ownColor)
          pictures += `<svg x="${r2(x0)}" y="${r2(top)}" width="${r2(w)}" height="${r2(item.size)}" viewBox="${entry.parts.viewBox.join(' ')}" preserveAspectRatio="xMidYMid meet"${entry.parts.single ? ` fill="currentColor"${own ? ` color="${own}"` : ''}` : ''}>${entry.parts.inner}</svg>`
        } else if (entry.kind === 'raster') {
          pictures += `<image x="${r2(x0)}" y="${r2(top)}" width="${r2(item.width ?? item.size)}" height="${r2(item.size)}" preserveAspectRatio="xMidYMid meet" href="${attr(entry.href)}"/>`
        }
      }
    }
  }
  let out = ''
  for (const [color, d] of shadows) out += `<path fill="${color}" d="${d}"/>`
  // An outline is the text stroked, drawn first: the text then covers the inner half, so twice the width is stroked
  for (const [key, d] of outlines) { const [color, w] = key.split('|'); out += `<path fill="none" stroke="${color}" stroke-width="${r2(Number(w) * 2)}" stroke-linejoin="round" d="${d}"/>` }
  for (const [fill, d] of fills) if (d) out += `<path${fill ? ` fill="${attr(fill)}"` : ''} d="${d}"/>`
  return out + pictures
}
