/**
 * The difference between two states of a project (PRD §20): what a designer would call a change, found by
 * the stable ids of cards, fields, templates and assets, so a renamed card or field is still the same one.
 * Pure reading: both databases are only queried. Bookkeeping (times, order, column widths) is ignored (§20.6).
 *
 * Every change has a `key` that names it, so the same difference can be found again when the user asks to
 * take it back (core/snapshotCompare.js).
 */

const rows = (db, sql) => { try { return db.prepare(sql).all() } catch { return [] } }   // an old snapshot may lack a newer table
const byId = list => new Map(list.map(r => [r.id, r]))
const text = v => (v === undefined || v === null ? '' : typeof v === 'string' ? v : JSON.stringify(v))

const hasColumn = (db, table, col) => rows(db, `PRAGMA table_info(${table})`).some(c => c.name === col)

function readState(db) {
  const sets = byId(rows(db, 'SELECT id, name, code, card_size, card_mm_w, card_mm_h FROM sets'))
  const backColumn = hasColumn(db, 'cards', 'back_template_id') ? 'back_template_id' : 'NULL AS back_template_id'   // a snapshot from before card backs has none
  const fields = rows(db, 'SELECT id, set_id, name, slug, type, validation, default_value, formula FROM fields')
  const cards = rows(db, `SELECT id, set_id, display_name, template_id, ${backColumn}, card_code, quantity, fields_json FROM cards WHERE deleted = 0`)
  const templates = rows(db, 'SELECT id, name, svg_source, card_size, card_mm_w, card_mm_h, bleed_mm FROM templates')
  const assets = rows(db, 'SELECT id, filename, original_name, file_size_bytes, thumbnail_jpeg FROM assets')
  const fonts = rows(db, 'SELECT id, family_name, style FROM fonts')
  const rules = rows(db, 'SELECT id, parent_id, title, body FROM rules_pages')       // a snapshot from before the rules has none
  // a project from before UPDATES U10 keeps the name in a column of its own; later ones keep it in a field, so a name change shows as that field's change
  return { named: hasColumn(db, 'sets', 'display_field'), sets, fields: byId(fields), cards: byId(cards), templates: byId(templates), assets: byId(assets), fonts: byId(fonts), rules: byId(rules) }
}

const parseFields = card => { try { return JSON.parse(card.fields_json) ?? {} } catch { return {} } }

/** Difference of two token lists: a list of { op: 'same' | 'add' | 'del', text }. Whole-side when the lists are large. */
function seqDiff(x, y, glue) {
  if (x.length * y.length > 4000000) return [{ op: 'del', text: x.join(glue) }, { op: 'add', text: y.join(glue) }]
  const lcs = Array.from({ length: x.length + 1 }, () => new Int32Array(y.length + 1))
  for (let i = x.length - 1; i >= 0; i--)
    for (let j = y.length - 1; j >= 0; j--) lcs[i][j] = x[i] === y[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
  const out = []
  const push = (op, t) => { const last = out[out.length - 1]; if (last?.op === op) last.text += glue + t; else out.push({ op, text: t }) }
  let i = 0, j = 0
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) { push('same', x[i]); i++; j++ }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) push('del', x[i++])
    else push('add', y[j++])
  }
  while (i < x.length) push('del', x[i++])
  while (j < y.length) push('add', y[j++])
  return out
}

/** Word-level difference of two strings (spaces are kept as words of their own, so the pieces join back to the text). */
export function wordDiff(a, b) {
  const x = a.split(/(\s+)/).filter(s => s !== '')
  const y = b.split(/(\s+)/).filter(s => s !== '')
  if (x.length * y.length > 40000) return [{ op: 'del', text: a }, { op: 'add', text: b }]
  return seqDiff(x, y, '')
}

/** Line-level difference of two sources (template SVG), for the source view of the Templates tab. */
export function lineDiff(a, b) {
  return seqDiff(a.split(String.fromCharCode(10)), b.split(String.fromCharCode(10)), String.fromCharCode(10))
}

/**
 * @param {*} from  database of the earlier state (a snapshot)
 * @param {*} to    database of the later state (the open project, or another snapshot)
 */
