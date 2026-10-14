/**
 * Saved views of the card table (UPDATES U25): a name and a filter, per set. The filter is an expression in the formula language, the same
 * one an export filter uses; "red creatures not yet final" is written and(colour == "Red", status != "final"). Covered by undo and redo.
 */
import { randomUUID } from 'crypto'
import { dbOf } from './context.js'
import { recordChange, rowOf, changesFor } from './history.js'
import { evaluateFormula } from '../formula.js'
import { tr } from '../../shared/i18n.js'

const MAX_VIEWS = 200
const MAX_NAME = 80
const MAX_FILTER = 1000

const cleanName = n => String(n ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME)

/** A filter that can be read; a blank filter is a view of every card. */
function cleanFilter(filter) {
  const text = String(filter ?? '').trim().slice(0, MAX_FILTER)
  if (text) {
    const probe = evaluateFormula(text, {})
    if (String(probe).startsWith('#ERR')) throw new Error(tr('errors.invalidCardFilter', { detail: String(probe).slice(6) }))
  }
  return text
}

export const list = (ctx, setId) => dbOf(ctx).prepare('SELECT * FROM saved_views WHERE set_id = ? ORDER BY sort_order, created_at').all(setId)

export function create(ctx, { setId, name, filter }) {
  const d = dbOf(ctx)
  if (!d.prepare('SELECT 1 FROM sets WHERE id = ?').get(setId)) throw new Error(tr('errors.setNotFound'))
  const clean = cleanName(name)
  if (!clean) throw new Error(tr('views.nameNeeded'))
  if (d.prepare('SELECT 1 FROM saved_views WHERE set_id = ? AND name = ? COLLATE NOCASE').get(setId, clean)) throw new Error(tr('views.nameTaken', { name: clean }))
  if (d.prepare('SELECT COUNT(*) AS n FROM saved_views WHERE set_id = ?').get(setId).n >= MAX_VIEWS) throw new Error(tr('views.tooMany', { max: MAX_VIEWS }))
  const text = cleanFilter(filter)
  const id = randomUUID()
  const order = d.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM saved_views WHERE set_id = ?').get(setId).m + 1
  d.prepare('INSERT INTO saved_views (id, set_id, name, filter, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, setId, clean, text, order, Date.now())
  recordChange(d, 'CREATE_VIEW', [{ table: 'saved_views', before: null, after: rowOf(d, 'saved_views', id) }])
  return d.prepare('SELECT * FROM saved_views WHERE id = ?').get(id)
}

export function update(ctx, { id, name, filter }) {
  const d = dbOf(ctx)
  const before = rowOf(d, 'saved_views', id)
  if (!before) throw new Error(tr('views.notFound'))
  if (name !== undefined) {
    const clean = cleanName(name)
    if (!clean) throw new Error(tr('views.nameNeeded'))
    if (d.prepare('SELECT 1 FROM saved_views WHERE set_id = ? AND name = ? COLLATE NOCASE AND id != ?').get(before.set_id, clean, id)) throw new Error(tr('views.nameTaken', { name: clean }))
    d.prepare('UPDATE saved_views SET name = ? WHERE id = ?').run(clean, id)
  }
  if (filter !== undefined) d.prepare('UPDATE saved_views SET filter = ? WHERE id = ?').run(cleanFilter(filter), id)
  recordChange(d, 'UPDATE_VIEW', changesFor(d, 'saved_views', [before]))
  return d.prepare('SELECT * FROM saved_views WHERE id = ?').get(id)
}

export function remove(ctx, id) {
  const d = dbOf(ctx)
  const before = rowOf(d, 'saved_views', id)
  if (!before) return
  d.prepare('DELETE FROM saved_views WHERE id = ?').run(id)
  recordChange(d, 'DELETE_VIEW', [{ table: 'saved_views', before, after: null }])
}
