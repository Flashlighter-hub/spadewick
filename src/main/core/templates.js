import { randomUUID } from 'crypto'
import { recordChange, rowOf, changesFor } from './history.js'
import { renderCard, buildCardSvg } from '../render.js'
import { tr } from '../../shared/i18n.js'
import { upgradeLegacyMarkup } from '../../shared/legacy.js'
import { wrapChildFragment } from '../../shared/templateChild.js'
import { canvasChange } from '../../shared/templateCanvas.js'
import { normalizeCardSize, sizeColumns, sizeOfRow, sameCardSize } from '../cardSize.js'
import { backSvg } from '../../shared/backDesigns.js'
import { dbOf, dirOf } from './context.js'
import { logError } from '../log.js'
import { readRules } from '../templateRules.js'
import { bundledFontsDir } from '../fontFiles.js'
import { existsSync } from 'fs'
import { join } from 'path'

export function list(ctx, opts) {
  const d = dbOf(ctx)
  const rows = d.prepare(`SELECT id, name, parent_id, card_size, card_mm_w, card_mm_h, bleed_mm, bleed_mode, bleed_color, created_at, updated_at,
      (SELECT COUNT(*) FROM sets WHERE default_back_template_id = templates.id) AS back_of_sets,
      (SELECT COUNT(*) FROM cards WHERE back_template_id = templates.id AND deleted = 0) AS back_of_cards
    FROM templates ORDER BY name`).all()
  if (!opts?.setId) return rows
  const set = d.prepare('SELECT card_size, card_mm_w, card_mm_h FROM sets WHERE id = ?').get(opts.setId)
  return set ? rows.filter(t => sameCardSize(sizeOfRow(t), sizeOfRow(set))) : rows
}

export function get(ctx, id) {
  const d = dbOf(ctx)
  const row = d.prepare('SELECT * FROM templates WHERE id = ?').get(id)
  if (!row) return row
  // A child made before children were documents of their own is opened as one; saving keeps it that way
  const parent = row.parent_id ? d.prepare('SELECT svg_source FROM templates WHERE id = ?').get(row.parent_id) : null
  return { ...row, svg_source: wrapChildFragment(upgradeLegacyMarkup(row.svg_source), parent?.svg_source) }
}

