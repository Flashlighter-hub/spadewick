/**
 * The canvas of a template is the card: its view box and its width and height are fixed when the template is made (its card size is chosen
 * then and cannot change). Elements may spill past the canvas, but the canvas itself never grows or shrinks. These read the canvas out of a
 * template's source and say whether an edit changed it. Used by the data service (a save is refused) and by the template editor (its
 * source dialog says so before the save).
 */

const attrOf = (tag, name) => new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`).exec(tag)?.[1]?.trim() ?? null

const plain = v => (v != null && /^\d+(\.\d+)?(px)?$/.test(v) ? parseFloat(v) : null)

/**
 * The root's own view box, width and height, and the view box the canvas really has: the view box, or (a drawing with plain width and height
 * and no view box) 0 0 width height.
 * @returns {{ viewBox: number[4] | null, width: string | null, height: string | null, effective: number[4] | null } | null} null when there is no root element
 */
export function canvasOf(svgSource) {
  const tag = /<svg\b[^>]*>/.exec(String(svgSource ?? ''))?.[0]
  if (!tag) return null
  const vb = attrOf(tag, 'viewBox')?.split(/[\s,]+/).map(Number)
  const viewBox = vb && vb.length === 4 && vb.every(Number.isFinite) ? vb : null
  const width = attrOf(tag, 'width'), height = attrOf(tag, 'height')
  const w = plain(width), h = plain(height)
  return { viewBox, width, height, effective: viewBox ?? (w > 0 && h > 0 ? [0, 0, w, h] : null) }
}

const same = (a, b) => a === b || (a != null && b != null && String(a).replace(/\s+/g, '') === String(b).replace(/\s+/g, ''))

/**
 * Whether `next` changes the canvas `before` had: its view box (or the size a plain width and height give), and its width and height when
 * both have them. A template with no canvas to keep, and a bare fragment, are not judged.
 * @returns {{ w: number, h: number } | null} the locked size (in the template's own units) when the canvas was changed, else null
 */
export function canvasChange(beforeSource, nextSource) {
  const a = canvasOf(beforeSource), b = canvasOf(nextSource)
  if (!a?.effective || !b) return null   // no fixed canvas to keep, or not a document (a child saved as a bare fragment takes its parent's)
  const sameBox = !!b.effective && a.effective.every((v, i) => Math.abs(v - b.effective[i]) < 1e-6)
  const sameSize = (a.width == null || b.width == null || same(a.width, b.width)) && (a.height == null || b.height == null || same(a.height, b.height))
  return sameBox && sameSize ? null : { w: a.effective[2], h: a.effective[3] }
}
