import { randomUUID } from 'crypto'
import { readFileSync, writeFileSync } from 'fs'
import { basename } from 'path'
import { recordChange, rowOf } from './history.js'
import { evaluateFormula } from '../formula.js'
import { parseCsvDetailed, toCsv } from '../csv.js'
import { validateValue, validateQuantity } from '../../shared/validate.js'
import { tr } from '../../shared/i18n.js'
import { nextCardCode, syncCounters, noteCodes } from '../cardIds.js'
import { isReservedFieldName } from '../../shared/cardIds.js'
import { escapeMarkup } from '../../shared/richText.js'
import { dbOf, dirOf } from './context.js'
import { createResolver } from './values.js'
import { readXlsx, writeXlsx, MAX_ROWS } from '../xlsx.js'
import { STATUSES, ART_STATUSES, isComputed } from '../../shared/fieldTypes.js'

const IGNORE = '__ignore'
const NEW_FIELD = '__new'
const DISPLAY_NAME = 'display_name'
const QUANTITY = '__quantity'   // the built-in copies-per-card column (PRD §6.5)
const CARD_ID = '__card_id'     // the built-in card ID column (PRD §5.8)
const STATUS = '__status'       // the card status columns (UPDATES U26)
const ART_STATUS = '__art_status'
const FORMATS = { csv: ['csv'], json: ['json'], xlsx: ['xlsx'] }
const formatOfPath = path => (/\.json$/i.test(path) ? 'json' : /\.csv$/i.test(path) ? 'csv' : /\.xlsx$/i.test(path) ? 'xlsx' : null)

// The workbook last chosen, per project: switching to another sheet of it does not ask for the file again (and the window never names a path)
const workbooks = new Map()

/** A sheet of a workbook as headers and rows: the first non-blank row is the header; repeated headers get a number so no column is lost. */
function sheetTable(sheet) {
  const rows = sheet.rows
  const first = rows.findIndex(r => r.some(v => String(v).trim() !== ''))
  if (first < 0) return { headers: [], rows: [], issues: [] }
  const seen = new Map()
  const headers = rows[first].map(h => {
    const base = String(h ?? '').trim()
    if (base === '') return ''
    const n = (seen.get(base.toLowerCase()) ?? 0) + 1
    seen.set(base.toLowerCase(), n)
    return n === 1 ? base : `${base} (${n})`
  })
  const lastUsed = headers.reduce((m, h, i) => (h !== '' ? i : m), -1)
  const kept = headers.slice(0, lastUsed + 1)
  const data = rows.slice(first + 1).filter(r => r.some(v => String(v).trim() !== ''))
  return { headers: kept, rows: data.map(r => Object.fromEntries(kept.map((h, i) => [h, r[i] ?? '']))), issues: [] }
}

function slugify(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'field'
}

/**
 * Parse a CSV or JSON file into { headers, rows: [{header: value}], issues: [{ line, message }] }. The issues are the places where a CSV
 * breaks the CSV rules and so may have lost or run together cards (a stray quote, a row with the wrong number of columns); JSON has none.
 */
function parseFile(format, path, sheet = 0) {
  if (format === 'xlsx') {
    const sheets = readXlsx(path)
    const index = typeof sheet === 'string' ? Math.max(0, sheets.findIndex(s => s.name === sheet)) : Math.min(Math.max(0, Number(sheet) || 0), sheets.length - 1)
    return { ...sheetTable(sheets[index]), sheets: sheets.map(s => s.name), sheet: index, workbook: sheets }
  }
  const text = readFileSync(path, 'utf8')
  if (format === 'csv') {
    const { rows: all, issues } = parseCsvDetailed(text)
    const [headers = [], ...data] = all
    return {
      headers,
      rows: data.map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? '']))),
      issues: issues.map(({ line, kind, found, expected }) => ({ line, message: tr(`dataIoDialog.issue.${kind}`, { found, expected }) }))
    }
  }
  const parsed = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
  if (!Array.isArray(parsed)) throw new Error(tr('errors.jsonExpectsArray'))
  const headers = []
  const rows = parsed.map(obj => {
    const out = {}
    for (const [k, v] of Object.entries(obj ?? {})) {
      if (!headers.includes(k)) headers.push(k)
      out[k] = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
    }
    return out
  })
  return { headers, rows, issues: [] }
}

/**
 * Default mapping: a header that fully matches a field's display name (case-insensitive,
 * trimmed) maps to that field; failing that, a full match on the slug does. Names win so
 * users can import CSVs laid out for their own game without touching slugs.
 */
