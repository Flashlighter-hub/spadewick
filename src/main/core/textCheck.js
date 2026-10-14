/**
 * The text check (PRD §16.9): every card is drawn through the text step (no pictures are made) and what went wrong is
 * collected, with the cards it affects. Problems are grouped, so a missing icon used on two hundred cards is one line
 * that lists the cards, not two hundred lines. The print preflight (a later phase) reuses this.
 *
 *   type           severity
 *   missingIcon    error     an icon that does not exist or whose picture is gone: a box is drawn
 *   missingGlyph   error     a character no font has: a missing-glyph box
 *   noFit          error     shrink-to-fit reached its minimum size and the text still does not fit its box
 *   fontForbids    error / warning  a project font whose own flag forbids embedding (or allows only preview and print)
 *   markup         warning   unmatched markup, an invalid value, an unknown text style
 *   ambiguousAlias warning   an alias that two icons share
 *   native         info      a text the engine left to the rasterizer (a feature it does not draw)
 *   cardError      error     a card that could not be drawn at all
 */
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { dbOf, dirOf } from './context.js'
import { buildCardSvg, effectiveTemplateId, effectiveBackTemplateId } from '../render.js'
import { drawsTheSameOnEveryCard } from './export.js'
import { iconLookup } from './icons.js'
import { readEmbeddingFlags } from '../fontFiles.js'

const SEVERITY = { missingIcon: 'error', missingGlyph: 'error', noFit: 'error', fontForbids: 'error', markup: 'warning', ambiguousAlias: 'warning', native: 'info', cardError: 'error' }
const MAX_CARDS_LISTED = 200

/**
 * @param {{ setIds?: string[], cardIds?: string[], backs?: boolean, onReport?: (card: object, info: object, report: object) => void }} [opts] only these sets (default: all); `onReport` sees what the text step saw on each card (the print preflight reads text sizes and extents from it); the card backs are checked too unless `backs` is false (a back that looks the same on every card once)
 * @returns {Promise<{ checked: number, groups: object[], counts: { error: number, warning: number, info: number } }>}
 */
export async function run(ctx, opts) {
  opts ??= {}
  const d = dbOf(ctx), dir = dirOf(ctx)
  const setNames = new Map(d.prepare('SELECT id, name FROM sets').all().map(s => [s.id, s.name]))
  const templateNames = new Map(d.prepare('SELECT id, name FROM templates').all().map(t => [t.id, t.name]))
  const groups = new Map()

  const note = (type, detail, { card = null, template = null, element = null } = {}) => {
    const key = [type, JSON.stringify(detail), template?.id ?? '', element?.id ?? '', element?.field ?? ''].join('|')
    let g = groups.get(key)
    if (!g) { g = { type, severity: type === 'fontForbids' && detail.level === 'previewOnly' ? 'warning' : SEVERITY[type], detail, template, element, cards: [], count: 0 }; groups.set(key, g) }
    if (card) { g.count++; if (g.cards.length < MAX_CARDS_LISTED) g.cards.push(card) }
    else g.count = Math.max(g.count, 1)
  }

  const wanted = opts.setIds?.length ? new Set(opts.setIds) : null
  const only = opts.cardIds?.length ? new Set(opts.cardIds) : null
  const cards = d.prepare('SELECT * FROM cards WHERE deleted = 0 ORDER BY set_id, sort_order').all().filter(c => (!wanted || wanted.has(c.set_id)) && (!only || only.has(c.id)))
  let checked = 0
  const noteItems = (report, info) => {
    for (const item of report.items ?? []) {
      const { type, where, ...rest } = item
      const detail = type === 'markup' ? { problem: rest.problem, text: rest.text } : type === 'missingGlyph' ? { char: rest.char, code: rest.char.codePointAt(0) }
        : type === 'missingIcon' ? { name: rest.name } : type === 'noFit' ? { size: rest.size, min: rest.min } : { reason: rest.reason }
      note(type, detail, { ...info, element: where })
    }
  }
  const backsDone = new Set()                          // a back that looks the same on every card is checked once
  for (const card of cards) {
    const templateId = effectiveTemplateId(d, card)
    const cardInfo = { id: card.id, name: card.display_name, set: setNames.get(card.set_id) ?? '' }
    if (templateId) {
      const info = { card: cardInfo, template: { id: templateId, name: templateNames.get(templateId) ?? '' } }
      const report = {}
      try { await buildCardSvg(dir, card.id, { report, textEngine: 'outlines' }) } catch (err) { note('cardError', { message: err.message }, info); continue }
      opts.onReport?.(card, info, report)
      noteItems(report, info)
    }
    const backId = opts.backs === false ? null : effectiveBackTemplateId(d, card)
    if (backId && (!backsDone.has(backId) || !drawsTheSameOnEveryCard(d, backId))) {
      backsDone.add(backId)
      const info = { card: cardInfo, template: { id: backId, name: templateNames.get(backId) ?? '' }, side: 'back' }
      const report = {}
      try { await buildCardSvg(dir, card.id, { report, textEngine: 'outlines', side: 'back' }) } catch (err) { note('cardError', { message: err.message }, info); continue }
      opts.onReport?.(card, info, report)
      noteItems(report, info)
    }
    if (++checked % 25 === 0) await new Promise(r => setImmediate(r)) // let the window breathe in a big project
  }

  // Facts about the project's library and fonts, which no single card owns
  const { ambiguous } = iconLookup(d.prepare('SELECT * FROM icons').all())
  const iconNames = new Map(d.prepare('SELECT id, name FROM icons').all().map(r => [r.id, r.name]))
  for (const [alias, ids] of ambiguous) note('ambiguousAlias', { alias, icons: ids.map(id => iconNames.get(id)) })
  const templateText = [...templateNames.keys()].map(id => d.prepare('SELECT svg_source FROM templates WHERE id = ?').get(id).svg_source).join('\n').toLowerCase()
  for (const f of d.prepare('SELECT family_name, style, filename FROM fonts').all()) {
    if (!templateText.includes(f.family_name.toLowerCase())) continue // only a font a template uses has to be embeddable
    const file = join(dir, 'fonts', f.filename)
    const flags = existsSync(file) ? readEmbeddingFlags(readFileSync(file)) : null
    if (flags?.restricted) note('fontForbids', { family: f.family_name, style: f.style, level: 'restricted' })
    else if (flags?.previewOnly) note('fontForbids', { family: f.family_name, style: f.style, level: 'previewOnly' })
  }

  const list = [...groups.values()].sort((a, b) => ['error', 'warning', 'info'].indexOf(a.severity) - ['error', 'warning', 'info'].indexOf(b.severity) || a.type.localeCompare(b.type))
  const counts = { error: 0, warning: 0, info: 0 }
  for (const g of list) counts[g.severity]++
  return { checked, groups: list, counts }
}
