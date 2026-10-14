/**
 * Layer ordering for the layers panel (PRD §8.7.2).
 * Pure functions over lists of element ids, free of the DOM, so they can be unit tested.
 *
 * Every list is in SVG order: the first id is painted first (at the back), the last on top. The panel
 * shows the reverse of that, front-most first.
 */

/**
 * Move `id` within `ids` by one of the four z-order operations of §8.4.
 * Returns a new array; the same contents when there is nothing to do.
 */
export function reorder(ids, id, op) {
  const i = ids.indexOf(id)
  if (i < 0) return ids.slice()
  const out = ids.slice()
  out.splice(i, 1)
  const to = op === 'front' ? out.length
    : op === 'back' ? 0
    : op === 'forward' ? Math.min(i + 1, out.length)
    : op === 'backward' ? Math.max(i - 1, 0)
    : i
  out.splice(to, 0, id)
  return out
}

/**
 * Put `id` directly in front of (`side` 'front') or directly behind (`side` 'behind') `targetId`.
 * Returns a new array; the same contents when either id is missing or they are the same.
 */
export function moveRelative(ids, id, targetId, side) {
  if (id === targetId || !ids.includes(id) || !ids.includes(targetId)) return ids.slice()
  const out = ids.filter(x => x !== id)
  const t = out.indexOf(targetId)
  out.splice(side === 'front' ? t + 1 : t, 0, id)
  return out
}

/** True when two orders are the same. */
export const sameOrder = (a, b) => a.length === b.length && a.every((v, i) => v === b[i])

/** The text shown for a row: the element's visible text, else its field, else its id. */
export function layerLabel({ text, field, id }, max = 28) {
  const t = (text ?? '').replace(/\s+/g, ' ').trim()
  const label = t || field || id
  return label.length > max ? `${label.slice(0, max - 1)}…` : label
}
