/**
 * Balance and set statistics (UPDATES U22): counts by any field, a summary of every field, and the warnings a designer would otherwise
 * find by hand in a spreadsheet. Pure: it is given the cards' worked-out values (src/main/core/stats.js reads them) and does no looking up.
 *
 * A row is { id, name, quantity, values: { slug: string } }. A field is { slug, name, type, validation, required? }.
 */
import { tr } from './i18n.js'
import { parseRules, optionsOf, splitTags, isComputed } from './fieldTypes.js'
import { validateValue } from './validate.js'

const MAX_NUMBER_BUCKETS = 40
const BINS = 12
export const MAX_WARNINGS = 300

const isBlank = v => v == null || String(v).trim() === ''
const num = v => (isBlank(v) ? NaN : Number(v))

/** What kind of chart a field gives: numbers along a line, or named groups. */
export function kindOf(field, rows) {
  if (field.type === 'number') return 'number'
  if (field.type === 'formula' || field.type === 'lookup') {
    const filled = rows.map(r => r.values[field.slug]).filter(v => !isBlank(v))
    if (filled.length && filled.every(v => Number.isFinite(Number(v)))) return 'number'
  }
  return 'category'
}

/** The groups a card falls into for a field: a Tags field puts a card in each of its tags; a blank value is the group ''. */
function keysOf(row, field) {
  const value = row.values[field.slug]
  if (field.type === 'tags') { const tags = splitTags(value); return tags.length ? tags : [''] }
  return [isBlank(value) ? '' : String(value).trim()]
}

const weightOf = (row, copies) => (copies ? Math.max(0, Number(row.quantity ?? 1)) : 1)

/**
 * Counts by one field, optionally split by a second. `copies` counts each card as many times as its quantity.
 * @returns {{ kind, buckets: { key, label, count, parts }[], splitKeys: string[], total: number, stats: object | null }}
 */
export function distribution(rows, by, { split = null, copies = false } = {}) {
  const kind = kindOf(by, rows)
  const entries = []   // [bucket key, split key, weight]
  for (const row of rows) {
    const w = weightOf(row, copies)
    if (w === 0) continue
    const splitKeys = split ? keysOf(row, split) : ['']
    for (const k of kind === 'number' ? [Number.isFinite(num(row.values[by.slug])) ? String(num(row.values[by.slug])) : ''] : keysOf(row, by)) {
      for (const s of splitKeys) entries.push([k, s, w])
    }
  }

  let order
  let labelOf = k => k
  if (kind === 'number') {
    const values = [...new Set(entries.map(e => e[0]).filter(k => k !== ''))].map(Number).sort((a, b) => a - b)
    if (values.length && values.every(Number.isInteger) && values[values.length - 1] - values[0] <= MAX_NUMBER_BUCKETS) {
      // a whole-number scale (a cost curve) shows its gaps: no cards at cost 5 is worth seeing
      order = Array.from({ length: values[values.length - 1] - values[0] + 1 }, (_, i) => String(values[0] + i))
    } else if (values.length > MAX_NUMBER_BUCKETS) {
      const lo = values[0], hi = values[values.length - 1], width = (hi - lo) / BINS || 1
      const bin = v => Math.min(BINS - 1, Math.floor((v - lo) / width))
      const edge = i => Number((lo + i * width).toFixed(2))
      for (const e of entries) if (e[0] !== '') e[0] = String(bin(Number(e[0])))
      order = Array.from({ length: BINS }, (_, i) => String(i))
      labelOf = k => `${edge(Number(k))}–${edge(Number(k) + 1)}`
    } else order = values.map(String)
  } else {
    const counts = new Map()
    for (const [k, , w] of entries) counts.set(k, (counts.get(k) ?? 0) + w)
    const listed = optionsOf(by)
    const given = by.type === 'choice' || by.type === 'tags' ? listed : []
    order = [...counts.keys()].filter(k => k !== '').sort((a, b) => {
      const ia = given.indexOf(a), ib = given.indexOf(b)
      if (ia >= 0 || ib >= 0) return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib)
      return counts.get(b) - counts.get(a) || a.localeCompare(b)
    })
  }
  const keys = new Set(entries.map(e => e[0]))
  if (keys.has('')) order = [...order, '']
  const byKey = new Map(order.map(k => [k, { key: k, label: k === '' ? '' : labelOf(k), count: 0, parts: {} }]))
  const splitKeys = new Set()
  for (const [k, s, w] of entries) {
    const b = byKey.get(k)
    if (!b) continue
    b.count += w
    if (split) { b.parts[s] = (b.parts[s] ?? 0) + w; splitKeys.add(s) }
  }
  const buckets = order.map(k => byKey.get(k)).filter(b => b.count > 0 || kind === 'number')
  const total = buckets.reduce((n, b) => n + b.count, 0)
  return {
    kind,
    buckets,
    splitKeys: [...splitKeys].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b))),
    total,
    stats: kind === 'number' ? numberStats(rows, by, copies) : null
  }
}

