/**
 * Print colours (PRD §17.5, §28.3): a colour of the design that has exact ink values and/or a spot colour name. A print colour is
 * matched to the design by its screen colour (`rgb`); where a flat area has exactly that colour, the production export prints the
 * ink values given here instead of the profile's conversion. A spot name is written as a separation by the vector output of phase 2
 * (the raster output of phase 1 prints it as its ink values and says so).
 */
import { randomUUID } from 'crypto'
import { dbOf } from './context.js'
import { recordChange, rowOf, changesFor } from './history.js'
import { tr } from '../../shared/i18n.js'

const HEX = /^#([0-9a-f]{6})$/i
const present = r => ({ id: r.id, name: r.name, rgb: r.rgb, cmyk: r.c === null ? null : [r.c, r.m, r.y, r.k], spotName: r.spot_name ?? null, sortOrder: r.sort_order })

export const list = ctx => dbOf(ctx).prepare('SELECT * FROM print_colors ORDER BY sort_order, name').all().map(present)

function clean({ name, rgb, cmyk, spotName }, d, exceptId) {
  const n = String(name ?? '').trim()
  if (!n || n.length > 60) throw new Error(tr('errors.printColorName'))
  if (d.prepare('SELECT 1 FROM print_colors WHERE name = ? AND id != ?').get(n, exceptId ?? '')) throw new Error(tr('errors.printColorNameTaken', { name: n }))
  let hex = String(rgb ?? '').trim().toLowerCase()
  if (/^#[0-9a-f]{3}$/.test(hex)) hex = `#${[...hex.slice(1)].map(c => c + c).join('')}`
  if (!HEX.test(hex)) throw new Error(tr('errors.printColorRgb'))
  let ink = null
  if (cmyk !== null && cmyk !== undefined) {
    if (!Array.isArray(cmyk) || cmyk.length !== 4 || cmyk.some(v => !Number.isFinite(Number(v)) || Number(v) < 0 || Number(v) > 100)) throw new Error(tr('errors.printColorInk'))
    ink = cmyk.map(Number)
  }
  const spot = String(spotName ?? '').trim()
  if (spot.length > 40 || /[()\\]/.test(spot)) throw new Error(tr('errors.printColorSpot'))
  return { n, hex, ink, spot: spot || null }
}

export function create(ctx, opts) {
  const d = dbOf(ctx)
  const { n, hex, ink, spot } = clean(opts, d)
  const id = randomUUID()
  const order = d.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM print_colors').get().m + 1
  d.prepare('INSERT INTO print_colors (id, name, rgb, c, m, y, k, spot_name, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, n, hex, ink?.[0] ?? null, ink?.[1] ?? null, ink?.[2] ?? null, ink?.[3] ?? null, spot, order, Date.now())
  recordChange(d, 'CREATE_PRINT_COLOR', [{ table: 'print_colors', before: null, after: rowOf(d, 'print_colors', id) }])
  return present(rowOf(d, 'print_colors', id))
}

export function update(ctx, { id, ...opts }) {
  const d = dbOf(ctx)
  const before = rowOf(d, 'print_colors', id)
  if (!before) throw new Error(tr('errors.printColorNotFound'))
  const merged = { name: opts.name ?? before.name, rgb: opts.rgb ?? before.rgb, cmyk: opts.cmyk === undefined ? (before.c === null ? null : [before.c, before.m, before.y, before.k]) : opts.cmyk, spotName: opts.spotName === undefined ? before.spot_name : opts.spotName }
  const { n, hex, ink, spot } = clean(merged, d, id)
  d.prepare('UPDATE print_colors SET name = ?, rgb = ?, c = ?, m = ?, y = ?, k = ?, spot_name = ? WHERE id = ?').run(n, hex, ink?.[0] ?? null, ink?.[1] ?? null, ink?.[2] ?? null, ink?.[3] ?? null, spot, id)
  recordChange(d, 'UPDATE_PRINT_COLOR', changesFor(d, 'print_colors', [before]))
  return present(rowOf(d, 'print_colors', id))
}

export function remove(ctx, id) {
  const d = dbOf(ctx)
  const before = rowOf(d, 'print_colors', id)
  if (!before) return
  d.prepare('DELETE FROM print_colors WHERE id = ?').run(id)
  recordChange(d, 'DELETE_PRINT_COLOR', [{ table: 'print_colors', before, after: null }])
}
