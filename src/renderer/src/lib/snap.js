/**
 * Edge snapping and alignment guides for the canvas editor (PRD §8.7.4).
 * Pure functions, free of Konva and the DOM, so they can be unit tested.
 *
 * A rectangle is { x, y, w, h } in card (SVG) units. A target is a line the moving rectangle can snap to:
 * { axis: 'x' | 'y', pos, from, to } where `from`..`to` is the extent of the thing the line belongs to
 * along the other axis (used to draw the guide between the two objects).
 */

/** How close (in screen pixels) a line must be to a target before it snaps. */
export const SNAP_PX = 6

const EPS = 0.01

/** The three vertical and three horizontal lines of a rectangle: its edges and centre. */
export function linesOf(r) {
  return { x: [r.x, r.x + r.w / 2, r.x + r.w], y: [r.y, r.y + r.h / 2, r.y + r.h] }
}

/** The snap targets offered by the card itself (its edges and centre lines). */
export function cardTargets(size) {
  const { w, h } = size
  return [
    ...[0, w / 2, w].map(pos => ({ axis: 'x', pos, from: 0, to: h })),
    ...[0, h / 2, h].map(pos => ({ axis: 'y', pos, from: 0, to: w }))
  ]
}

/** The snap targets offered by another element: its three vertical and three horizontal lines. */
export function elementTargets(r) {
  const l = linesOf(r)
  return [
    ...l.x.map(pos => ({ axis: 'x', pos, from: r.y, to: r.y + r.h })),
    ...l.y.map(pos => ({ axis: 'y', pos, from: r.x, to: r.x + r.w }))
  ]
}

/** All targets for a card of `size` and the rectangles of the other (visible) elements. */
export function buildTargets(size, others) {
  return [...cardTargets(size), ...others.flatMap(elementTargets)]
}

/** The closest offset (target − line) within `threshold`, or null. */
function bestOffset(lines, targets, threshold) {
  let best = null
  for (const line of lines) {
    for (const t of targets) {
      const d = t.pos - line
      if (Math.abs(d) <= threshold && (best === null || Math.abs(d) < Math.abs(best))) best = d
    }
  }
  return best
}

/**
 * Snap `rect` to `targets`.
 *
 * @param rect       the rectangle being dragged or resized
 * @param targets    from buildTargets()
 * @param threshold  snap distance in card units (SNAP_PX / zoom)
 * @param edges      omit to move the whole rectangle (edges and centre snap); or
 *                   { left, right, top, bottom } booleans: only those edges snap (resizing)
 * @returns { rect, guides, snappedX, snappedY } — the adjusted rectangle and the lines to draw
 */
export function snapRect(rect, targets, threshold, edges) {
  const xTargets = targets.filter(t => t.axis === 'x')
  const yTargets = targets.filter(t => t.axis === 'y')
  const out = { ...rect }
  let snappedX = false, snappedY = false

  if (!edges) {
    const l = linesOf(rect)
    const dx = bestOffset(l.x, xTargets, threshold)
    const dy = bestOffset(l.y, yTargets, threshold)
    if (dx !== null) { out.x += dx; snappedX = true }
    if (dy !== null) { out.y += dy; snappedY = true }
  } else {
    // Each moving edge snaps on its own. A left or top edge moves the origin and the size together,
    // a right or bottom edge only the size.
    if (edges.left) { const d = bestOffset([rect.x], xTargets, threshold); if (d !== null) { out.x += d; out.w -= d; snappedX = true } }
    if (edges.right) { const d = bestOffset([rect.x + rect.w], xTargets, threshold); if (d !== null) { out.w += d; snappedX = true } }
    if (edges.top) { const d = bestOffset([rect.y], yTargets, threshold); if (d !== null) { out.y += d; out.h -= d; snappedY = true } }
    if (edges.bottom) { const d = bestOffset([rect.y + rect.h], yTargets, threshold); if (d !== null) { out.h += d; snappedY = true } }
  }

  return { rect: out, guides: guidesFor(out, targets, edges), snappedX, snappedY }
}