function autoMap(headers, fields) {
  const norm = v => String(v).trim().toLowerCase()
  const mapping = {}
  for (const h of headers) {
    const f = fields.find(f => norm(f.name) === norm(h)) ?? fields.find(f => norm(f.slug) === norm(h))
    mapping[h] = f ? f.slug
      : norm(h) === DISPLAY_NAME ? DISPLAY_NAME
      : norm(h) === 'quantity' ? QUANTITY
      : norm(h) === 'status' ? STATUS
      : ['art_status', 'art status'].includes(norm(h)) ? ART_STATUS
      : ['card_id', 'card id'].includes(norm(h)) ? CARD_ID
      : IGNORE
  }
  return mapping
}

/** Validate/normalise one value against its field definition. Returns { value } or { error }. */
function coerce(field, raw, d, richImport) {
  const value = String(raw ?? '')
  // Into a Rich text field the incoming text is read as markup, or kept exactly as written by escaping it (PRD §16.7)
  if (field.type === 'rich_text' && richImport === 'literal') return validateValue(field, escapeMarkup(value))
  if (field.type === 'image_ref' && value !== '') {
    if (value.startsWith('asset:')) return { value }
    const asset = d.prepare('SELECT id FROM assets WHERE filename = ? OR original_name = ?').get(value, value)
    return asset ? { value: `asset:${asset.id}` } : { error: tr('errors.assetNamedNotFound', { value }) }
  }
  return validateValue(field, raw)
}

/** Read a CSV or JSON file by path (the command line has nobody to ask): the headers, the rows, and the automatic mapping for the set. */
export function readDataFile(ctx, { path, setId, sheet }) {
  const format = formatOfPath(path)
  if (!format) throw new Error(tr('errors.dataFileType'))
  const { headers, rows, issues, sheets, sheet: sheetIndex } = parseFile(format, path, sheet)
  const fields = dbOf(ctx).prepare('SELECT * FROM fields WHERE set_id = ?').all(setId)
  return { fileName: basename(path), headers, rows, issues, mapping: autoMap(headers, fields), ...(sheets ? { sheets, sheet: sheetIndex } : {}) }
}

export async function readFile(ctx, { format, setId, sheet }) {
  const d = dbOf(ctx)
  const dir = dirOf(ctx)
  let path
  if (format === 'xlsx' && sheet !== undefined && workbooks.has(dir)) path = workbooks.get(dir)   // another sheet of the workbook just chosen
  else {
    const [title, label] = format === 'csv' ? [tr('dialogs.importCsv'), tr('dialogs.csv')]
      : format === 'xlsx' ? [tr('dialogs.importXlsx'), tr('dialogs.xlsx')] : [tr('dialogs.importJson'), tr('dialogs.json')]
    const result = await ctx.ui.showOpenDialog({ title, properties: ['openFile'], filters: [{ name: label, extensions: FORMATS[format] ?? ['json'] }] })
    if (result.canceled) return null
    path = result.filePaths[0]
    if (format === 'xlsx') workbooks.set(dir, path)
  }
  const { headers, rows, issues, sheets, sheet: sheetIndex } = parseFile(format, path, sheet)
  const fields = d.prepare('SELECT * FROM fields WHERE set_id = ?').all(setId)
  return { fileName: basename(path), headers, rows, issues, mapping: autoMap(headers, fields), ...(sheets ? { sheets, sheet: sheetIndex } : {}) }
}

