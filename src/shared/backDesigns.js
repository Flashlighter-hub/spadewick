/**
 * Card back designs (PRD §7.8): a few plain starting points for a back of any card size. Each is a complete template (no field, nothing
 * from outside), with an image layer called `emblem` where a logo or picture can be put, and trim and safe guides that never reach an
 * export. A back is edited like any other template.
 */
import { guides } from './starterGuides.js'

export const BACK_DESIGNS = ['classic', 'plain', 'glow']
export const BACK_WIDTH = 500
const DEFAULT_PRIMARY = '#1b1b3a'
const DEFAULT_ACCENT = '#e8c15a'
const hex = v => (/^#[0-9a-f]{6}$/i.test(String(v)) ? String(v) : null)

/** The colour a share of the way from `a` toward `b` (0 = a, 1 = b). */
function mix(a, b, t) {
  const n = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
  const [x, y] = [n(a), n(b)]
  return `#${x.map((c, i) => Math.round(c + (y[i] - c) * t).toString(16).padStart(2, '0')).join('')}`
}

/**
 * @param {{ mmW: number, mmH: number }} size the card's size in millimetres
 * @param {{ design?: string, primary?: string, accent?: string }} [opts]
 * @returns {string} the SVG source, 500 template units across
 */
export function backSvg(size, opts = {}) {
  const w = BACK_WIDTH, h = Math.round(BACK_WIDTH * size.mmH / size.mmW)
  const design = BACK_DESIGNS.includes(opts.design) ? opts.design : 'classic'
  const primary = hex(opts.primary) ?? DEFAULT_PRIMARY, accent = hex(opts.accent) ?? DEFAULT_ACCENT
  const cx = w / 2, cy = h / 2
  const r = Math.round(Math.min(w, h) * 0.2)
  const head = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`
  const emblem = `  <image data-spadewick-id="emblem" x="${cx - r * 0.8}" y="${cy - r * 0.8}" width="${r * 1.6}" height="${r * 1.6}" href="" preserveAspectRatio="xMidYMid meet"/>`
  const g = guides(w, h, size.mmW)

  if (design === 'plain') {
    return `${head}
  <rect width="${w}" height="${h}" rx="22" fill="${primary}"/>
  <rect x="20" y="20" width="${w - 40}" height="${h - 40}" rx="12" fill="none" stroke="${accent}" stroke-width="4"/>
  <rect x="32" y="32" width="${w - 64}" height="${h - 64}" rx="6" fill="none" stroke="${accent}" stroke-width="1.5" stroke-opacity="0.7"/>
${emblem}
${g}
</svg>`
  }

  if (design === 'glow') {
    const dark = mix(primary, '#000000', 0.45)
    return `${head}
  <defs>
    <radialGradient id="back_glow" cx="50%" cy="50%" r="70%"><stop offset="0%" stop-color="${primary}"/><stop offset="100%" stop-color="${dark}"/></radialGradient>
  </defs>
  <rect width="${w}" height="${h}" rx="22" fill="url(#back_glow)"/>
  <circle cx="${cx}" cy="${cy}" r="${r * 2.1}" fill="none" stroke="${accent}" stroke-opacity="0.18" stroke-width="2"/>
  <circle cx="${cx}" cy="${cy}" r="${r * 1.6}" fill="none" stroke="${accent}" stroke-opacity="0.3" stroke-width="2"/>
  <circle cx="${cx}" cy="${cy}" r="${r * 1.2}" fill="${accent}" fill-opacity="0.12" stroke="${accent}" stroke-width="3"/>
${emblem}
  <rect x="18" y="18" width="${w - 36}" height="${h - 36}" rx="12" fill="none" stroke="${accent}" stroke-opacity="0.6" stroke-width="2"/>
${g}
</svg>`
  }

  // classic: a border, a lattice, and a round emblem in the middle
  return `${head}
  <defs>
    <pattern id="back_lattice" width="36" height="36" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <path d="M0 0H36M0 0V36" stroke="${accent}" stroke-opacity="0.28" stroke-width="2" fill="none"/>
    </pattern>
  </defs>
  <rect width="${w}" height="${h}" rx="22" fill="${primary}"/>
  <rect x="34" y="34" width="${w - 68}" height="${h - 68}" rx="8" fill="url(#back_lattice)"/>
  <rect x="18" y="18" width="${w - 36}" height="${h - 36}" rx="12" fill="none" stroke="${accent}" stroke-width="4"/>
  <rect x="34" y="34" width="${w - 68}" height="${h - 68}" rx="8" fill="none" stroke="${accent}" stroke-width="1.5"/>
  <circle cx="${cx}" cy="${cy}" r="${r + 14}" fill="${primary}" stroke="${accent}" stroke-width="4"/>
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="${accent}" fill-opacity="0.18" stroke="${accent}" stroke-width="2"/>
${emblem}
${g}
</svg>`
}
