/**
 * The virtual table's services (PRD §7.9): what a table can be made from (the cards of the project's sets, with what each card's back
 * is), and saved tables, which are files in the project's `tables` folder (a table is a game laid out, not project data: it is not
 * part of a snapshot, and no schema holds it).
 *
 * The table itself, and every move made on it, is in src/shared/table.js; this file only reads the project and the folder.
 */
import { join } from 'path'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync, statSync } from 'fs'
import { tr } from '../../shared/i18n.js'
import { readTable } from '../../shared/table.js'
import { effectiveBackTemplateId } from '../render.js'
import { getCardSize } from '../cardSize.js'
import { drawsTheSameOnEveryCard } from './export.js'
import sharp from 'sharp'
import { dbOf, dirOf } from './context.js'

const MAX_FILE_BYTES = 20 * 1024 * 1024
const folderOf = ctx => join(dirOf(ctx), 'tables')
const slugOf = name => String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)

/**
 * The decks a table can be made from: one for each set, with its cards (and how many of each) and, for each card, the key of its back:
 * the back template when the back looks the same on every card, the template and the card when it shows the card's own data, `null`
 * when the card has no back. Cards that share a key share a picture of the back.
 * @returns {{ id: string, name: string, size: { mmW: number, mmH: number }, cards: { id: string, name: string, code: string, quantity: number, backKey: string|null }[] }[]}
 */
/** The key of a card's back (see `cards`); `staticBack` remembers which back templates look the same on every card. */
function backKeyOf(d, card, staticBack) {
  const backId = effectiveBackTemplateId(d, card)
  if (!backId) return null
  if (!staticBack.has(backId)) staticBack.set(backId, drawsTheSameOnEveryCard(d, backId))
  return staticBack.get(backId) ? backId : `${backId}:${card.id}`
}

/**
 * What the project says now about some cards (UPDATES U6): their name, ID and back, or that they are gone. The table asks when the
 * project's change signal names cards, and updates what it shows.
 * @returns {Object<string, { name: string, code: string, backKey: string|null, missing: boolean }>} by card id
 */
export function cardInfo(ctx, { ids } = {}) {
  const d = dbOf(ctx)
  const staticBack = new Map()
  const out = {}
  for (const id of [...new Set(Array.isArray(ids) ? ids : [])].slice(0, 5000)) {
    const c = d.prepare('SELECT * FROM cards WHERE id = ?').get(id)
    out[id] = !c || c.deleted ? { name: '', code: '', backKey: null, missing: true }
      : { name: c.display_name || c.card_code || '', code: c.card_code ?? '', backKey: backKeyOf(d, c, staticBack), missing: false }
  }
  return out
}

export function cards(ctx, { setIds } = {}) {
  const d = dbOf(ctx)
  const wanted = Array.isArray(setIds) && setIds.length ? new Set(setIds) : null
  const sets = d.prepare('SELECT * FROM sets ORDER BY sort_order').all().filter(s => !wanted || wanted.has(s.id))
  return sets.map(set => {
    const size = getCardSize(d, set.id)
    const staticBack = new Map()
    const rows = d.prepare('SELECT * FROM cards WHERE set_id = ? AND deleted = 0 ORDER BY sort_order').all(set.id)
    return {
      id: set.id, name: set.name, size: { mmW: size.mmW, mmH: size.mmH }, hasTemplate: !!(set.default_template_id || rows.some(c => c.template_id)),
      cards: rows.map(c => {
        return { id: c.id, name: c.display_name || c.card_code || '', code: c.card_code ?? '', quantity: c.quantity ?? 1, backKey: backKeyOf(d, c, staticBack) }
      })
    }
  })
}

/**
 * A picture of an image of the library for a guest of a shared table (PRD §22.0): a round token shows it. Made small (at most `width` pixels
 * on a side) and as a PNG, whatever the file was, so a guest is sent a few kilobytes and never the file itself.
 * @returns {Promise<{ mime: string, data: string } | null>} `data` in base64; null when the image is gone or is not a picture
 */
