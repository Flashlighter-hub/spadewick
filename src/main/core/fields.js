import { randomUUID } from 'crypto'
import { recordChange, rowOf, rowsOf, changesFor } from './history.js'
import { evaluateFormula, detectCircularFormulas } from '../formula.js'
import { tr } from '../../shared/i18n.js'
import { isReservedFieldName } from '../../shared/cardIds.js'
import { readsDifferently } from '../../shared/richText.js'
import { dbOf } from './context.js'
import { FIELD_TYPES, hasOptions, splitTags } from '../../shared/fieldTypes.js'

const MAX_OPTIONS = 200
const MAX_OPTION_LENGTH = 100

/**
 * The settings of a field cleaned before they are stored (UPDATES U23): the allowed values of a Choice or Tags field without blanks or
 * repeats, the numbers of a range as numbers, a Lookup's names as text. Anything else in the object is dropped.
 */
export function cleanRules(d, type, rules) {
  if (rules == null) return null
  const r = typeof rules === 'string' ? JSON.parse(rules || '{}') : rules
  const out = {}
  if (r.min != null && r.min !== '' && Number.isFinite(Number(r.min))) out.min = Number(r.min)
  if (r.max != null && r.max !== '' && Number.isFinite(Number(r.max))) out.max = Number(r.max)
  if (r.regex) out.regex = String(r.regex)
  if (r.required) out.required = true
  if (hasOptions(type)) {
    const seen = new Set()
    const options = []
    for (const o of Array.isArray(r.options) ? r.options : []) {
      const text = String(o).replace(/[,;\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_OPTION_LENGTH)   // a comma would split a Tags value
      if (text && !seen.has(text.toLowerCase())) { seen.add(text.toLowerCase()); options.push(text) }
    }
    if (options.length > MAX_OPTIONS) throw new Error(tr('errors.tooManyOptions', { max: MAX_OPTIONS }))
    out.options = options
  }
  if (type === 'lookup') {
    for (const key of ['from', 'set', 'match', 'show']) out[key] = String(r[key] ?? '').trim()
    if (out.set && !d.prepare('SELECT 1 FROM sets WHERE id = ?').get(out.set)) throw new Error(tr('errors.lookupSetMissing'))
  }
  return Object.keys(out).length ? out : null
}

export function list(ctx, setId) {
  return dbOf(ctx).prepare('SELECT * FROM fields WHERE set_id = ? ORDER BY display_order').all(setId)
}

export function create(ctx, { setId, name, slug, type, defaultValue, formula, validation }) {
  const d = dbOf(ctx)
  slug = slug?.trim() || slugify(name)
  if (isReservedFieldName(name) || isReservedFieldName(slug)) throw new Error(tr('errors.reservedFieldName'))
  if (!FIELD_TYPES.includes(type)) throw new Error(tr('errors.fieldTypeUnknown', { type }))
  validation = cleanRules(d, type, validation)
  const id = randomUUID()
  const now = Date.now()
  const maxOrder = d.prepare(
    'SELECT COALESCE(MAX(display_order), -1) AS m FROM fields WHERE set_id = ?'
  ).get(setId).m
  d.prepare(
    `INSERT INTO fields (id, set_id, name, slug, type, default_value, formula, validation, display_order, hidden, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
  ).run(id, setId, name, slug, type, defaultValue ?? null, formula ?? null, validation ? JSON.stringify(validation) : null, maxOrder + 1, now)
  recordChange(d, 'CREATE_FIELD', [{ table: 'fields', before: null, after: rowOf(d, 'fields', id) }])
  return d.prepare('SELECT * FROM fields WHERE id = ?').get(id)
}

export function update(ctx, { id, name, slug, type, defaultValue, formula, validation, hidden, propagate }) {
  const d = dbOf(ctx)
  const before = rowOf(d, 'fields', id)
  if (!before) throw new Error(tr('errors.fieldNotFound'))
  const updates = []
  const params = []
  const slugChanged = slug !== undefined && slug !== before.slug
  if (type !== undefined && !FIELD_TYPES.includes(type)) throw new Error(tr('errors.fieldTypeUnknown', { type }))
  // the settings are read with the type the field will have
  if (validation !== undefined) validation = cleanRules(d, type ?? before.type, validation)
  if ((name !== undefined && isReservedFieldName(name)) || (slug !== undefined && isReservedFieldName(slug))) throw new Error(tr('errors.reservedFieldName'))

  if (name !== undefined)         { updates.push('name = ?');          params.push(name) }
  if (slug !== undefined)         { updates.push('slug = ?');          params.push(slug) }
  if (type !== undefined)         { updates.push('type = ?');          params.push(type) }
  if (defaultValue !== undefined) { updates.push('default_value = ?'); params.push(defaultValue) }
  if (formula !== undefined)      { updates.push('formula = ?');       params.push(formula) }
  if (validation !== undefined)   { updates.push('validation = ?');    params.push(validation ? JSON.stringify(validation) : null) }
  if (hidden !== undefined)       { updates.push('hidden = ?');        params.push(hidden ? 1 : 0) }
  if (propagate !== undefined)    { updates.push('propagate = ?');     params.push(propagate ? 1 : 0) }

  d.transaction(() => {
    let moved = { cards: [], templates: [] }
    if (updates.length) {
      params.push(id)
      d.prepare(`UPDATE fields SET ${updates.join(', ')} WHERE id = ?`).run(...params)
    }
    // Renaming a slug keeps existing card data and template tokens attached to the field
    if (slugChanged) moved = migrateSlug(d, before.set_id, before.slug, slug)
    const setBefore = slugChanged ? rowOf(d, 'sets', before.set_id) : null
    if (slugChanged) {   // the set's display and identifier columns follow the field to its new slug
      d.prepare('UPDATE sets SET display_field = ? WHERE id = ? AND display_field = ?').run(slug, before.set_id, before.slug)
      d.prepare('UPDATE sets SET identifier_field = ? WHERE id = ? AND identifier_field = ?').run(slug, before.set_id, before.slug)
    }
    recordChange(d, 'UPDATE_FIELD', [
      ...changesFor(d, 'fields', [before]),
      ...(setBefore ? changesFor(d, 'sets', [setBefore]) : []),
      ...changesFor(d, 'cards', moved.cards),
      ...changesFor(d, 'templates', moved.templates)
    ])
  })()
  return d.prepare('SELECT * FROM fields WHERE id = ?').get(id)
}

export function setWidth(ctx, { id, widthPx }) {
  dbOf(ctx).prepare('UPDATE fields SET width_px = ? WHERE id = ?').run(Math.max(40, Math.round(widthPx)), id)
}

export function remove(ctx, id) {
  const d = dbOf(ctx)
  const before = rowOf(d, 'fields', id)
  if (!before) return
  const setBefore = rowOf(d, 'sets', before.set_id)
  d.transaction(() => {
    d.prepare('DELETE FROM fields WHERE id = ?').run(id)
    // a set cannot keep a display or identifier column that is gone
    d.prepare('UPDATE sets SET display_field = NULL WHERE id = ? AND display_field = ?').run(before.set_id, before.slug)
    d.prepare('UPDATE sets SET identifier_field = NULL WHERE id = ? AND identifier_field = ?').run(before.set_id, before.slug)
  })()
  recordChange(d, 'DELETE_FIELD', [...changesFor(d, 'fields', [before]), ...changesFor(d, 'sets', [setBefore])])
}

export function reorder(ctx, { setId, orderedIds }) {
  const d = dbOf(ctx)
  const befores = rowsOf(d, 'fields', orderedIds)
  const stmt = d.prepare('UPDATE fields SET display_order = ? WHERE id = ?')
  d.transaction(() => {
    orderedIds.forEach((id, idx) => stmt.run(idx, id))
  })()
  recordChange(d, 'REORDER_FIELDS', changesFor(d, 'fields', befores))
}

/**
 * The cards whose text would look different if this field were of another type (PRD §16.7): changing between Text and Rich
 * text makes `*`, `_`, `~` and `{` mean something or stop meaning it. Shown to the user before the change is made.
 * @returns {{ count: number, cards: { id: string, name: string, text: string }[] }} up to 50 cards, with the text that changes
 */
export function convertImpact(ctx, { id, type }) {
  const d = dbOf(ctx)
  const field = d.prepare('SELECT * FROM fields WHERE id = ?').get(id)
  if (!field) throw new Error(tr('errors.fieldNotFound'))
  const touches = (field.type === 'text' && type === 'rich_text') || (field.type === 'rich_text' && type === 'text')
  if (!touches) return { count: 0, cards: [] }
  const hit = []
  for (const card of d.prepare('SELECT id, display_name, fields_json FROM cards WHERE set_id = ? AND deleted = 0 ORDER BY sort_order').all(field.set_id)) {
    const value = JSON.parse(card.fields_json)[field.slug]
    if (typeof value === 'string' && readsDifferently(value)) hit.push({ id: card.id, name: card.display_name, text: value })
  }
  return { count: hit.length, cards: hit.slice(0, 50) }
}

/** The distinct values the cards of a set hold in a field (each tag of a Tags field on its own), most used first: to fill a list of allowed values. */
export function distinctValues(ctx, { id }) {
  const d = dbOf(ctx)
  const field = d.prepare('SELECT * FROM fields WHERE id = ?').get(id)
  if (!field) throw new Error(tr('errors.fieldNotFound'))
  const counts = new Map()
  for (const c of d.prepare('SELECT fields_json FROM cards WHERE set_id = ? AND deleted = 0').all(field.set_id)) {
    const v = JSON.parse(c.fields_json)[field.slug]
    if (v == null || v === '') continue
    for (const part of field.type === 'tags' ? splitTags(v) : [String(v).trim()]) if (part) counts.set(part, (counts.get(part) ?? 0) + 1)
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([value, count]) => ({ value, count }))
}

export function runFormula(ctx, { formula, fields }) {
  return evaluateFormula(formula, fields)
}

export function checkCircular(ctx, fieldDefs) {
  return detectCircularFormulas(fieldDefs)
}

function slugify(name) {
  return String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'field'
}

/**
 * Move card data under the old slug to the new one and rewrite {{old}} tokens in templates.
 * Returns the "before" snapshots of every card and template it changed, for undo.
 */
function migrateSlug(d, setId, oldSlug, newSlug) {
  const now = Date.now()
  const moved = { cards: [], templates: [] }
  const cards = d.prepare('SELECT id, fields_json FROM cards WHERE set_id = ?').all(setId)
  for (const c of cards) {
    const f = JSON.parse(c.fields_json)
    if (!Object.hasOwn(f, oldSlug)) continue
    moved.cards.push(rowOf(d, 'cards', c.id))
    f[newSlug] = f[oldSlug]
    delete f[oldSlug]
    d.prepare('UPDATE cards SET fields_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(f), now, c.id)
  }
  const token = new RegExp(`\\{\\{\\s*${oldSlug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\}\\}`, 'g')
  for (const t of d.prepare('SELECT id, svg_source FROM templates').all()) {
    const next = t.svg_source.replace(token, () => `{{${newSlug}}}`)
    if (next === t.svg_source) continue
    moved.templates.push(rowOf(d, 'templates', t.id))
    d.prepare('UPDATE templates SET svg_source = ?, updated_at = ? WHERE id = ?').run(next, now, t.id)
  }
  return moved
}