/** Minimum, maximum, mean, median and sum of a numeric field over the cards that have a number in it (weighted by copies when asked). */
export function numberStats(rows, field, copies = false) {
  const list = []
  for (const row of rows) {
    const v = num(row.values[field.slug])
    if (!Number.isFinite(v)) continue
    for (let i = 0; i < weightOf(row, copies); i++) list.push(v)
  }
  if (!list.length) return null
  list.sort((a, b) => a - b)
  const sum = list.reduce((a, b) => a + b, 0)
  const mid = list.length >> 1
  const round = n => Number(n.toFixed(2))
  return { count: list.length, min: list[0], max: list[list.length - 1], sum: round(sum), mean: round(sum / list.length), median: round(list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2) }
}

/** For every field: how many cards fill it, how many leave it blank, how many different values; and the numbers' range. */
export function summarize(rows, fields) {
  return fields.map(f => {
    const filled = rows.filter(r => !isBlank(r.values[f.slug])).length
    const distinct = new Set(rows.flatMap(r => (isBlank(r.values[f.slug]) ? [] : f.type === 'tags' ? splitTags(r.values[f.slug]).map(t => t.toLowerCase()) : [String(r.values[f.slug]).trim().toLowerCase()]))).size
    const out = { slug: f.slug, name: f.name, type: f.type, filled, empty: rows.length - filled, distinct }
    if (kindOf(f, rows) === 'number') { const s = numberStats(rows, f); if (s) Object.assign(out, { min: s.min, max: s.max, mean: s.mean }) }
    return out
  })
}

/**
 * What a designer would want to look at again: names and identifiers used twice, required fields left blank, values outside the field's
 * range or list, and lookups that found nothing. `unique` is the list of field slugs to check for duplicates.
 * @returns {{ warnings: { kind, cardId, cardName, field, message }[], count: number }} the first MAX_WARNINGS, and how many there are
 */
export function findWarnings(rows, fields, { unique = [], required = [] } = {}) {
  const out = []
  let count = 0
  const add = (kind, row, field, message) => { count++; if (out.length < MAX_WARNINGS) out.push({ kind, cardId: row.id, cardName: row.name, field: field.name, message }) }
  const bySlug = new Map(fields.map(f => [f.slug, f]))

  for (const slug of unique) {
    const f = bySlug.get(slug)
    if (!f) continue
    const groups = new Map()
    for (const row of rows) {
      const v = row.values[slug]
      if (isBlank(v)) continue
      const key = String(v).trim().toLowerCase()
      groups.set(key, [...(groups.get(key) ?? []), row])
    }
    for (const group of groups.values()) {
      if (group.length < 2) continue
      for (const row of group) add('duplicate', row, f, tr('balance.warnDuplicate', { field: f.name, value: String(row.values[slug]).trim(), others: group.length - 1 }))
    }
  }

  const mustFill = new Set([...required, ...fields.filter(f => parseRules(f.validation).required).map(f => f.slug)])
  for (const row of rows) {
    for (const f of fields) {
      const v = row.values[f.slug]
      if (mustFill.has(f.slug) && isBlank(v)) { add('empty', row, f, tr('balance.warnEmpty', { field: f.name })); continue }
      if (isBlank(v)) continue
      if (f.type === 'lookup' || isComputed(f.type) || f.type === 'image_ref' || f.type === 'rich_text') continue
      const check = validateValue(f, v)
      if (check.error) add('range', row, f, check.error)
    }
    for (const f of fields) {
      if (f.type !== 'lookup') continue
      const cfg = parseRules(f.validation)
      if (cfg.from && !isBlank(row.values[cfg.from]) && isBlank(row.values[f.slug])) add('lookup', row, f, tr('balance.warnLookup', { field: f.name, value: String(row.values[cfg.from]).trim() }))
    }
  }
  return { warnings: out, count }
}