export function importRows(ctx, { setId, rows, mapping, mode, keyField, previewOnly, richText: richImport = 'markup' }) {
  const d = dbOf(ctx)
  const now = Date.now()
  const fields = d.prepare('SELECT * FROM fields WHERE set_id = ? ORDER BY display_order').all(setId)
  const bySlug = new Map(fields.map(f => [f.slug, f]))
  const setRow = d.prepare('SELECT display_field, identifier_field FROM sets WHERE id = ?').get(setId) ?? {}
  keyField = keyField || setRow.identifier_field || undefined   // the set's unique identifier column is the merge key unless another is chosen (UPDATES U9)
  let displayField = setRow.display_field ?? null
  let namesTheSet = null   // the field a column called display_name becomes, when the set has no display name yet (UPDATES U10)

  // Resolve '__new' columns to prospective text fields
  const newFields = []
  const resolved = {}
  for (const [header, target] of Object.entries(mapping)) {
    if (!target || target === IGNORE) continue
    if (target === DISPLAY_NAME) {
      // the old built-in Name column: it fills the set's display field; a set without one gets a text field called Name
      if (!displayField && !namesTheSet) {
        const slug = bySlug.has('name') ? 'name' : ['name', 'display_name', 'card_name'].find(s => !newFields.some(f => f.slug === s)) ?? 'name_2'
        if (!bySlug.has(slug)) newFields.push({ id: randomUUID(), set_id: setId, name: tr('fieldManager.starterName'), slug, type: 'text' })
        namesTheSet = slug
      }
      resolved[header] = displayField ?? namesTheSet
    } else if (target === NEW_FIELD) {
      let slug = slugify(header)
      if (isReservedFieldName(slug)) slug = `${slug}_2`   // card_id belongs to the built-in column (PRD §5.8)
      const existing = bySlug.get(slug) ?? newFields.find(f => f.slug === slug)
      if (!existing) newFields.push({ id: randomUUID(), set_id: setId, name: isReservedFieldName(header) ? `${header.trim()} 2` : header.trim(), slug, type: 'text' })
      resolved[header] = slug
    } else resolved[header] = target
  }
  const defOf = slug => bySlug.get(slug) ?? newFields.find(f => f.slug === slug)

  // Validate every row
  const errors = []
  const prepared = []
  const seenIds = new Set()
  rows.forEach((row, idx) => {
    const fieldValues = {}
    let quantity
    let cardCode
    let status, artStatus
    const rowErrors = []
    for (const [header, slug] of Object.entries(resolved)) {
      if (!(header in row)) continue // key absent from this JSON object: leave the field alone
      const raw = row[header]
      if (slug === CARD_ID) {
        cardCode = String(raw ?? '').trim()
        if (cardCode === '') { cardCode = undefined; continue }   // blank: a new card gets a generated ID
        if (seenIds.has(cardCode)) rowErrors.push({ row: idx + 2, field: tr('dataIoDialog.cardId'), message: tr('dataIoDialog.duplicateCardId', { code: cardCode }) })
        seenIds.add(cardCode)
        continue
      }
      if (slug === QUANTITY) {
        if (String(raw ?? '').trim() === '') continue   // blank: new cards get 1, merged cards keep theirs
        const q = validateQuantity(raw)
        if (q.error) rowErrors.push({ row: idx + 2, field: tr('dataIoDialog.quantity'), message: q.error })
        else quantity = q.value
        continue
      }
      if (slug === STATUS || slug === ART_STATUS) {
        // a card's status (UPDATES U26): the words of the list, in any case, with a space or a dash for the underscore
        if (String(raw ?? '').trim() === '') continue   // blank: a new card has none, a merged card keeps its own
        const list = slug === STATUS ? STATUSES : ART_STATUSES
        const squash = t => String(t).trim().toLowerCase().replace(/[\s_-]+/g, '')   // "Play test", "play-test" and "playtest" are the same word
        const word = list.find(item => squash(item) === squash(raw))
        if (!word) rowErrors.push({ row: idx + 2, field: slug === STATUS ? tr('dataIoDialog.status') : tr('dataIoDialog.artStatus'), message: tr('errors.badStatus', { value: String(raw).trim() }) + ' ' + tr('dataIoDialog.statusChoices', { list: list.join(', ') }) })
        else if (slug === STATUS) status = word
        else artStatus = word
        continue
      }
      const def = defOf(slug)
      if (!def || isComputed(def.type)) continue // formula and lookup values are computed, never stored
      const r = coerce(def, raw, d, richImport)
      if (r.error) rowErrors.push({ row: idx + 2, field: def.name, message: r.error })
      else fieldValues[slug] = r.value
    }
    if (rowErrors.length) errors.push(...rowErrors)
    else prepared.push({ quantity, cardCode, fieldValues, status, artStatus })
  })

  if (previewOnly) return { errors, validCount: prepared.length, newFields: newFields.map(f => f.name) }

  // Commit (skipping rows with errors)
  const existingCards = mode === 'merge'
    ? d.prepare('SELECT * FROM cards WHERE set_id = ? AND deleted = 0').all(setId)
    : []
  const hasIdColumn = Object.values(resolved).includes(CARD_ID)
  if (mode === 'merge' && !keyField && !hasIdColumn) throw new Error(tr('errors.mergeNeedsKey'))
  const keyIndex = new Map()
  const idIndex = new Map()
  for (const c of existingCards) {
    if (c.card_code) idIndex.set(c.card_code, c)
    if (!keyField) continue
    const k = JSON.parse(c.fields_json)[keyField]
    if (k != null && k !== '' && !keyIndex.has(k)) keyIndex.set(k, c)
  }
  // IDs the file brings must not be handed out to other new cards, and must not clash with other sets' cards
  const avoid = new Set(prepared.map(p => p.cardCode).filter(Boolean))
  const usedElsewhere = code => !!d.prepare('SELECT 1 FROM cards WHERE card_code = ?').get(code)

  const maxOrder = d.prepare(
    'SELECT COALESCE(MAX(sort_order), -1) AS m FROM cards WHERE set_id = ? AND deleted = 0'
  ).get(setId).m
  let order = maxOrder + 1
  let fieldOrder = d.prepare('SELECT COALESCE(MAX(display_order), -1) AS m FROM fields WHERE set_id = ?').get(setId).m + 1

  const changes = []   // before/after row snapshots for a single undo step
  let created = 0, updated = 0

  d.transaction(() => {
    noteCodes(d, setId, [...avoid].filter(c => !usedElsewhere(c)))   // generated IDs continue after the highest ID the file brings
    if (namesTheSet) {
      const before = rowOf(d, 'sets', setId)
      d.prepare('UPDATE sets SET display_field = ?, updated_at = ? WHERE id = ?').run(namesTheSet, now, setId)
      changes.push({ table: 'sets', before, after: rowOf(d, 'sets', setId) })
    }
    for (const f of newFields) {
      d.prepare(
        `INSERT INTO fields (id, set_id, name, slug, type, default_value, formula, validation, display_order, hidden, created_at)
           VALUES (?, ?, ?, ?, 'text', NULL, NULL, NULL, ?, 0, ?)`
      ).run(f.id, setId, f.name, f.slug, fieldOrder++, now)
      changes.push({ table: 'fields', before: null, after: rowOf(d, 'fields', f.id) })
    }
    const defaults = {}
    for (const f of [...fields, ...newFields]) defaults[f.slug] = f.default_value ?? ''

    for (const { quantity, cardCode, fieldValues, status, artStatus } of prepared) {
      // The card ID is the default merge key (PRD §5.8); the chosen key field serves files that have no IDs
      const match = mode === 'merge' ? (cardCode ? idIndex.get(cardCode) : null) ?? (keyField ? keyIndex.get(fieldValues[keyField]) : null) ?? null : null
      if (match) {
        const merged = { ...JSON.parse(match.fields_json), ...fieldValues }
        const before = rowOf(d, 'cards', match.id)
        d.prepare('UPDATE cards SET quantity = ?, fields_json = ?, status = ?, art_status = ?, updated_at = ? WHERE id = ?')
          .run(quantity ?? match.quantity, JSON.stringify(merged), status ?? match.status, artStatus ?? match.art_status, now, match.id)
        changes.push({ table: 'cards', before, after: rowOf(d, 'cards', match.id) })
        updated++
      } else {
        const id = randomUUID()
        // A new card keeps the ID the file gives it when that ID is free; otherwise it gets a generated one
        const code = cardCode && !usedElsewhere(cardCode) ? cardCode : nextCardCode(d, setId, avoid)
        d.prepare(
          `INSERT INTO cards (id, set_id, card_code, template_id, quantity, fields_json, sort_order, deleted, created_at, updated_at, status, art_status)
             VALUES (?, ?, ?, NULL, ?, ?, ?, 0, ?, ?, ?, ?)`
        ).run(id, setId, code, quantity ?? 1, JSON.stringify({ ...defaults, ...fieldValues }), order++, now, now, status ?? null, artStatus ?? null)
        changes.push({ table: 'cards', before: null, after: rowOf(d, 'cards', id) })
        created++
      }
    }
    syncCounters(d, [setId])   // counter safety: never hand out an ID the import just brought (PRD §5.8)
    // Whole import is a single undoable entry (PRD §11.2)
    recordChange(d, 'IMPORT_CARDS', changes)
  })()

  return { created, updated, skipped: errors.length ? rows.length - prepared.length : 0, errors }
}

