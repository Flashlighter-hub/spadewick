/**
 * Elements that lie entirely outside the picture (design tools often leave content beside the artboard) are taken out when
 * they need a layer of their own (opacity, a mask, a filter, a clip or a blend mode): the rasterizer cannot draw such a layer
 * when it is wholly off the canvas and stops the program. Off-canvas elements cannot be seen, so nothing is lost.
 */
import { walk } from './xml.js'
import { elementBox, num } from './geometry.js'
import { ancestorMatrix } from './bind.js'

const SKIP = new Set(['defs', 'clipPath', 'mask', 'pattern', 'symbol', 'linearGradient', 'radialGradient', 'filter', 'style', 'marker'])

const needsLayer = el => {
  const a = el.attrs
  if (num(a.opacity, 1) < 1 || (a.mask && a.mask !== 'none') || (a.filter && a.filter !== 'none') || (a['clip-path'] && a['clip-path'] !== 'none') || (a['mix-blend-mode'] && a['mix-blend-mode'] !== 'normal')) return true
  return !!a.style && /(^|;)\s*(opacity\s*:\s*(0?\.\d+|0)|mask|filter|clip-path|mix-blend-mode)\s*:/i.test(a.style)
}

/** Takes the off-canvas layer elements out of `root` (changed in place); returns how many. */
export function dropOffCanvas(root, viewBox) {
  let n = 0
  const margin = Math.max(viewBox[2], viewBox[3]) * 0.02
  const x0 = viewBox[0] - margin, y0 = viewBox[1] - margin, x1 = viewBox[0] + viewBox[2] + margin, y1 = viewBox[1] + viewBox[3] + margin
  walk(root, (el, anc) => {
    if (el === root) return
    if (SKIP.has(el.tag)) return false
    if (!needsLayer(el)) return
    const b = elementBox(el, ancestorMatrix(anc))
    if (b && (b[2] < x0 || b[0] > x1 || b[3] < y0 || b[1] > y1)) {
      const parent = anc[anc.length - 1]
      parent.children = parent.children.filter(c => c !== el)
      n++
      return false
    }
  })
  return n
}
