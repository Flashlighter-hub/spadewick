import { randomUUID } from 'crypto'
import { getCardSize, normalizeCardSize, sizeColumns, sizeOfRow, sameCardSize, withPixels } from '../cardSize.js'
import { clearHistory, recordChange, rowOf, changesFor } from './history.js'
import { newSetCode, checkSetCode } from '../cardIds.js'
import { normalizeSetCode } from '../../shared/cardIds.js'
import { tr } from '../../shared/i18n.js'
import { dbOf } from './context.js'
import { announce } from './changes.js'
import { evaluateFormula } from '../formula.js'
import { readRules, ruleCounts } from '../templateRules.js'

const MAX_RULES = 50

/** The template rules of a set cleaned and checked before they are stored (UPDATES U24): each has an expression that can be read and templates that exist and fit the set. */
function cleanTemplateRules(d, setId, rules) {
  if (!Array.isArray(rules)) throw new Error(tr('errors.rulesNotList'))
  if (rules.length > MAX_RULES) throw new Error(tr('errors.tooManyRules', { max: MAX_RULES }))
  const out = []
  rules.forEach((raw, i) => {
    const when = String(raw?.when ?? '').trim().slice(0, 500)
    if (!when) throw new Error(tr('errors.ruleNeedsCondition', { n: i + 1 }))
    const probe = evaluateFormula(when, {})
    if (String(probe).startsWith('#ERR')) throw new Error(tr('errors.ruleInvalid', { n: i + 1, detail: String(probe).slice(6) }))
    const rule = { when, front: raw?.front || null, back: raw?.back || null }
    for (const id of [rule.front, rule.back]) {
      if (!id) continue
      if (!d.prepare('SELECT 1 FROM templates WHERE id = ?').get(id)) throw new Error(tr('errors.templateNotFoundId', { id }))
      assertTemplateFitsSet(d, id, setId)
    }
    out.push(rule)
  })
  return out
}

/** A template can only be used by a set of the same card size (PRD §10.6). */
export function assertTemplateFitsSet(d, templateId, setId) {
  const template = d.prepare('SELECT * FROM templates WHERE id = ?').get(templateId)
  const set = d.prepare('SELECT * FROM sets WHERE id = ?').get(setId)
  if (template && set && !sameCardSize(sizeOfRow(template), sizeOfRow(set))) throw new Error(tr('errors.templateSizeMismatch', { name: template.name }))
}

export function cardsizeGet(ctx, setId) {
  return getCardSize(dbOf(ctx), setId)
}

export function cardsizeResolve(ctx, size) {
  return withPixels(dbOf(ctx), normalizeCardSize(size))
}

export function sizeImpact(ctx, { id, cardSize, cardMmW, cardMmH }) {
  const d = dbOf(ctx)
  const size = normalizeCardSize({ cardSize, cardMmW, cardMmH })
  const set = d.prepare('SELECT * FROM sets WHERE id = ?').get(id)
  const mismatched = row => row && !sameCardSize(sizeOfRow(row), size)
  const def = set?.default_template_id ? d.prepare('SELECT * FROM templates WHERE id = ?').get(set.default_template_id) : null
  const back = set?.default_back_template_id ? d.prepare('SELECT * FROM templates WHERE id = ?').get(set.default_back_template_id) : null
  const cardTemplates = d.prepare('SELECT DISTINCT template_id FROM cards WHERE set_id = ? AND deleted = 0 AND template_id IS NOT NULL').all(id)
    .map(r => d.prepare('SELECT * FROM templates WHERE id = ?').get(r.template_id)).filter(mismatched)
  const cards = cardTemplates.length
    ? d.prepare(`SELECT COUNT(*) AS n FROM cards WHERE set_id = ? AND deleted = 0 AND template_id IN (${cardTemplates.map(() => '?').join(',')})`).get(id, ...cardTemplates.map(t => t.id)).n
    : 0
  return { same: sameCardSize(sizeOfRow(set), size), defaultTemplate: mismatched(def) ? def.name : null, cardBack: mismatched(back) ? back.name : null, cards, matchingTemplates: d.prepare('SELECT * FROM templates').all().filter(t => !mismatched(t)).length }
}

