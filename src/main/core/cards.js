import { randomUUID } from 'crypto'
import { recordChange, rowOf, rowsOf, changesFor } from './history.js'
import { tr } from '../../shared/i18n.js'
import { validateQuantity } from '../../shared/validate.js'
import { nextCardCode, syncCounters } from '../cardIds.js'
import { assertTemplateFitsSet } from './sets.js'
import { dbOf } from './context.js'
import { createResolver } from './values.js'
import { evaluateFormula, isTruthy } from '../formula.js'
import { validStatus, validArtStatus } from '../../shared/fieldTypes.js'

/** A status the person chose must be one of the lists (UPDATES U26); blank clears it. */
function cleanStatus(status, artStatus) {
  if (status !== undefined && status !== null && !validStatus(status)) throw new Error(tr('errors.badStatus', { value: status }))
  if (artStatus !== undefined && artStatus !== null && !validArtStatus(artStatus)) throw new Error(tr('errors.badStatus', { value: artStatus }))
  return { status: status === '' ? null : status, artStatus: artStatus === '' ? null : artStatus }
}

/** The slug of the field that names the cards of a set, or null when the set has no display name (UPDATES U10). */
export const displayFieldOf = (d, setId) => d.prepare('SELECT display_field FROM sets WHERE id = ?').get(setId)?.display_field ?? null

const nextSortOrder = (d, setId) =>
  d.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM cards WHERE set_id = ? AND deleted = 0').get(setId).m + 1

export function list(ctx, setId) {
  const d = dbOf(ctx)
  const rows = d.prepare('SELECT * FROM cards WHERE set_id = ? AND deleted = 0 ORDER BY sort_order').all(setId)
  // Lookup fields are worked out, not stored: they come with the card for the table to show (UPDATES U23)
  const resolver = d.prepare("SELECT 1 FROM fields WHERE set_id = ? AND type = 'lookup'").get(setId) ? createResolver(d) : null
  return rows.map(row => {
    const fields = JSON.parse(row.fields_json)
    return resolver ? { ...row, fields, lookups: resolver.lookupsOf({ ...row, stored: fields }, fields) } : { ...row, fields }
  })
}

/**
 * The ids of the cards of a set that a filter keeps, for the card table (UPDATES U25). The filter is an expression in the formula language,
 * as the export filter is; a blank filter keeps every card. `{ error }` says what is wrong with an expression that cannot be read.
 */
export function matching(ctx, { setId, filter }) {
  const d = dbOf(ctx)
  const text = String(filter ?? '').trim()
  const resolver = createResolver(d)
  const cards = resolver.cardsOf(setId)
  if (!text) return { ids: cards.map(c => c.id) }
  const probe = evaluateFormula(text, {})
  if (String(probe).startsWith('#ERR')) return { error: tr('errors.invalidCardFilter', { detail: String(probe).slice(6) }) }
  const context = /card_number|card_count|card_id|@card/.test(text)
  return { ids: cards.filter(c => isTruthy(evaluateFormula(text, resolver.values(c, { context })))).map(c => c.id) }
}

export function create(ctx, { setId, displayName, templateId, backTemplateId, fields, quantity, status, artStatus }) {
  const d = dbOf(ctx)
  const st = cleanStatus(status, artStatus)
  const qty = quantity === undefined ? { value: 1 } : validateQuantity(quantity)
  if (qty.error) throw new Error(qty.error)
  if (templateId) assertTemplateFitsSet(d, templateId, setId)
  if (backTemplateId) assertTemplateFitsSet(d, backTemplateId, setId)
  const id = randomUUID()
  const now = Date.now()
  // `displayName` is a shortcut for the value of the set's display field (the name is no column of its own)
  const values = { ...(fields ?? {}) }
  const nameSlug = displayFieldOf(d, setId)
  if (displayName !== undefined && nameSlug) values[nameSlug] = displayName
  d.transaction(() => {
    d.prepare(
      `INSERT INTO cards (id, set_id, card_code, template_id, back_template_id, quantity, fields_json, sort_order, deleted, created_at, updated_at, status, art_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`
    ).run(id, setId, nextCardCode(d, setId), templateId ?? null, backTemplateId ?? null, qty.value, JSON.stringify(values), nextSortOrder(d, setId), now, now, st.status ?? null, st.artStatus ?? null)
  })()

  recordChange(d, 'CREATE_CARD', [{ table: 'cards', before: null, after: rowOf(d, 'cards', id) }])
  return d.prepare('SELECT * FROM cards WHERE id = ?').get(id)
}