export function compareStates(from, to) {
  const A = readState(from)
  const B = readState(to)
  const setName = id => B.sets.get(id)?.name ?? A.sets.get(id)?.name ?? ''
  const templateName = (id, S) => (id ? S.templates.get(id)?.name ?? null : null)

  // -- Fields ---------------------------------------------------------------
  const fieldChanges = []
  for (const [id, f] of B.fields) {
    const old = A.fields.get(id)
    if (!old) { fieldChanges.push({ key: `field:${id}:added`, kind: 'added', setName: setName(f.set_id), name: f.name, type: f.type }); continue }
    const what = []
    if (old.name !== f.name) what.push({ aspect: 'name', from: old.name, to: f.name })
    if (old.type !== f.type) what.push({ aspect: 'type', from: old.type, to: f.type })
    if (text(old.validation) !== text(f.validation)) what.push({ aspect: 'validation', from: text(old.validation), to: text(f.validation) })
    if (text(old.default_value) !== text(f.default_value)) what.push({ aspect: 'default', from: text(old.default_value), to: text(f.default_value) })
    if (text(old.formula) !== text(f.formula)) what.push({ aspect: 'formula', from: text(old.formula), to: text(f.formula) })
    if (what.length) fieldChanges.push({ key: `field:${id}:changed`, kind: 'changed', setName: setName(f.set_id), name: f.name, what })
  }
  for (const [id, f] of A.fields) if (!B.fields.has(id)) fieldChanges.push({ key: `field:${id}:removed`, kind: 'removed', setName: setName(f.set_id), name: f.name, type: f.type })

  // -- Cards ----------------------------------------------------------------
  const labelOf = fieldId => B.fields.get(fieldId)?.name ?? A.fields.get(fieldId)?.name ?? ''
  const cardChanges = []
  for (const [id, c] of B.cards) {
    const old = A.cards.get(id)
    if (!old) { cardChanges.push({ key: `card:${id}:added`, id, kind: 'added', setId: c.set_id, setName: setName(c.set_id), name: c.display_name, code: c.card_code, changes: [] }); continue }
    const changes = []
    if (!(A.named && B.named) && old.display_name !== c.display_name) changes.push({ key: `card:${id}:name`, kind: 'name', from: old.display_name, to: c.display_name })
    if ((old.template_id ?? null) !== (c.template_id ?? null))
      changes.push({ key: `card:${id}:template`, kind: 'template', from: templateName(old.template_id, A), to: templateName(c.template_id, B) })
    if ((old.back_template_id ?? null) !== (c.back_template_id ?? null))
      changes.push({ key: `card:${id}:back`, kind: 'back', from: templateName(old.back_template_id, A), to: templateName(c.back_template_id, B) })
    if (old.quantity !== c.quantity) changes.push({ key: `card:${id}:quantity`, kind: 'quantity', from: old.quantity, to: c.quantity })
    if ((old.card_code ?? null) !== (c.card_code ?? null)) changes.push({ key: `card:${id}:code`, kind: 'code', from: old.card_code, to: c.card_code })

    const oldValues = parseFields(old), newValues = parseFields(c)
    const fieldIds = new Set([...[...A.fields.values()].filter(f => f.set_id === old.set_id), ...[...B.fields.values()].filter(f => f.set_id === c.set_id)].map(f => f.id))
    for (const fid of fieldIds) {
      const fa = A.fields.get(fid), fb = B.fields.get(fid)
      if (!fa || !fb) continue                                    // the field itself was added or removed: reported under Fields
      const from = text(oldValues[fa.slug]), toValue = text(newValues[fb.slug])
      if (from !== toValue) {
        const change = { key: `card:${id}:field:${fid}`, kind: 'field', label: labelOf(fid), from, to: toValue }
        if (fb.type === 'text' || fb.type === 'rich_text') change.words = wordDiff(from, toValue)
        changes.push(change)
      }
    }
    if (changes.length) cardChanges.push({ key: `card:${id}`, id, kind: 'changed', setId: c.set_id, setName: setName(c.set_id), name: c.display_name, code: c.card_code, changes })
  }
  for (const [id, c] of A.cards)
    if (!B.cards.has(id)) cardChanges.push({ key: `card:${id}:removed`, id, kind: 'removed', setId: c.set_id, setName: setName(c.set_id), name: c.display_name, code: c.card_code, changes: [] })

  // -- Everything else a designer would notice -------------------------------
  const other = []
  for (const [id, t] of B.templates) {
    const old = A.templates.get(id)
    if (!old) other.push({ key: `template:${id}:added`, area: 'template', kind: 'added', name: t.name })
    else if (old.name !== t.name || old.svg_source !== t.svg_source || old.card_size !== t.card_size || old.card_mm_w !== t.card_mm_w || old.card_mm_h !== t.card_mm_h || old.bleed_mm !== t.bleed_mm)
      other.push({ key: `template:${id}:changed`, area: 'template', kind: 'changed', name: t.name, oldName: old.name, design: old.svg_source !== t.svg_source, size: old.card_size !== t.card_size || old.card_mm_w !== t.card_mm_w || old.card_mm_h !== t.card_mm_h, bleed: old.bleed_mm !== t.bleed_mm })
  }
  for (const [id, t] of A.templates) if (!B.templates.has(id)) other.push({ key: `template:${id}:removed`, area: 'template', kind: 'removed', name: t.name })
  let thumbs = 0
  const thumb = a => (a.thumbnail_jpeg && thumbs++ < 200 ? Buffer.from(a.thumbnail_jpeg).toString('base64') : null)   // the first 200 only: the list stays small
  for (const [id, a] of B.assets) {
    const old = A.assets.get(id)
    if (!old) other.push({ key: `asset:${id}:added`, area: 'asset', kind: 'added', name: a.original_name, thumb: thumb(a) })
    else if (old.file_size_bytes !== a.file_size_bytes || old.filename !== a.filename) other.push({ key: `asset:${id}:changed`, area: 'asset', kind: 'changed', name: a.original_name, thumb: thumb(a), oldThumb: thumb(old) })
  }
  for (const [id, a] of A.assets) if (!B.assets.has(id)) other.push({ key: `asset:${id}:removed`, area: 'asset', kind: 'removed', name: a.original_name, thumb: thumb(a) })
  // Sets: a rename, a new code or another card size (the settings tab of §20.2)
  for (const [id, set] of B.sets) {
    const old = A.sets.get(id)
    if (!old) { other.push({ key: `set:${id}:added`, area: 'set', kind: 'added', name: set.name }); continue }
    const what = []
    if (old.name !== set.name) what.push({ aspect: 'name', from: old.name, to: set.name })
    if ((old.code ?? '') !== (set.code ?? '')) what.push({ aspect: 'code', from: old.code ?? '', to: set.code ?? '' })
    if (old.card_size !== set.card_size || old.card_mm_w !== set.card_mm_w || old.card_mm_h !== set.card_mm_h)
      what.push({ aspect: 'size', from: old.card_size === 'custom' ? `${old.card_mm_w} × ${old.card_mm_h} mm` : old.card_size, to: set.card_size === 'custom' ? `${set.card_mm_w} × ${set.card_mm_h} mm` : set.card_size })
    if (what.length) other.push({ key: `set:${id}:changed`, area: 'set', kind: 'changed', name: set.name, what })
  }
  for (const [id, set] of A.sets) if (!B.sets.has(id)) other.push({ key: `set:${id}:removed`, area: 'set', kind: 'removed', name: set.name })
  // The pages of the rules
  for (const [id, r] of B.rules) {
    const old = A.rules.get(id)
    if (!old) other.push({ key: `rules:${id}:added`, area: 'rules', kind: 'added', name: r.title })
    else if (old.title !== r.title || old.body !== r.body) other.push({ key: `rules:${id}:changed`, area: 'rules', kind: 'changed', name: r.title, oldName: old.title, title: old.title !== r.title, words: old.body !== r.body })
  }
  for (const [id, r] of A.rules) if (!B.rules.has(id)) other.push({ key: `rules:${id}:removed`, area: 'rules', kind: 'removed', name: r.title })
  for (const [id, f] of B.fonts) if (!A.fonts.has(id)) other.push({ key: `font:${id}:added`, area: 'font', kind: 'added', name: `${f.family_name} ${f.style}` })
  for (const [id, f] of A.fonts) if (!B.fonts.has(id)) other.push({ key: `font:${id}:removed`, area: 'font', kind: 'removed', name: `${f.family_name} ${f.style}` })

  const count = kind => cardChanges.filter(c => c.kind === kind).length
  return {
    summary: {
      cardsChanged: count('changed'), cardsAdded: count('added'), cardsRemoved: count('removed'),
      fields: fieldChanges.length, other: other.length,
      templates: other.filter(o => o.area === 'template').length
    },
    cards: cardChanges, fields: fieldChanges, other
  }
}
