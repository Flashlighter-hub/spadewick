/**
 * Text styles (PRD §16.5): a named bundle of font, weight, slant, size, colour, spacing and effects. Used as
 * `{style:name}…{/style}` or by a keyword rule; changing a style changes every card at once.
 * Covered by undo and redo; renaming a style updates what uses it in one step.
 */
import { randomUUID } from 'crypto'
import { dbOf } from './context.js'
import { recordChange, rowOf, changesFor } from './history.js'
import { iconKey, parseMarkup, renameStyleInMarkup } from '../../shared/richText.js'
import { normalizeStyleProps } from '../../shared/textStyleProps.js'
import { tr } from '../../shared/i18n.js'

const NAME = /^[a-z0-9][a-z0-9_-]{0,39}$/
const parse = row => ({ id: row.id, name: row.name, props: JSON.parse(row.props || '{}'), createdAt: row.created_at })

function checkName(d, name, exceptId) {
  const key = iconKey(name)
  if (!NAME.test(key)) throw new Error(tr('errors.styleNameInvalid'))
  const other = d.prepare('SELECT id FROM text_styles WHERE name = ?').get(key)
  if (other && other.id !== exceptId) throw new Error(tr('errors.styleNameTaken', { name: key }))
  return key
}

function checkProps(input) {
  const { props, rejected } = normalizeStyleProps(input)
  if (rejected.length) throw new Error(tr('errors.stylePropertyInvalid', { names: rejected.join(', ') }))
  return props
}

/** Where each style is used: rich text of cards, and keyword rules. */
function scanUsage(d) {
  const usage = new Map(d.prepare('SELECT name FROM text_styles').all().map(r => [r.name, { cards: 0, rules: 0 }]))
  const richBySet = new Map()
  for (const f of d.prepare("SELECT set_id, slug FROM fields WHERE type = 'rich_text'").all()) richBySet.set(f.set_id, [...(richBySet.get(f.set_id) ?? []), f.slug])
  for (const card of d.prepare('SELECT set_id, fields_json FROM cards WHERE deleted = 0').all()) {
    const slugs = richBySet.get(card.set_id)
    if (!slugs) continue
    const values = JSON.parse(card.fields_json)
    const seen = new Set()
    for (const slug of slugs) for (const run of parseMarkup(values[slug] ?? '').runs) for (const k of run.styles ?? []) seen.add(k)
    for (const k of seen) if (usage.has(k)) usage.get(k).cards++
  }
  for (const r of d.prepare("SELECT action FROM keyword_rules WHERE mode = 'style'").all()) {
    const k = iconKey(JSON.parse(r.action || '{}').style ?? '')
    if (usage.has(k)) usage.get(k).rules++
  }
  return usage
}

export function list(ctx) {
  const d = dbOf(ctx)
  const usage = scanUsage(d)
  return d.prepare('SELECT * FROM text_styles ORDER BY name').all().map(r => ({ ...parse(r), usage: usage.get(r.name) }))
}

export function create(ctx, { name, props }) {
  const d = dbOf(ctx)
  const key = checkName(d, name)
  const clean = checkProps(props)
  const id = randomUUID()
  d.prepare('INSERT INTO text_styles (id, name, props, created_at) VALUES (?, ?, ?, ?)').run(id, key, JSON.stringify(clean), Date.now())
  recordChange(d, 'CREATE_TEXT_STYLE', [{ table: 'text_styles', before: null, after: rowOf(d, 'text_styles', id) }])
  return parse(d.prepare('SELECT * FROM text_styles WHERE id = ?').get(id))
}

/** Replace the properties of a style. */
export function update(ctx, { id, props }) {
  const d = dbOf(ctx)
  const before = rowOf(d, 'text_styles', id)
  if (!before) throw new Error(tr('errors.styleNotFound'))
  d.prepare('UPDATE text_styles SET props = ? WHERE id = ?').run(JSON.stringify(checkProps(props)), id)
  recordChange(d, 'UPDATE_TEXT_STYLE', changesFor(d, 'text_styles', [before]))
  return parse(d.prepare('SELECT * FROM text_styles WHERE id = ?').get(id))
}

/** Rename a style; `{style:old}` in cards and templates, and keyword rules that use it, follow in the same undo step. */
export function rename(ctx, { id, name }) {
  const d = dbOf(ctx)
  const before = rowOf(d, 'text_styles', id)
  if (!before) throw new Error(tr('errors.styleNotFound'))
  const key = checkName(d, name, id)
  if (key === before.name) return { style: parse(d.prepare('SELECT * FROM text_styles WHERE id = ?').get(id)), updated: { cards: 0, rules: 0, templates: 0 } }
  const changes = [], updated = { cards: 0, rules: 0, templates: 0 }
  d.transaction(() => {
    d.prepare('UPDATE text_styles SET name = ? WHERE id = ?').run(key, id)
    const richBySet = new Map()
    for (const f of d.prepare("SELECT set_id, slug FROM fields WHERE type = 'rich_text'").all()) richBySet.set(f.set_id, [...(richBySet.get(f.set_id) ?? []), f.slug])
    for (const card of d.prepare('SELECT id, set_id, fields_json FROM cards').all()) {
      const slugs = richBySet.get(card.set_id)
      if (!slugs) continue
      const values = JSON.parse(card.fields_json)
      let changed = false
      for (const slug of slugs) if (typeof values[slug] === 'string') { const next = renameStyleInMarkup(values[slug], before.name, key); if (next !== values[slug]) { values[slug] = next; changed = true } }
      if (!changed) continue
      const old = rowOf(d, 'cards', card.id)
      d.prepare('UPDATE cards SET fields_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(values), Date.now(), card.id)
      changes.push({ table: 'cards', before: old, after: rowOf(d, 'cards', card.id) }); updated.cards++
    }
    for (const r of d.prepare("SELECT * FROM keyword_rules WHERE mode = 'style'").all()) {
      const action = JSON.parse(r.action || '{}')
      if (iconKey(action.style ?? '') !== before.name) continue
      const old = rowOf(d, 'keyword_rules', r.id)
      d.prepare('UPDATE keyword_rules SET action = ? WHERE id = ?').run(JSON.stringify({ ...action, style: key }), r.id)
      changes.push({ table: 'keyword_rules', before: old, after: rowOf(d, 'keyword_rules', r.id) }); updated.rules++
    }
    for (const t of d.prepare('SELECT id, svg_source FROM templates').all()) {
      const next = t.svg_source.replace(/(<text\b[^>]*>)([\s\S]*?)(<\/text>)/g, (_, open, inner, close) => open + renameStyleInMarkup(inner, before.name, key) + close)
      if (next === t.svg_source) continue
      const old = rowOf(d, 'templates', t.id)
      d.prepare('UPDATE templates SET svg_source = ?, updated_at = ? WHERE id = ?').run(next, Date.now(), t.id)
      changes.push({ table: 'templates', before: old, after: rowOf(d, 'templates', t.id) }); updated.templates++
    }
    recordChange(d, 'RENAME_TEXT_STYLE', [...changesFor(d, 'text_styles', [before]), ...changes])
  })()
  return { style: parse(d.prepare('SELECT * FROM text_styles WHERE id = ?').get(id)), updated }
}

/** Delete a style. Text that names it then shows without a style, and is listed by the text check. */
export function remove(ctx, id) {
  const d = dbOf(ctx)
  const before = rowOf(d, 'text_styles', id)
  if (!before) return
  d.prepare('DELETE FROM text_styles WHERE id = ?').run(id)
  recordChange(d, 'DELETE_TEXT_STYLE', [{ table: 'text_styles', before, after: null }])
}