/**
 * The lines to draw for a rectangle that has been snapped: every one of its relevant lines that now
 * coincides with a target, drawn from the rectangle to the farthest object it lines up with.
 */
export function guidesFor(rect, targets, edges) {
  const l = linesOf(rect)
  const xs = edges ? [edges.left && l.x[0], edges.right && l.x[2]] : l.x
  const ys = edges ? [edges.top && l.y[0], edges.bottom && l.y[2]] : l.y
  const guides = []
  const add = (axis, pos, own0, own1) => {
    const hits = targets.filter(t => t.axis === axis && Math.abs(t.pos - pos) <= EPS)
    if (!hits.length) return
    const from = Math.min(own0, ...hits.map(t => t.from))
    const to = Math.max(own1, ...hits.map(t => t.to))
    if (!guides.some(g => g.axis === axis && Math.abs(g.pos - pos) <= EPS)) guides.push({ axis, pos, from, to })
  }
  for (const pos of xs) if (typeof pos === 'number') add('x', pos, rect.y, rect.y + rect.h)
  for (const pos of ys) if (typeof pos === 'number') add('y', pos, rect.x, rect.x + rect.w)
  return guides
}

/**
 * The gaps between `rect` and the nearest element on each side, for the distance labels shown while an
 * element is dragged (PRD §8.7.4). Only elements that overlap `rect` in the other direction count, so a
 * gap is always a straight line between two facing edges. `equal` marks a left/right or top/bottom pair
 * whose two gaps are the same.
 *
 * @returns Array of { axis: 'x' | 'y', from, to, at, size, equal } — a segment along `axis` from `from` to
 *          `to`, drawn at position `at` on the other axis.
 */
export function gapsFor(rect, others) {
  const out = []
  const overlap = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0)
  const mid = (a0, a1, b0, b1) => (Math.max(a0, b0) + Math.min(a1, b1)) / 2
  const nearest = pick => {
    let best = null
    for (const o of others) { const d = pick(o); if (d !== null && d > EPS && (!best || d < best.d)) best = { d, o } }
    return best
  }
  const r = rect
  const left = nearest(o => (overlap(o.y, o.y + o.h, r.y, r.y + r.h) > 0 && o.x + o.w <= r.x + EPS ? r.x - (o.x + o.w) : null))
  const right = nearest(o => (overlap(o.y, o.y + o.h, r.y, r.y + r.h) > 0 && o.x >= r.x + r.w - EPS ? o.x - (r.x + r.w) : null))
  const above = nearest(o => (overlap(o.x, o.x + o.w, r.x, r.x + r.w) > 0 && o.y + o.h <= r.y + EPS ? r.y - (o.y + o.h) : null))
  const below = nearest(o => (overlap(o.x, o.x + o.w, r.x, r.x + r.w) > 0 && o.y >= r.y + r.h - EPS ? o.y - (r.y + r.h) : null))
  const equalX = !!(left && right && Math.abs(left.d - right.d) <= 0.5)
  const equalY = !!(above && below && Math.abs(above.d - below.d) <= 0.5)
  if (left) out.push({ axis: 'x', from: left.o.x + left.o.w, to: r.x, at: mid(left.o.y, left.o.y + left.o.h, r.y, r.y + r.h), size: left.d, equal: equalX })
  if (right) out.push({ axis: 'x', from: r.x + r.w, to: right.o.x, at: mid(right.o.y, right.o.y + right.o.h, r.y, r.y + r.h), size: right.d, equal: equalX })
  if (above) out.push({ axis: 'y', from: above.o.y + above.o.h, to: r.y, at: mid(above.o.x, above.o.x + above.o.w, r.x, r.x + r.w), size: above.d, equal: equalY })
  if (below) out.push({ axis: 'y', from: r.y + r.h, to: below.o.y, at: mid(below.o.x, below.o.x + below.o.w, r.x, r.x + r.w), size: below.d, equal: equalY })
  return out
}