export function update(ctx, { id, displayName, templateId, backTemplateId, fields, quantity, cardCode, status, artStatus }) {
  const d = dbOf(ctx)
  const st = cleanStatus(status, artStatus)
  const qty = quantity === undefined ? null : validateQuantity(quantity)
  if (qty?.error) throw new Error(qty.error)
  const newCode = cardCode === undefined ? undefined : String(cardCode).trim()
  if (newCode === '') throw new Error(tr('errors.cardIdEmpty'))
  if (newCode !== undefined && d.prepare('SELECT 1 FROM cards WHERE card_code = ? AND id != ?').get(newCode, id))
    throw new Error(tr('errors.cardIdTaken', { code: newCode }))
  const before = rowOf(d, 'cards', id)
  if (!before) throw new Error(tr('errors.cardNotFound'))
  if (templateId) assertTemplateFitsSet(d, templateId, before.set_id)
  if (backTemplateId) assertTemplateFitsSet(d, backTemplateId, before.set_id)
  const now = Date.now()

  if (templateId !== undefined)
    d.prepare('UPDATE cards SET template_id = ?, updated_at = ? WHERE id = ?').run(templateId, now, id)
  if (backTemplateId !== undefined)
    d.prepare('UPDATE cards SET back_template_id = ?, updated_at = ? WHERE id = ?').run(backTemplateId, now, id)
  if (qty) d.prepare('UPDATE cards SET quantity = ?, updated_at = ? WHERE id = ?').run(qty.value, now, id)
  if (status !== undefined) d.prepare('UPDATE cards SET status = ?, updated_at = ? WHERE id = ?').run(st.status, now, id)
  if (artStatus !== undefined) d.prepare('UPDATE cards SET art_status = ?, updated_at = ? WHERE id = ?').run(st.artStatus, now, id)
  if (newCode !== undefined) {
    d.prepare('UPDATE cards SET card_code = ?, updated_at = ? WHERE id = ?').run(newCode, now, id)
    syncCounters(d, [before.set_id])   // an edited ID can sit ahead of the counter
  }
  const nameSlug = displayFieldOf(d, before.set_id)
  const edit = { ...(fields ?? {}) }
  if (displayName !== undefined && nameSlug) edit[nameSlug] = displayName
  let spread = []
  if (Object.keys(edit).length) {
    const merged = { ...JSON.parse(before.fields_json), ...edit }
    d.prepare('UPDATE cards SET fields_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(merged), now, id)
    spread = propagateEdit(d, before, edit, now)
  }

  recordChange(d, 'UPDATE_CARD', [...changesFor(d, 'cards', [before]), ...changesFor(d, 'cards', spread)])
  return d.prepare('SELECT * FROM cards WHERE id = ?').get(id)
}

/** The values an edit of `edit` would put into the other cards of the set that share this card's identifier (UPDATES U9). */
function propagationTargets(d, card, edit) {
  const { identifier_field: idSlug } = d.prepare('SELECT identifier_field FROM sets WHERE id = ?').get(card.set_id) ?? {}
  if (!idSlug) return []
  const marked = new Set(d.prepare('SELECT slug FROM fields WHERE set_id = ? AND propagate = 1').all(card.set_id).map(f => f.slug))
  const slugs = Object.keys(edit).filter(slug => marked.has(slug) && slug !== idSlug)
  const key = JSON.parse(card.fields_json)[idSlug]
  if (!slugs.length || key == null || key === '') return []
  const out = []
  for (const other of d.prepare('SELECT * FROM cards WHERE set_id = ? AND deleted = 0 AND id != ? ORDER BY sort_order').all(card.set_id, card.id)) {
    const values = JSON.parse(other.fields_json)
    if (values[idSlug] !== key) continue
    const changed = slugs.filter(slug => values[slug] !== edit[slug])
    if (changed.length) out.push({ row: other, values, changed })
  }
  return out
}

/**
 * Edit propagation (UPDATES U9): a column marked "propagate" is changed in every other card of the set that shares this card's identifier
 * when one of them is edited. Returns the "before" rows of the other cards that were changed, so the whole edit is one undo step.
 */
function propagateEdit(d, before, edit, now) {
  const spread = []
  for (const { row, values, changed } of propagationTargets(d, before, edit)) {
    spread.push(rowOf(d, 'cards', row.id))
    for (const slug of changed) values[slug] = edit[slug]
    d.prepare('UPDATE cards SET fields_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(values), now, row.id)
  }
  return spread
}

/** The cards an edit would change besides the one edited, for a preview: [{ id, name, field, from, to }]. */
export function propagatePreview(ctx, { id, fields }) {
  const d = dbOf(ctx)
  const card = d.prepare('SELECT * FROM cards WHERE id = ?').get(id)
  if (!card) return []
  return propagationTargets(d, card, fields ?? {}).flatMap(({ row, values, changed }) =>
    changed.map(field => ({ id: row.id, name: row.display_name, field, from: values[field] ?? '', to: fields[field] })))
}

export function batchUpdate(ctx, { cardIds, fields, displayName, templateId, backTemplateId, quantity, status, artStatus }) {
  const d = dbOf(ctx)
  const st = cleanStatus(status, artStatus)
  const qty = quantity === undefined ? null : validateQuantity(quantity)
  if (qty?.error) throw new Error(qty.error)
  const now = Date.now()
  const befores = rowsOf(d, 'cards', cardIds)
  if (templateId) for (const b of befores) assertTemplateFitsSet(d, templateId, b.set_id)
  if (backTemplateId) for (const b of befores) assertTemplateFitsSet(d, backTemplateId, b.set_id)

  const spread = []
  d.transaction(() => {
    const done = new Set(befores.map(b => b.id))
    for (const b of befores) {
      const edit = { ...(fields ?? {}) }
      const nameSlug = displayFieldOf(d, b.set_id)
      if (displayName !== undefined && nameSlug) edit[nameSlug] = displayName
      const merged = { ...JSON.parse(d.prepare('SELECT fields_json FROM cards WHERE id = ?').get(b.id).fields_json), ...edit }
      d.prepare('UPDATE cards SET fields_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(merged), now, b.id)
      // a card that shares an identifier is changed once, and never one the edit already covers
      for (const row of propagateEdit(d, b, edit, now)) if (!done.has(row.id)) { done.add(row.id); spread.push(row) }
      if (templateId !== undefined) d.prepare('UPDATE cards SET template_id = ? WHERE id = ?').run(templateId, b.id)
      if (backTemplateId !== undefined) d.prepare('UPDATE cards SET back_template_id = ? WHERE id = ?').run(backTemplateId, b.id)
      if (qty) d.prepare('UPDATE cards SET quantity = ? WHERE id = ?').run(qty.value, b.id)
      if (status !== undefined) d.prepare('UPDATE cards SET status = ? WHERE id = ?').run(st.status, b.id)
      if (artStatus !== undefined) d.prepare('UPDATE cards SET art_status = ? WHERE id = ?').run(st.artStatus, b.id)
    }
  })()

  recordChange(d, 'BATCH_UPDATE_CARDS', [...changesFor(d, 'cards', befores), ...changesFor(d, 'cards', spread)])
}

export function remove(ctx, ids) {
  const d = dbOf(ctx)
  const now = Date.now()
  const befores = rowsOf(d, 'cards', ids)

  d.transaction(() => {
    for (const id of ids) d.prepare('UPDATE cards SET deleted = 1, updated_at = ? WHERE id = ?').run(now, id)
  })()

  recordChange(d, 'DELETE_CARDS', changesFor(d, 'cards', befores))
}

export function reorder(ctx, { setId, orderedIds }) {
  const d = dbOf(ctx)
  const befores = rowsOf(d, 'cards', orderedIds)
  const stmt = d.prepare('UPDATE cards SET sort_order = ? WHERE id = ?')
  d.transaction(() => {
    orderedIds.forEach((id, idx) => stmt.run(idx, id))
  })()
  recordChange(d, 'REORDER_CARDS', changesFor(d, 'cards', befores))
}

export function duplicate(ctx, ids) {
  const d = dbOf(ctx)
  const now = Date.now()
  const created = []
  const changes = []

  d.transaction(() => {
    for (const srcId of ids) {
      const src = d.prepare('SELECT * FROM cards WHERE id = ?').get(srcId)
      if (!src) continue
      const newId = randomUUID()
      const values = JSON.parse(src.fields_json)
      const nameSlug = displayFieldOf(d, src.set_id)
      if (nameSlug) values[nameSlug] = `${values[nameSlug] ?? ''} (copy)`
      d.prepare(
        `INSERT INTO cards (id, set_id, card_code, template_id, back_template_id, quantity, fields_json, sort_order, deleted, created_at, updated_at, status, art_status, instance_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`
      ).run(newId, src.set_id, nextCardCode(d, src.set_id), src.template_id, src.back_template_id, src.quantity, JSON.stringify(values), nextSortOrder(d, src.set_id), now, now, src.status, src.art_status, src.instance_json)
      changes.push({ table: 'cards', before: null, after: rowOf(d, 'cards', newId) })
      created.push(d.prepare('SELECT * FROM cards WHERE id = ?').get(newId))
    }
  })()

  recordChange(d, 'DUPLICATE_CARDS', changes)
  return created
}

export function findReplace(ctx, { setIds, fieldSlugs, find, replace, isRegex, previewOnly }) {
  const d = dbOf(ctx)
  const results = []
  if (!find) return results
  const re = isRegex ? new RegExp(find, 'g') : null // throws on an invalid pattern; surfaced to the UI

  for (const setId of setIds) {
    // PRD §5.7: only text/number fields are searched
    const defs = d.prepare("SELECT slug, type FROM fields WHERE set_id = ? AND type IN ('text','number','rich_text')").all(setId)
    const searchable = new Set(defs.map(f => f.slug))
    const richSlugs = new Set(defs.filter(f => f.type === 'rich_text').map(f => f.slug)) // searched as text, markup included (PRD §16.7)
    const cards = d.prepare('SELECT * FROM cards WHERE set_id = ? AND deleted = 0').all(setId)
    for (const card of cards) {
      const fields = JSON.parse(card.fields_json)
      const changes = {}
      for (const [slug, value] of Object.entries(fields)) {
        if (fieldSlugs && !fieldSlugs.includes(slug)) continue
        if (!searchable.has(slug)) continue
        if (typeof value !== 'string') continue
        const next = isRegex
          ? value.replace(re, replace)
          : value.split(find).join(replace)
        if (next !== value) changes[slug] = { from: value, to: next, rich: richSlugs.has(slug) }
      }
      if (Object.keys(changes).length) results.push({ cardId: card.id, displayName: card.display_name, changes })
    }
  }

  if (!previewOnly && results.length) {
    const befores = rowsOf(d, 'cards', results.map(r => r.cardId))
    d.transaction(() => {
      for (const result of results) {
        const row = d.prepare('SELECT fields_json FROM cards WHERE id = ?').get(result.cardId)
        const fields = JSON.parse(row.fields_json)
        for (const [slug, { to }] of Object.entries(result.changes)) fields[slug] = to
        d.prepare('UPDATE cards SET fields_json = ?, updated_at = ? WHERE id = ?').run(
          JSON.stringify(fields), Date.now(), result.cardId
        )
      }
    })()
    recordChange(d, 'FIND_REPLACE', changesFor(d, 'cards', befores))
  }

  return results
}

