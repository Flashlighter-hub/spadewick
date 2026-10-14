/**
 * Aligning and distributing elements (A80). Pure: boxes in, offsets out, so it can be tested without a canvas.
 *
 * A box is { id, x, y, w, h } in card units. Every function returns a Map of id -> { dx, dy }: how far each element moves.
 * Elements that stay where they are are left out.
 */

/** The box that holds all of `boxes`. */
export function boundsOf(boxes) {
  if (!boxes.length) return null
  const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y))
  return { x, y, w: Math.max(...boxes.map(b => b.x + b.w)) - x, h: Math.max(...boxes.map(b => b.y + b.h)) - y }
}

export const ALIGN_MODES = ['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom']

const round = v => Math.round(v * 100) / 100

/**
 * Line the boxes up on one edge or centre of `to` (the card when one element is selected, otherwise the box that holds the
 * selection).
 */
export function alignOffsets(boxes, mode, to) {
  const out = new Map()
  if (!ALIGN_MODES.includes(mode)) return out
  const target = to ?? boundsOf(boxes)
  if (!target) return out
  for (const b of boxes) {
    let dx = 0, dy = 0
    if (mode === 'left') dx = target.x - b.x
    else if (mode === 'right') dx = target.x + target.w - (b.x + b.w)
    else if (mode === 'hcenter') dx = target.x + target.w / 2 - (b.x + b.w / 2)
    else if (mode === 'top') dy = target.y - b.y
    else if (mode === 'bottom') dy = target.y + target.h - (b.y + b.h)
    else if (mode === 'vcenter') dy = target.y + target.h / 2 - (b.y + b.h / 2)
    dx = round(dx); dy = round(dy)
    if (dx !== 0 || dy !== 0) out.set(b.id, { dx, dy })
  }
  return out
}

/**
 * Space the boxes so the gaps between neighbours are equal. The first and last (by position) stay where they are.
 * `axis` is 'x' (a row: horizontal gaps) or 'y' (a column). Needs three boxes or more.
 */
export function distributeOffsets(boxes, axis) {
  const out = new Map()
  if (boxes.length < 3 || (axis !== 'x' && axis !== 'y')) return out
  const pos = axis === 'x' ? 'x' : 'y', size = axis === 'x' ? 'w' : 'h'
  const sorted = [...boxes].sort((a, b) => a[pos] - b[pos] || a[size] - b[size])
  const first = sorted[0], last = sorted[sorted.length - 1]
  const span = last[pos] + last[size] - first[pos]
  const inner = sorted.reduce((n, b) => n + b[size], 0)
  const gap = (span - inner) / (sorted.length - 1)
  let at = first[pos] + first[size] + gap
  for (const b of sorted.slice(1, -1)) {
    const d = round(at - b[pos])
    if (d !== 0) out.set(b.id, axis === 'x' ? { dx: d, dy: 0 } : { dx: 0, dy: d })
    at += b[size] + gap
  }
  return out
}

/** Apply offsets to boxes: the boxes as they will be. */
export function moved(boxes, offsets) {
  return boxes.map(b => { const o = offsets.get(b.id); return o ? { ...b, x: b.x + o.dx, y: b.y + o.dy } : b })
}