export async function assetPicture(ctx, { id, width } = {}) {
  const row = dbOf(ctx).prepare('SELECT filename, mime_type FROM assets WHERE id = ?').get(String(id ?? ''))
  if (!row || !/^image\/(png|jpeg|webp|svg\+xml)$/.test(row.mime_type)) return null
  const file = join(dirOf(ctx), 'assets', row.filename)
  if (!existsSync(file)) return null
  const side = Math.min(600, Math.max(40, Math.round(Number(width) || 300)))
  try {
    const bytes = await sharp(file, row.mime_type === 'image/svg+xml' ? { density: 144 } : {}).resize(side, side, { fit: 'inside' }).png().toBuffer()
    return { mime: 'image/png', data: bytes.toString('base64') }
  } catch { return null }
}

/** The saved tables of the project, newest first: { id, name, saved, cards }. */
export function list(ctx) {
  const dir = folderOf(ctx)
  if (!existsSync(dir)) return []
  const out = []
  for (const file of readdirSync(dir).filter(f => f.endsWith('.json'))) {
    try {
      const raw = JSON.parse(readFileSync(join(dir, file), 'utf8'))
      out.push({ id: file.slice(0, -5), name: String(raw.name ?? file), saved: Number(raw.saved) || statSync(join(dir, file)).mtimeMs, cards: Object.keys(raw.state?.cards ?? {}).length })
    } catch { /* a file that is not a table is not listed */ }
  }
  return out.sort((a, b) => b.saved - a.saved)
}

/**
 * Save a table. With `id` it replaces that saved table; without, it is a new one, named so that no other saved table has its file.
 * @returns {{ id: string, name: string }}
 */
export function save(ctx, { id, name, state, log }) {
  const table = readTable(JSON.parse(JSON.stringify(state ?? null)))
  if (table.error) throw new Error(tr('errors.tableInvalid'))
  const title = String(name ?? '').trim().slice(0, 80)
  if (!title) throw new Error(tr('errors.tableNameEmpty'))
  const dir = folderOf(ctx)
  mkdirSync(dir, { recursive: true })
  let file = id && /^[a-z0-9-]+$/.test(id) ? id : slugOf(title) || 'table'
  if (!id) { const base = file; let n = 2; while (existsSync(join(dir, `${file}.json`))) file = `${base}-${n++}` }
  const body = JSON.stringify({ name: title, saved: Date.now(), state: table, log: Array.isArray(log) ? log.slice(-2000) : [] })
  if (body.length > MAX_FILE_BYTES) throw new Error(tr('errors.tableTooBig'))
  writeFileSync(join(dir, `${file}.json`), body)
  return { id: file, name: title }
}

/** A saved table: its name and state (checked: a file that was changed by hand into nonsense is refused), and the log of what was done. */
export function load(ctx, id) {
  if (!/^[a-z0-9-]+$/.test(String(id))) throw new Error(tr('errors.tableNotFound'))
  const file = join(folderOf(ctx), `${id}.json`)
  if (!existsSync(file)) throw new Error(tr('errors.tableNotFound'))
  if (statSync(file).size > MAX_FILE_BYTES) throw new Error(tr('errors.tableTooBig'))
  let raw
  try { raw = JSON.parse(readFileSync(file, 'utf8')) } catch { throw new Error(tr('errors.tableInvalid')) }
  const state = readTable(raw.state)
  if (state.error) throw new Error(tr('errors.tableInvalid'))
  // the pictures come from the project: a card that was deleted since is told apart here, so the table can still be opened
  const d = dbOf(ctx)
  const gone = [...new Set(Object.values(state.cards).map(c => c.id))].filter(cid => !d.prepare('SELECT 1 FROM cards WHERE id = ? AND deleted = 0').get(cid))
  return { id, name: String(raw.name ?? id), state, log: Array.isArray(raw.log) ? raw.log : [], missingCards: gone }
}

export function remove(ctx, id) {
  if (!/^[a-z0-9-]+$/.test(String(id))) return
  rmSync(join(folderOf(ctx), `${id}.json`), { force: true })
}