export function create(ctx, { name, parentId, svgSource, cardSize, cardMmW, cardMmH, bleedMm, bleedMode, bleedColor }) {
  checkBleed({ bleedMm, bleedMode, bleedColor })
  const d = dbOf(ctx)
  const id = randomUUID()
  const now = Date.now()
  const parent = parentId ? d.prepare('SELECT * FROM templates WHERE id = ?').get(parentId) : null
  const size = parent ? sizeOfRow(parent) : normalizeCardSize({ cardSize, cardMmW, cardMmH })
  d.prepare(
    'INSERT INTO templates (id, name, parent_id, svg_source, card_size, card_mm_w, card_mm_h, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, name, parentId ?? null, upgradeLegacyMarkup(svgSource ?? ''), ...sizeColumns(size), now, now)
  if (bleedMm !== undefined || bleedMode !== undefined || bleedColor !== undefined) d.prepare('UPDATE templates SET bleed_mm = ?, bleed_mode = ?, bleed_color = ? WHERE id = ?').run(Number(bleedMm ?? 0), bleedMode ?? 'extend', bleedColor ?? null, id)
  recordChange(d, 'CREATE_TEMPLATE', [{ table: 'templates', before: null, after: rowOf(d, 'templates', id) }])
  return d.prepare('SELECT * FROM templates WHERE id = ?').get(id)
}

const BLEED_MODES = ['included', 'extend', 'fill']

/** The template's bleed (PRD §17.4): what its canvas includes, or how the edge is carried into the bleed. */
function checkBleed({ bleedMm, bleedMode, bleedColor }) {
  if (bleedMm !== undefined && !(Number(bleedMm) >= 0 && Number(bleedMm) <= 20)) throw new Error(tr('errors.templateBleed'))
  if (bleedMode !== undefined && !BLEED_MODES.includes(bleedMode)) throw new Error(tr('errors.templateBleed'))
  if (bleedColor !== undefined && bleedColor !== null && !/^#[0-9a-f]{6}$/i.test(bleedColor)) throw new Error(tr('errors.templateBleed'))
}

export function update(ctx, { id, name, svgSource, cardSize, cardMmW, cardMmH, bleedMm, bleedMode, bleedColor }) {
  const d = dbOf(ctx)
  const before = rowOf(d, 'templates', id)
  if (!before) throw new Error(tr('errors.templateNotFound'))
  if (cardSize !== undefined && !sameCardSize(sizeOfRow(before), normalizeCardSize({ cardSize, cardMmW, cardMmH }))) throw new Error(tr('errors.templateSizeLocked'))
  checkBleed({ bleedMm, bleedMode, bleedColor })
  // the canvas is the card and is fixed when the template is made: elements may spill past it, but its view box and size are not edited
  const locked = svgSource !== undefined ? canvasChange(before.svg_source, upgradeLegacyMarkup(svgSource)) : null
  if (locked) throw new Error(tr('errors.templateCanvasLocked', locked))
  const now = Date.now()
  if (bleedMm !== undefined)   d.prepare('UPDATE templates SET bleed_mm = ?, updated_at = ? WHERE id = ?').run(Number(bleedMm), now, id)
  if (bleedMode !== undefined) d.prepare('UPDATE templates SET bleed_mode = ?, updated_at = ? WHERE id = ?').run(bleedMode, now, id)
  if (bleedColor !== undefined) d.prepare('UPDATE templates SET bleed_color = ?, updated_at = ? WHERE id = ?').run(bleedColor, now, id)
  if (name !== undefined)      d.prepare('UPDATE templates SET name = ?, updated_at = ? WHERE id = ?').run(name, now, id)
  if (svgSource !== undefined) d.prepare('UPDATE templates SET svg_source = ?, updated_at = ? WHERE id = ?').run(upgradeLegacyMarkup(svgSource), now, id)
  recordChange(d, 'UPDATE_TEMPLATE', changesFor(d, 'templates', [before]))
  return d.prepare('SELECT * FROM templates WHERE id = ?').get(id)
}

export function remove(ctx, id) {
  const d = dbOf(ctx)
  const before = rowOf(d, 'templates', id)
  if (!before) return
  d.transaction(() => {
    // Cards keep working if the template comes back, so only detach them for now
    const users = d.prepare('SELECT id FROM cards WHERE template_id = ?').all(id).map(r => r.id)
    const cardBefores = users.map(cid => rowOf(d, 'cards', cid))
    d.prepare('UPDATE cards SET template_id = NULL WHERE template_id = ?').run(id)
    // A card back that goes: the cards and sets that used it have no back until another is chosen (PRD §7.8)
    const backUsers = d.prepare('SELECT id FROM cards WHERE back_template_id = ?').all(id).map(r => r.id).filter(cid => !users.includes(cid))
    const backBefores = backUsers.map(cid => rowOf(d, 'cards', cid))
    const setBefores = d.prepare('SELECT id FROM sets WHERE default_back_template_id = ?').all(id).map(r => rowOf(d, 'sets', r.id))
    d.prepare('UPDATE cards SET back_template_id = NULL WHERE back_template_id = ?').run(id)
    d.prepare('UPDATE sets SET default_back_template_id = NULL WHERE default_back_template_id = ?').run(id)
    // A template that goes also leaves the rules of the sets that used it (UPDATES U24); a rule left with no template goes too
    const ruleSets = d.prepare('SELECT id, template_rules FROM sets WHERE template_rules IS NOT NULL').all().filter(r => readRules(r).some(x => x.front === id || x.back === id))
    const ruleBefores = ruleSets.map(r => rowOf(d, 'sets', r.id))
    for (const r of ruleSets) {
      const kept = readRules(r).map(x => ({ when: x.when, front: x.front === id ? null : x.front, back: x.back === id ? null : x.back })).filter(x => x.front || x.back)
      d.prepare('UPDATE sets SET template_rules = ? WHERE id = ?').run(kept.length ? JSON.stringify(kept) : null, r.id)
    }
    d.prepare('UPDATE templates SET parent_id = NULL WHERE parent_id = ?').run(id)
    d.prepare('DELETE FROM templates WHERE id = ?').run(id)
    recordChange(d, 'DELETE_TEMPLATE', [
      ...changesFor(d, 'sets', ruleBefores),
      ...changesFor(d, 'cards', cardBefores),
      ...changesFor(d, 'cards', backBefores),
      ...changesFor(d, 'sets', setBefores),
      { table: 'templates', before, after: null }
    ])
  })()
}

/**
 * What the text step found when it drew one card with the given (maybe unsaved) template source: for each text element
 * whether it fitted, and the problems (PRD §16.6: a visible indicator when text hits its minimum size and still does not fit).
 * @returns {Promise<{ fits: object[], items: object[] }>}
 */
export async function textReport(ctx, { cardId, svgSource, templateId }) {
  const report = {}
  try { await buildCardSvg(dirOf(ctx), cardId, { report, templateId, svgSource, textEngine: 'outlines' }) } catch (err) { throw explain(ctx, err, { cardId, templateId, svgSource }) }
  return { fits: report.fits ?? [], items: report.items ?? [] }
}

/**
 * A render that failed: the error is logged once more, with what it was drawing (the card, the template, the text elements with their
 * fonts, and whether the fonts that come with the application are there), so that a failure that cannot be repeated can still be understood
 * from the log. The error itself goes on unchanged.
 */
function explain(ctx, err, { cardId, templateId, svgSource }) {
  try {
    const d = dbOf(ctx)
    const card = d.prepare('SELECT card_code, set_id, template_id, fields_json FROM cards WHERE id = ?').get(String(cardId ?? ''))
    const dir = bundledFontsDir()
    const texts = [...String(svgSource ?? '').matchAll(/<text\b([^>]*)>/g)].map(m => m[1].replace(/\s+/g, ' ').slice(0, 260)).slice(0, 12)
    logError('templates:render:context', JSON.stringify({
      card: card ? { code: card.card_code, template: card.template_id, fields: Object.fromEntries(Object.entries(JSON.parse(card.fields_json)).map(([k, v]) => [k, typeof v === 'string' ? v.slice(0, 60) : v])) } : null,
      templateId, svgLength: String(svgSource ?? '').length, texts,
      bundledFontsDir: dir, bundledFontsPresent: existsSync(join(dir, 'LiberationSans-Regular.ttf')),
      projectFonts: d.prepare('SELECT family_name, style, filename FROM fonts').all(),
      message: err?.message
    }))
  } catch { /* the log must never hide the error it is about */ }
  return err
}

export async function render(ctx, { cardId, width, height, templateId, svgSource, side }) {
  let pngBuffer
  try { pngBuffer = await renderCard(dirOf(ctx), cardId, { width, height, templateId, svgSource, side }) } catch (err) { throw explain(ctx, err, { cardId, templateId, svgSource }) }
  // Return as base64 string — clean to transfer over IPC, easy to use as data URI
  return pngBuffer.toString('base64')
}


/**
 * Make the template's canvas include `bleedMm` of bleed on every side (PRD §17.4): the content keeps its place relative to the trim
 * (it is wrapped in a group moved by the bleed), the canvas grows, and the template is marked as including bleed. Returns the source;
 * the caller stores it.
 */
export function widenForBleed(svgSource, trimMmW, bleedMm) {
  const m = /<svg\b([^>]*)>/.exec(svgSource)
  if (!m) throw new Error(tr('errors.templateBleed'))
  const attrs = m[1]
  const vb = /viewBox\s*=\s*"([^"]*)"/.exec(attrs)?.[1].trim().split(/[\s,]+/).map(Number)
  if (!vb || vb.length !== 4 || !(vb[2] > 0)) throw new Error(tr('errors.templateBleed'))
  const unit = vb[2] / trimMmW              // template units per millimetre
  const b = Math.round(bleedMm * unit * 1000) / 1000
  const w = vb[2] + 2 * b, h = vb[3] + 2 * b
  let head = attrs.replace(/viewBox\s*=\s*"[^"]*"/, `viewBox="0 0 ${w} ${h}"`)
  head = head.replace(/\swidth\s*=\s*"[^"]*"/, ` width="${Math.round(w * 1000) / 1000}"`).replace(/\sheight\s*=\s*"[^"]*"/, ` height="${Math.round(h * 1000) / 1000}"`)
  const close = svgSource.lastIndexOf('</svg>')
  const inner = svgSource.slice(m.index + m[0].length, close)
  return `${svgSource.slice(0, m.index)}<svg${head}><g id="bleed-shift" transform="translate(${b - vb[0]} ${b - vb[1]})">${inner}</g></svg>${svgSource.slice(close + 6)}`
}

