/**
 * How an SVG <image> fills its box, for drawing it live while it is dragged or resized (PRD §8.7.3).
 * Mirrors the `preserveAspectRatio` rules the final render applies, so the live picture and the
 * rendered one agree. Pure, so it can be unit tested.
 */

/** Parse a preserveAspectRatio value. Missing or unreadable values mean the SVG default, xMidYMid meet. */
export function parseAspect(value) {
  const v = String(value ?? '').trim().replace(/^defer\s+/, '')
  if (/^none\b/.test(v)) return { none: true, slice: false, ax: 0.5, ay: 0.5 }
  const m = /^x(Min|Mid|Max)Y(Min|Mid|Max)(?:\s+(meet|slice))?$/.exec(v)
  if (!m) return { none: false, slice: false, ax: 0.5, ay: 0.5 }
  const a = { Min: 0, Mid: 0.5, Max: 1 }
  return { none: false, slice: m[3] === 'slice', ax: a[m[1]], ay: a[m[2]] }
}

/**
 * Where to draw a picture of natural size `nat` ({ w, h }) inside `box` ({ x, y, w, h }).
 * The result is the picture's rectangle; with `slice` it is larger than the box and must be clipped to it.
 */
export function fitImage(box, nat, aspect) {
  const par = typeof aspect === 'string' || aspect == null ? parseAspect(aspect) : aspect
  if (par.none || !(nat.w > 0) || !(nat.h > 0)) return { x: box.x, y: box.y, w: box.w, h: box.h }
  const sx = box.w / nat.w, sy = box.h / nat.h
  const s = par.slice ? Math.max(sx, sy) : Math.min(sx, sy)
  const w = nat.w * s, h = nat.h * s
  return { x: box.x + (box.w - w) * par.ax, y: box.y + (box.h - h) * par.ay, w, h }
}