/**
 * What a list of template rules would do to the cards of a set, before it is saved (UPDATES U24): for each rule the number of cards it
 * decides, the cards no rule reaches (they use the set's default) and the cards with a template of their own.
 */
export function rulePreview(ctx, { setId, rules }) {
  const d = dbOf(ctx)
  const list = (Array.isArray(rules) ? rules : []).map(r => ({ when: String(r?.when ?? '').trim(), front: r?.front || null, back: r?.back || null }))
  return ruleCounts(d, setId, list)
}

export function list(ctx) {
  return dbOf(ctx).prepare('SELECT * FROM sets ORDER BY sort_order').all()
}

/**
 * `nameField` starts the set with an ordinary text field called Name, chosen as the display name (UPDATES U10); without it the set
 * has no fields at all and no display name until one is chosen.
 */
export function create(ctx, { name, description, cardSize, cardMmW, cardMmH, nameField }) {
  const d = dbOf(ctx)
  const size = normalizeCardSize({ cardSize, cardMmW, cardMmH })
  const id = randomUUID()
  const now = Date.now()
  const maxOrder = d.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM sets').get().m
  d.transaction(() => {
    d.prepare(
      'INSERT INTO sets (id, name, description, sort_order, created_at, updated_at, code, card_size, card_mm_w, card_mm_h, display_field) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, name, description ?? '', maxOrder + 1, now, now, newSetCode(d, name), ...sizeColumns(size), nameField ? 'name' : null)
    if (nameField) {
      d.prepare("INSERT INTO fields (id, set_id, name, slug, type, display_order, hidden, created_at) VALUES (?, ?, ?, 'name', 'text', 0, 0, ?)")
        .run(randomUUID(), id, tr('fieldManager.starterName'), now)
    }
  })()
  return d.prepare('SELECT * FROM sets WHERE id = ?').get(id)
}

/** A field of the set to use as a column that names cards or identifies them: it must be stored (not a formula) and exist (UPDATES U9, U10). */
function assertStoredField(d, setId, slug) {
  if (slug === null || slug === '') return null
  const f = d.prepare('SELECT type FROM fields WHERE set_id = ? AND slug = ?').get(setId, slug)
  if (!f) throw new Error(tr('errors.fieldNotFound'))
  if (f.type === 'formula' || f.type === 'lookup') throw new Error(tr('errors.fieldMustBeStored'))
  return slug
}

export function update(ctx, { id, name, description, code, cardSize, cardMmW, cardMmH, defaultTemplateId, defaultBackTemplateId, displayField, identifierField, templateRules, statusMode }) {
  const d = dbOf(ctx)
  const now = Date.now()
  // the field that names the cards (null: none) and the field that identifies them (null: none), UPDATES U9, U10
  if (displayField !== undefined) {
    const slug = assertStoredField(d, id, displayField)
    const before = rowOf(d, 'sets', id)
    d.prepare('UPDATE sets SET display_field = ?, updated_at = ? WHERE id = ?').run(slug, now, id)
    recordChange(d, 'UPDATE_SET_DISPLAY_FIELD', changesFor(d, 'sets', [before]))
  }
  if (identifierField !== undefined) {
    const slug = assertStoredField(d, id, identifierField)
    const before = rowOf(d, 'sets', id)
    d.prepare('UPDATE sets SET identifier_field = ?, updated_at = ? WHERE id = ?').run(slug, now, id)
    recordChange(d, 'UPDATE_SET_IDENTIFIER_FIELD', changesFor(d, 'sets', [before]))
  }
  if (templateRules !== undefined) {
    const rules = cleanTemplateRules(d, id, templateRules ?? [])
    const before = rowOf(d, 'sets', id)
    d.prepare('UPDATE sets SET template_rules = ?, updated_at = ? WHERE id = ?').run(rules.length ? JSON.stringify(rules) : null, now, id)
    recordChange(d, 'UPDATE_SET_TEMPLATE_RULES', changesFor(d, 'sets', [before]))
  }
  if (statusMode !== undefined) {
    const mode = Number(statusMode)
    if (![0, 1, 2].includes(mode)) throw new Error(tr('errors.badStatusMode'))
    const before = rowOf(d, 'sets', id)
    d.prepare('UPDATE sets SET status_mode = ?, updated_at = ? WHERE id = ?').run(mode, now, id)
    recordChange(d, 'UPDATE_SET_STATUS_MODE', changesFor(d, 'sets', [before]))
  }
  if (code !== undefined) {
    const clean = normalizeSetCode(code)
    const err = checkSetCode(d, id, clean)
    if (err) throw new Error(err)
    d.prepare('UPDATE sets SET code = ?, updated_at = ? WHERE id = ?').run(clean, now, id)   // existing card IDs are not rewritten
  }
  // cardSize: preset id | 'custom'. Changing it drops what no longer fits: a default template and cards' own
  // templates of another size (the cards themselves are never touched).
  if (cardSize !== undefined) {
    const size = normalizeCardSize({ cardSize, cardMmW, cardMmH })
    d.transaction(() => {
      d.prepare('UPDATE sets SET card_size = ?, card_mm_w = ?, card_mm_h = ?, updated_at = ? WHERE id = ?').run(...sizeColumns(size), now, id)
      const unfit = new Set(d.prepare('SELECT * FROM templates').all().filter(t => !sameCardSize(sizeOfRow(t), size)).map(t => t.id))
      const set = d.prepare('SELECT default_template_id, default_back_template_id, template_rules FROM sets WHERE id = ?').get(id)
      const kept = readRules(set).map(r => ({ when: r.when, front: r.front && !unfit.has(r.front) ? r.front : null, back: r.back && !unfit.has(r.back) ? r.back : null })).filter(r => r.front || r.back)
      d.prepare('UPDATE sets SET template_rules = ? WHERE id = ?').run(kept.length ? JSON.stringify(kept) : null, id)
      if (set?.default_template_id && unfit.has(set.default_template_id)) d.prepare('UPDATE sets SET default_template_id = NULL WHERE id = ?').run(id)
      if (set?.default_back_template_id && unfit.has(set.default_back_template_id)) d.prepare('UPDATE sets SET default_back_template_id = NULL WHERE id = ?').run(id)
      for (const tid of unfit) {
        d.prepare('UPDATE cards SET template_id = NULL WHERE set_id = ? AND template_id = ?').run(id, tid)
        d.prepare('UPDATE cards SET back_template_id = NULL WHERE set_id = ? AND back_template_id = ?').run(id, tid)
      }
    })()
  }
  if (defaultTemplateId !== undefined) {
    if (defaultTemplateId) assertTemplateFitsSet(d, defaultTemplateId, id)
    d.prepare('UPDATE sets SET default_template_id = ?, updated_at = ? WHERE id = ?').run(defaultTemplateId, now, id)
  }
  if (defaultBackTemplateId !== undefined) {
    if (defaultBackTemplateId) assertTemplateFitsSet(d, defaultBackTemplateId, id)
    d.prepare('UPDATE sets SET default_back_template_id = ?, updated_at = ? WHERE id = ?').run(defaultBackTemplateId, now, id)
  }
  if (name !== undefined) d.prepare('UPDATE sets SET name = ?, updated_at = ? WHERE id = ?').run(name, now, id)
  if (description !== undefined) d.prepare('UPDATE sets SET description = ?, updated_at = ? WHERE id = ?').run(description, now, id)
  announce({ all: true })
  return d.prepare('SELECT * FROM sets WHERE id = ?').get(id)
}

export function remove(ctx, id) {
  const d = dbOf(ctx)
  d.transaction(() => {
    d.prepare('DELETE FROM sets WHERE id = ?').run(id)
    clearHistory(d) // earlier entries may refer to this set's cards and fields
  })()
  announce({ all: true })
}

export function reorder(ctx, orderedIds) {
  const d = dbOf(ctx)
  const stmt = d.prepare('UPDATE sets SET sort_order = ? WHERE id = ?')
  d.transaction(() => {
    orderedIds.forEach((id, idx) => stmt.run(idx, id))
  })()
}