/**
 * Make the open template's canvas include bleed (PRD §17.4): the content keeps its place relative to the trim and the template says
 * it includes `bleedMm`. One undo step. The caller reloads the template.
 */
export function addBleedToCanvas(ctx, { id, bleedMm }) {
  const d = dbOf(ctx)
  const before = rowOf(d, 'templates', id)
  if (!before) throw new Error(tr('errors.templateNotFound'))
  const mm = Number(bleedMm)
  if (!(mm > 0 && mm <= 20)) throw new Error(tr('errors.templateBleed'))
  if (before.bleed_mode === 'included' && Number(before.bleed_mm) > 0) throw new Error(tr('errors.templateHasBleed'))
  const source = widenForBleed(upgradeLegacyMarkup(before.svg_source), sizeOfRow(before).mmW, mm)
  d.prepare("UPDATE templates SET svg_source = ?, bleed_mm = ?, bleed_mode = 'included', updated_at = ? WHERE id = ?").run(source, mm, Date.now(), id)
  recordChange(d, 'ADD_TEMPLATE_BLEED', changesFor(d, 'templates', [before]))
  return d.prepare('SELECT * FROM templates WHERE id = ?').get(id)
}

/**
 * Make a card back for a set and make it the set's card back (PRD §7.8): a new template of the set's card size from one of the starting
 * designs, in one undoable step. The set's earlier back stays where it is, as a template.
 * @returns {{ template: object, set: object }}
 */
export function createBack(ctx, { setId, name, design, primary, accent }) {
  const d = dbOf(ctx)
  const before = rowOf(d, 'sets', setId)
  if (!before) throw new Error(tr('errors.setNotFound'))
  const size = sizeOfRow(before)
  const id = randomUUID()
  const now = Date.now()
  const title = String(name ?? '').trim() || tr('newBack.defaultName', { set: before.name })
  d.transaction(() => {
    d.prepare('INSERT INTO templates (id, name, parent_id, svg_source, card_size, card_mm_w, card_mm_h, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)')
      .run(id, title, backSvg(size, { design, primary, accent }), ...sizeColumns(size), now, now)
    d.prepare('UPDATE sets SET default_back_template_id = ?, updated_at = ? WHERE id = ?').run(id, now, setId)
  })()
  recordChange(d, 'CREATE_CARD_BACK', [{ table: 'templates', before: null, after: rowOf(d, 'templates', id) }, ...changesFor(d, 'sets', [before])])
  return { template: d.prepare('SELECT * FROM templates WHERE id = ?').get(id), set: d.prepare('SELECT * FROM sets WHERE id = ?').get(setId) }
}
