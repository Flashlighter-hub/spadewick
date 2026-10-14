/**
 * A card's own instance of its template (UPDATES U29): what the canvas editor needs to edit one card's version of the template, and
 * the keeping of what was changed (the patch: see main/instance.js). The template itself is never touched here.
 */
import { recordChange, rowOf, changesFor } from './history.js'
import { effectiveTemplateId } from '../render.js'
import { diffInstance, applyInstance, readPatch } from '../instance.js'
import { SvgParseError } from '../svgImport/xml.js'
import { tr } from '../../shared/i18n.js'
import { dbOf } from './context.js'

function cardAndTemplate(d, cardId) {
  const card = d.prepare('SELECT * FROM cards WHERE id = ?').get(cardId)
  if (!card) throw new Error(tr('errors.cardNotFound'))
  const templateId = effectiveTemplateId(d, card)
  const template = templateId ? d.prepare('SELECT * FROM templates WHERE id = ?').get(templateId) : null
  if (!template) throw new Error(tr('errors.instanceNoTemplate'))
  return { card, template }
}

/** The template a card is drawn with and the source to edit for this card: the template's own with the card's changes on it. */
export function get(ctx, { cardId }) {
  const d = dbOf(ctx)
  const { card, template } = cardAndTemplate(d, cardId)
  const patch = readPatch(card.instance_json)
  return {
    cardId, templateId: template.id, templateName: template.name,
    hasInstance: !!patch,
    changes: patch ? (patch.set?.length ?? 0) + (patch.remove?.length ?? 0) + (patch.add?.length ?? 0) : 0,
    base: template.svg_source,
    source: patch ? applyInstance(template.svg_source, patch) : template.svg_source
  }
}

/**
 * Keep the card's version of the template: the source the person edited is compared with the template and only the difference is kept.
 * A source that is the template again clears the card's changes. Returns the same as `get` (with the new state).
 */
export function save(ctx, { cardId, source }) {
  const d = dbOf(ctx)
  const { card, template } = cardAndTemplate(d, cardId)
  let patch
  try { patch = diffInstance(template.svg_source, String(source ?? '')) } catch (err) {
    if (err instanceof SvgParseError) throw new Error(tr('errors.instanceNotSvg', { reason: err.message }))
    throw err
  }
  const before = rowOf(d, 'cards', cardId)
  d.prepare('UPDATE cards SET instance_json = ?, updated_at = ? WHERE id = ?').run(patch ? JSON.stringify(patch) : null, Date.now(), cardId)
  recordChange(d, 'UPDATE_CARD_INSTANCE', changesFor(d, 'cards', [before]))
  return get(ctx, { cardId: card.id })
}

/** Put the card back to exactly the template. */
export function reset(ctx, { cardId }) {
  const d = dbOf(ctx)
  const before = rowOf(d, 'cards', cardId)
  if (!before) throw new Error(tr('errors.cardNotFound'))
  d.prepare('UPDATE cards SET instance_json = NULL, updated_at = ? WHERE id = ?').run(Date.now(), cardId)
  recordChange(d, 'RESET_CARD_INSTANCE', changesFor(d, 'cards', [before]))
}

/** How many cards of a set have a version of their own, and which. */
export function list(ctx, { setId }) {
  return dbOf(ctx).prepare('SELECT id FROM cards WHERE set_id = ? AND deleted = 0 AND instance_json IS NOT NULL').all(setId).map(r => r.id)
}