export async function exportData(ctx, { setIds, format, includeMeta }) {
  if (!FORMATS[format]) throw new Error(tr('errors.dataFileType'))
  const d = dbOf(ctx)
  const templates = Object.fromEntries(d.prepare('SELECT id, name FROM templates').all().map(t => [t.id, t.name]))
  const assetNames = Object.fromEntries(d.prepare('SELECT id, filename FROM assets').all().map(a => [a.id, a.filename]))
  const resolver = createResolver(d)

  // a user field called "quantity" or "status" is just a field; the built-in columns are only written when no field uses the name
  const taken = slug => setIds.some(id => d.prepare('SELECT 1 FROM fields WHERE set_id = ? AND slug = ?').get(id, slug))
  const ownQuantity = taken('quantity')
  const statusMode = Math.max(0, ...setIds.map(id => d.prepare('SELECT status_mode FROM sets WHERE id = ?').get(id)?.status_mode ?? 0))
  const withStatus = statusMode >= 1 && !taken('status'), withArt = statusMode >= 2 && !taken('art_status')

  // one table per set: its column names, its rows, and which columns hold numbers
  const tables = []
  for (const setId of setIds) {
    const set = d.prepare('SELECT * FROM sets WHERE id = ?').get(setId)
    const fields = d.prepare('SELECT * FROM fields WHERE set_id = ? ORDER BY display_order').all(setId)
    const numbers = new Set(fields.filter(f => f.type === 'number').map(f => f.slug))
    const booleans = new Set(fields.filter(f => f.type === 'boolean').map(f => f.slug))
    const records = []
    for (const card of resolver.cardsOf(setId)) {
      const stored = card.stored
      const worked = fields.some(f => isComputed(f.type)) ? resolver.worked(card) : stored
      const rec = { card_id: card.card_code ?? '' }   // always first (PRD §5.8)
      if (!ownQuantity) rec.quantity = card.quantity
      for (const f of fields) {
        let v = stored[f.slug] ?? ''
        if (isComputed(f.type)) v = worked[f.slug] ?? ''
        else if (f.type === 'image_ref' && String(v).startsWith('asset:')) v = assetNames[String(v).slice(6)] ?? ''
        rec[f.slug] = v
      }
      if (withStatus) rec.status = card.status ?? ''
      if (withArt) rec.art_status = card.art_status ?? ''
      if (includeMeta) {
        rec._id = card.id
        rec._set = set?.name ?? ''
        rec._template = templates[card.template_id] ?? ''
        rec._back = templates[card.back_template_id] ?? ''
      }
      records.push(rec)
    }
    const columns = ['card_id']
    for (const f of fields) if (!columns.includes(f.slug)) columns.push(f.slug)
    if (!ownQuantity) columns.push('quantity')
    if (withStatus) columns.push('status')
    if (withArt) columns.push('art_status')
    if (includeMeta) columns.push('_id', '_set', '_template', '_back')
    tables.push({ name: set?.name ?? '', columns, records, numbers: new Set([...numbers, 'quantity']), booleans })
  }

  const result = await ctx.ui.showSaveDialog({
    title: format === 'csv' ? tr('dialogs.exportCsv') : format === 'xlsx' ? tr('dialogs.exportXlsx') : tr('dialogs.exportJson'),
    defaultPath: `cards.${format}`,
    filters: [{ name: format.toUpperCase(), extensions: [format] }]
  })
  if (result.canceled) return null

  const count = tables.reduce((n, t) => n + t.records.length, 0)
  if (format === 'xlsx') {
    // one sheet per set, with real numbers and booleans so a spreadsheet can add them up
    const cell = (t, c, v) => {
      if (v === '' || v == null) return ''
      if (t.numbers.has(c) && Number.isFinite(Number(v))) return Number(v)
      if (t.booleans.has(c) && (v === 'true' || v === 'false')) return v === 'true'
      return v
    }
    writeFileSync(result.filePath, writeXlsx(tables.map(t => ({ name: t.name, rows: [t.columns, ...t.records.map(r => t.columns.map(c => cell(t, c, r[c])))] }))))
  } else {
    // a CSV or JSON file is one table: the columns of every set, side by side where they share a name
    const columns = []
    for (const t of tables) for (const c of t.columns) if (!columns.includes(c)) columns.push(c)
    const records = tables.flatMap(t => t.records)
    if (format === 'csv') writeFileSync(result.filePath, toCsv([columns, ...records.map(r => columns.map(c => r[c] ?? ''))]), 'utf8')
    else writeFileSync(result.filePath, JSON.stringify(records, null, 2), 'utf8')
  }
  return { path: result.filePath, count }
}
