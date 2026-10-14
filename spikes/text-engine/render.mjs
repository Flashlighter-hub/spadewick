// Draw a laid-out paragraph as OUTLINES (glyph shapes), never as <text>.
import { Resvg } from '@resvg/resvg-js'

const r = n => Math.round(n * 1000) / 1000

// Tiny original placeholder icons in a 0..10 box. currentColor = follow the text colour.
export const ICONS = {
  fire:   '<path d="M5 0.5C6 3 9 4 9 7a4 4 0 0 1-8 0C1 5 3 4.5 3.5 2.5 4 3.5 4.5 3 5 0.5z" fill="currentColor"/>',
  star:   '<path d="M5 0.5l1.4 3.2 3.4.3-2.6 2.2.8 3.4L5 7.9 2 9.6l.8-3.4L.2 4l3.4-.3z" fill="currentColor"/>',
  shield: '<path d="M5 .5L9 2v3.5C9 7.8 7 9.2 5 9.8 3 9.2 1 7.8 1 5.5V2z" fill="currentColor"/>',
  tap:    '<circle cx="5" cy="5" r="4" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M3 5.2l1.6 1.6L7.2 3.4" fill="none" stroke="currentColor" stroke-width="1.2"/>'
}

/** SVG fragments for one paragraph placed at (ox, oy). Glyph shapes are shared through `defs`. */
export function paragraphToSvg(para, fonts, ox, oy, defs) {
  let body = ''
  for (const line of para.lines) {
    for (const it of line.items) {
      if (it.kind === 'icon') {
        body += `<g transform="translate(${r(ox + it.x)} ${r(oy + it.y)}) scale(${r(it.w / 10)})" color="${it.color}">${ICONS[it.name] ?? ''}</g>`
        continue
      }
      const sh = fonts[it.font]
      let uses = ''
      for (const g of it.glyphs) {
        const id = `${it.font}-${g.gid}`
        if (!defs.has(id)) { const d = sh.path(g.gid); defs.set(id, d ? `<path id="${id}" d="${d}"/>` : '') }
        if (defs.get(id)) uses += `<use href="#${id}" x="${r(g.x)}" y="${r(-g.y)}"/>`
      }
      body += `<g transform="translate(${r(ox + line.x + it.x)} ${r(oy + line.baseline)}) scale(${r(it.k)} ${r(-it.k)})" fill="${it.color}">${uses}</g>`
    }
  }
  return body
}

export function svgDoc(w, h, defs, body, bg = '#ffffff') {
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<rect width="${w}" height="${h}" fill="${bg}"/><defs>${[...defs.values()].join('')}</defs>${body}</svg>`
}

export function rasterize(svg, fontFiles, width) {
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: width }, font: { loadSystemFonts: false, fontFiles } })
  const img = resvg.render()
  return { png: img.asPng(), pixels: img.pixels, width: img.width, height: img.height }
}

/** Bounding box of the pixels that are not (nearly) white. */
export function inkBox(img, threshold = 128) {
  const { pixels, width, height } = img
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4
    if (pixels[i] < threshold || pixels[i + 1] < threshold || pixels[i + 2] < threshold) {
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 }
}

/** Fraction of pixels (out of those inked in either picture) that differ noticeably. */
export function diffRatio(a, b, threshold = 96) {
  if (a.width !== b.width || a.height !== b.height) return 1
  let ink = 0, diff = 0
  for (let i = 0; i < a.pixels.length; i += 4) {
    const da = 255 - a.pixels[i], db = 255 - b.pixels[i]
    if (da > 32 || db > 32) { ink++; if (Math.abs(da - db) > threshold) diff++ }
  }
  return ink ? diff / ink : 0
}
