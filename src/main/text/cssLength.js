/** CSS lengths in pixels (shared by the SVG pass and the text controls). */

export const UNITS = { px: 1, pt: 4 / 3, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96 }

/** A CSS length in pixels, or null when it is not one the engine reads. `parent` is the parent's font size, for em and %. */
export function lengthPx(value, parent) {
  const m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+))(px|pt|pc|mm|cm|in|em|ex|%)?\s*$/i.exec(String(value))
  if (!m) return null
  const n = Number(m[1]), unit = (m[2] ?? 'px').toLowerCase()
  if (unit === 'em') return n * (parent ?? 12)
  if (unit === 'ex') return n * (parent ?? 12) / 2
  if (unit === '%') return n * (parent ?? 12) / 100
  return n * UNITS[unit]
}
