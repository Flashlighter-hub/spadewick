/**
 * Balance and set statistics (UPDATES U22): the counts, the summary and the warnings for one set, worked out from its cards' data. Nothing is
 * stored: a number is read from the table each time, so it is never out of date.
 */
import { dbOf } from './context.js'
import { createResolver, needsContext } from './values.js'
import { evaluateFormula, isTruthy } from '../formula.js'
import { distribution, summarize, findWarnings, kindOf } from '../../shared/stats.js'
import { STATUSES, ART_STATUSES } from '../../shared/fieldTypes.js'
import { tr } from '../../shared/i18n.js'

const CHARTABLE = new Set(['text', 'number', 'boolean', 'color', 'formula', 'choice', 'tags', 'lookup'])

/** The set's fields as the statistics see them: its own, then the built-in columns the set uses. */
function fieldsOf(d, set, resolver) {
  const own = resolver.defs(set.id).map(f => ({ slug: f.slug, name: f.name, type: f.type, validation: f.validation, formula: f.formula, hidden: !!f.hidden }))
  const built = [{ slug: 'quantity', name: tr('balance.quantity'), type: 'number', validation: null, builtIn: true }]
  if (set.status_mode >= 1) built.push({ slug: 'status', name: tr('balance.status'), type: 'choice', validation: JSON.stringify({ options: STATUSES }), builtIn: true })
  if (set.status_mode >= 2) built.push({ slug: 'art_status', name: tr('balance.artStatus'), type: 'choice', validation: JSON.stringify({ options: ART_STATUSES }), builtIn: true })
  return { own, all: [...own, ...built] }
}

/**
 * @param {{ setId: string, by?: string, split?: string, copies?: boolean, filter?: string, unique?: string[] }} opts
 *   by: the field to count by (default: the first number field, else the first field); split: a second field to divide each group by;
 *   copies: count each card as many times as its quantity; filter: look only at the cards an expression keeps (a saved view's filter);
 *   unique: more fields to check for duplicates (the display name and the identifier are always checked).
 */
export function balance(ctx, { setId, by, split, copies = false, filter, unique = [] }) {
  const d = dbOf(ctx)
  const set = d.prepare('SELECT * FROM sets WHERE id = ?').get(setId)
  if (!set) throw new Error(tr('errors.setNotFound'))
  const resolver = createResolver(d)
  const { own, all } = fieldsOf(d, set, resolver)

  let cards = resolver.cardsOf(setId)
  const text = String(filter ?? '').trim()
  if (text) {
    const probe = evaluateFormula(text, {})
    if (String(probe).startsWith('#ERR')) throw new Error(tr('errors.invalidCardFilter', { detail: String(probe).slice(6) }))
    const context = needsContext(text)
    cards = cards.filter(c => isTruthy(evaluateFormula(text, resolver.values(c, { context }))))
  }
  const rows = cards.map(c => ({ id: c.id, name: c.display_name || c.card_code || '', quantity: c.quantity ?? 1, values: resolver.values(c, { context: false }) }))

  const chartable = all.filter(f => CHARTABLE.has(f.type)).map(f => ({ slug: f.slug, name: f.name, type: f.type, kind: kindOf(f, rows) }))
  const bySlug = new Map(all.map(f => [f.slug, f]))
  const defaultBy = chartable.find(f => f.kind === 'number' && !f.slug.startsWith('quantity'))?.slug ?? chartable.find(f => f.slug !== 'quantity')?.slug ?? chartable[0]?.slug ?? null
  const byField = bySlug.get(by && chartable.some(f => f.slug === by) ? by : defaultBy)
  const splitField = split && split !== byField?.slug && chartable.some(f => f.slug === split) ? bySlug.get(split) : null

  const dupes = [...new Set([set.display_field, set.identifier_field, ...unique].filter(s => s && bySlug.has(s)))]
  const warned = findWarnings(rows, all, { unique: dupes, required: [set.display_field, set.identifier_field].filter(Boolean) })

  return {
    setName: set.name,
    cardCount: rows.length,
    copyCount: rows.reduce((n, r) => n + Math.max(0, r.quantity), 0),
    fields: chartable,
    by: byField?.slug ?? null,
    split: splitField?.slug ?? null,
    chart: byField ? { name: byField.name, splitName: splitField?.name ?? null, ...distribution(rows, byField, { split: splitField, copies }) } : null,
    summary: summarize(rows, own.filter(f => f.type !== 'image_ref' && f.type !== 'rich_text')),
    warnings: warned.warnings,
    warningCount: warned.count,
    checkedForDuplicates: dupes
  }
}
