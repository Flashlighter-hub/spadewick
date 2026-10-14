/**
 * The values of a card as the rest of the program reads them (UPDATES U23): what is stored, plus what is worked out — the Lookup fields
 * (a value pulled from a card of another set), the Formula fields, the card's name, ID, position, quantity and status.
 *
 * Filters, template rules, saved views and the balance view all read cards through here, so a filter such as `status == 'final'` or
 * `has(keywords, 'Flying')` means the same in each. A resolver is made for one operation: it keeps what it has looked up (the cards of a set
 * the lookups point at, the order of a set) and is thrown away afterwards, so it can never be stale.
 */
import { evaluateFormula } from '../formula.js'
import { richSlugsOf, plainValues } from '../richFields.js'
import { lookupOf } from '../../shared/fieldTypes.js'

const MAX_DEPTH = 3   // a lookup that shows a lookup that shows a lookup; deeper than this is a loop or a mistake
const norm = v => String(v ?? '').trim().toLowerCase()

export function createResolver(db) {
  const defsBySet = new Map()
  const cardsBySet = new Map()
  const indexes = new Map()
  const orders = new Map()

  const defs = setId => {
    if (!defsBySet.has(setId)) defsBySet.set(setId, db.prepare('SELECT * FROM fields WHERE set_id = ? ORDER BY display_order').all(setId))
    return defsBySet.get(setId)
  }
  const cardsOf = setId => {
    if (!cardsBySet.has(setId)) cardsBySet.set(setId, db.prepare('SELECT * FROM cards WHERE set_id = ? AND deleted = 0 ORDER BY sort_order').all(setId).map(c => ({ ...c, stored: JSON.parse(c.fields_json) })))
    return cardsBySet.get(setId)
  }
  const displayFieldOf = setId => db.prepare('SELECT display_field FROM sets WHERE id = ?').get(setId)?.display_field ?? null
  const valueOfMatch = (card, slug) => slug === '@id' ? card.card_code ?? '' : card.stored[slug]

  /** The card of `setId` whose `matchSlug` column equals `key`, or null. */
  function find(setId, matchSlug, key) {
    const id = `${setId}\u0000${matchSlug}`
    if (!indexes.has(id)) {
      const index = new Map()
      for (const c of cardsOf(setId)) { const k = norm(valueOfMatch(c, matchSlug)); if (k !== '' && !index.has(k)) index.set(k, c) }
      indexes.set(id, index)
    }
    return indexes.get(id).get(norm(key)) ?? null
  }

  /** What a Lookup field shows for a card whose own values are `values`: '' when the key is blank or no card matches. */
  function lookup(def, values, depth = 0) {
    const cfg = lookupOf(def)
    if (!cfg.set || !cfg.from || depth >= MAX_DEPTH) return ''
    const key = values[cfg.from]
    if (key == null || String(key).trim() === '') return ''
    const matchSlug = cfg.match || displayFieldOf(cfg.set)
    const showSlug = cfg.show || displayFieldOf(cfg.set)
    if (!matchSlug || !showSlug) return ''
    const found = find(cfg.set, matchSlug, key)
    if (!found) return ''
    if (showSlug === '@id') return found.card_code ?? ''
    const shown = defs(cfg.set).find(f => f.slug === showSlug)
    if (shown && (shown.type === 'lookup' || shown.type === 'formula')) return worked(found, depth + 1)[showSlug] ?? ''
    const v = found.stored[showSlug]
    return v == null ? '' : v
  }

  /** The Lookup values of a card, by field slug (only the fields of that kind). */
  function lookupsOf(card, stored = card.stored ?? JSON.parse(card.fields_json), depth = 0) {
    const out = {}
    for (const def of defs(card.set_id)) if (def.type === 'lookup') out[def.slug] = lookup(def, { ...stored, ...out }, depth)
    return out
  }

  /** Stored values with the Lookup and Formula fields filled in, as a template is drawn with them. */
  function worked(card, depth = 0, position = {}) {
    const stored = card.stored ?? JSON.parse(card.fields_json)
    const fieldDefs = defs(card.set_id)
    const input = plainValues({ ...stored, display_name: card.display_name, ...position }, richSlugsOf(fieldDefs))
    Object.assign(input, lookupsOf(card, stored, depth))
    for (const def of fieldDefs) if (def.type === 'formula') input[def.slug] = evaluateFormula(def.formula ?? '', input)
    return input
  }

  const orderOf = setId => {
    if (!orders.has(setId)) {
      const list = db.prepare('SELECT id FROM cards WHERE set_id = ? AND deleted = 0 ORDER BY sort_order').all(setId)
      orders.set(setId, { index: new Map(list.map((r, i) => [r.id, i + 1])), count: list.length })
    }
    return orders.get(setId)
  }

  /**
   * Everything an expression about a card can name. `context: false` leaves out the card's position, which costs a look at the whole set
   * and is needed only by an expression that uses `card_number()` or `card_count()`.
   */
  function values(card, { context = true } = {}) {
    const o = context ? orderOf(card.set_id) : null
    const out = worked(card, 0, o ? { '@card.id': card.card_code ?? '', '@card.number': String(o.index.get(card.id) ?? ''), '@card.count': String(o.count) } : {})
    out.display_name = card.display_name
    out.quantity = String(card.quantity ?? 1)
    out.card_id = card.card_code ?? ''
    out.status = card.status ?? ''
    out.art_status = card.art_status ?? ''
    return out
  }

  return { defs, cardsOf, lookup, lookupsOf, worked, values, find }
}

/** Whether an expression needs the card's position (`card_number()`, `card_count()`, `@card.…`). */
export const needsContext = expr => /card_number|card_count|card_id|@card/.test(String(expr ?? ''))
