/**
 * Template rules (UPDATES U24): "cards where skill_type == 'P' use the passive template". A set keeps an ordered list of
 * { when, front, back }: `when` is an expression in the formula language (as an export filter is), `front` and `back` are template ids
 * or null. A card's own template wins; then the first rule whose `when` is true for the card and that names a template for that side;
 * then the set's default. A rule that cannot be worked out (an error in the expression) matches no card.
 */
import { evaluateFormula, isTruthy } from './formula.js'
import { createResolver, needsContext } from './core/values.js'

/** The rules a set holds, as a clean list (a broken value reads as no rules). */
export function readRules(set) {
  let list
  try { list = typeof set?.template_rules === 'string' ? JSON.parse(set.template_rules) : set?.template_rules } catch { list = null }
  if (!Array.isArray(list)) return []
  return list
    .filter(r => r && typeof r === 'object')
    .map(r => ({ when: String(r.when ?? '').trim(), front: r.front || null, back: r.back || null }))
}

/** Whether `when` is true for the card whose worked-out values are `values`. An expression that fails counts as false. */
export function ruleMatches(when, values) {
  if (!when) return false
  const result = evaluateFormula(when, values)
  return !String(result).startsWith('#ERR') && isTruthy(result)
}

/** The template (of `side`: 'front' | 'back') the set's rules give a card, or null when no rule applies. */
export function ruleTemplate(db, card, set, side) {
  const rules = readRules(set).filter(r => r.when && r[side])
  if (!rules.length) return null
  const resolver = createResolver(db)
  const withContext = rules.some(r => needsContext(r.when))
  const values = resolver.values({ ...card, fields_json: card.fields_json ?? '{}' }, { context: withContext })
  for (const r of rules) {
    if (!ruleMatches(r.when, values)) continue
    if (db.prepare('SELECT 1 FROM templates WHERE id = ?').get(r[side])) return r[side]
  }
  return null
}

/** How many cards each rule is the one that decides (the first that matches), and how many no rule reaches: for the preview of the rules. */
export function ruleCounts(db, setId, rules) {
  const resolver = createResolver(db)
  const withContext = rules.some(r => needsContext(r.when))
  const counts = rules.map(() => 0)
  const errors = rules.map(r => { const probe = r.when ? evaluateFormula(r.when, {}) : ''; return String(probe).startsWith('#ERR') ? String(probe).slice(6) : null })
  let unmatched = 0, own = 0
  for (const card of resolver.cardsOf(setId)) {
    if (card.template_id) { own++; continue }
    const values = resolver.values(card, { context: withContext })
    const i = rules.findIndex(r => r.front && ruleMatches(r.when, values))
    if (i < 0) unmatched++; else counts[i]++
  }
  return { counts, unmatched, own, errors }
}
