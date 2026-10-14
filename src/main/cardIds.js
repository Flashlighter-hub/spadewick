/**
 * Card IDs (PRD §5.8): generation, counters and the per-project settings.
 *
 * Numbers only go up. A counter row is never decreased, deleted cards keep their ID (cards are
 * soft-deleted), and every candidate is checked against all existing IDs before it is handed out.
 */
import { DEFAULT_PATTERN, parsePattern, formatCardId, patternRegex, deriveSetCode, isValidSetCode, normalizeSetCode, randomAuthorCode, AUTHOR_LENGTH } from '../shared/cardIds.js'
import { tr } from '../shared/i18n.js'

const PROJECT_SCOPE = '@project'

// The author code belongs to the installation (the settings file), not to a project
let authorStore = null
let sessionAuthor = null
export function setAuthorStore(store) { authorStore = store }

export function getAuthorCode() {
  const saved = authorStore?.get('author_code')
  if (saved) return saved
  const fresh = sessionAuthor ?? randomAuthorCode()
  sessionAuthor = fresh
  authorStore?.set('author_code', fresh)
  return fresh
}

export function setAuthorCode(code) {
  const clean = normalizeSetCode(code)
  if (clean.length !== AUTHOR_LENGTH) throw new Error(tr('cardIds.authorInvalid', { n: AUTHOR_LENGTH }))
  sessionAuthor = clean
  authorStore?.set('author_code', clean)
  return clean
}

const metaGet = (db, key) => db.prepare('SELECT value FROM project_meta WHERE key = ?').get(key)?.value
const metaPut = (db, key, value) => db.prepare('INSERT OR REPLACE INTO project_meta (key, value) VALUES (?, ?)').run(key, String(value))

export function getIdSettings(db) {
  return {
    pattern: metaGet(db, 'card_id_pattern') ?? DEFAULT_PATTERN,
    scope: metaGet(db, 'card_id_scope') === 'project' ? 'project' : 'set',
    start: Math.max(0, parseInt(metaGet(db, 'card_id_start') ?? '1', 10) || 1),
    step: Math.max(1, parseInt(metaGet(db, 'card_id_step') ?? '1', 10) || 1)
  }
}

export function validateIdSettings({ pattern, scope, start, step }) {
  const parsed = parsePattern(pattern)
  if (parsed.error) return tr(`cardIds.${parsed.error}`)
  if (scope !== 'set' && scope !== 'project') return tr('cardIds.scopeInvalid')
  if (!Number.isInteger(start) || start < 0 || start > 999999999) return tr('cardIds.startInvalid')
  if (!Number.isInteger(step) || step < 1 || step > 1000) return tr('cardIds.stepInvalid')
  return null
}

export function saveIdSettings(db, settings) {
  const err = validateIdSettings(settings)
  if (err) throw new Error(err)
  metaPut(db, 'card_id_pattern', settings.pattern)
  metaPut(db, 'card_id_scope', settings.scope)
  metaPut(db, 'card_id_start', settings.start)
  metaPut(db, 'card_id_step', settings.step)
  return getIdSettings(db)
}

export const takenSetCodes = (db, exceptSetId = null) =>
  new Set(db.prepare('SELECT code FROM sets WHERE code IS NOT NULL AND id IS NOT ?').all(exceptSetId).map(r => r.code))

/** A fresh, unique code for a new set. */
export const newSetCode = (db, name) => deriveSetCode(name, takenSetCodes(db))

/** Validate a set code a user typed; returns an error message or null. */
export function checkSetCode(db, setId, code) {
  if (!isValidSetCode(code)) return tr('cardIds.setCodeInvalid')
  if (takenSetCodes(db, setId).has(code)) return tr('cardIds.setCodeTaken', { code })
  return null
}

const counterKey = (settings, setId) => (settings.scope === 'project' ? PROJECT_SCOPE : setId)

/** The next unused ID for a card in `setId`; advances the counter. Run inside the caller's transaction. */
export function nextCardCode(db, setId, avoid = null) {
  const settings = getIdSettings(db)
  const key = counterKey(settings, setId)
  const set = db.prepare('SELECT name, code FROM sets WHERE id = ?').get(setId)
  const setCode = set?.code ?? deriveSetCode(set?.name ?? '', takenSetCodes(db))
  const author = getAuthorCode()
  let n = db.prepare('SELECT next FROM id_counters WHERE scope = ?').get(key)?.next ?? settings.start
  const exists = db.prepare('SELECT 1 FROM cards WHERE card_code = ?')
  let code = formatCardId(settings.pattern, { set: setCode, n, author })
  while (exists.get(code) || avoid?.has(code)) {
    n += settings.step
    code = formatCardId(settings.pattern, { set: setCode, n, author })
  }
  db.prepare('INSERT OR REPLACE INTO id_counters (scope, next) VALUES (?, ?)').run(key, n + settings.step)
  avoid?.add(code)
  return code
}

/**
 * Counter safety (PRD §5.8): after an import, move the counter past the highest number found in
 * IDs that match the pattern, so a newly generated ID can never equal one just imported.
 */
export function syncCounters(db, setIds = null) {
  const sets = setIds ?? db.prepare('SELECT id FROM sets').all().map(r => r.id)
  for (const setId of sets) {
    noteCodes(db, setId, db.prepare('SELECT card_code FROM cards WHERE set_id = ? AND card_code IS NOT NULL').all(setId).map(r => r.card_code))
  }
}

/** Move the counter that serves `setId` past the highest number among `codes` that match the pattern. */
export function noteCodes(db, setId, codes) {
  const settings = getIdSettings(db)
  const rx = patternRegex(settings.pattern)
  if (!rx) return
  let max = -1
  for (const code of codes) {
    const m = rx.exec(code)
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  if (max < 0) return
  const key = counterKey(settings, setId)
  const next = db.prepare('SELECT next FROM id_counters WHERE scope = ?').get(key)?.next ?? settings.start
  if (max + settings.step > next) db.prepare('INSERT OR REPLACE INTO id_counters (scope, next) VALUES (?, ?)').run(key, max + settings.step)
}

/** Values for {{@card.id}}, {{@card.number}}, {{@card.count}} and the card_*() formula functions. */
export function cardContext(db, card) {
  const rows = db.prepare('SELECT id FROM cards WHERE set_id = ? AND deleted = 0 ORDER BY sort_order').all(card.set_id)
  const index = rows.findIndex(r => r.id === card.id)
  return { id: card.card_code ?? '', number: index < 0 ? '' : index + 1, count: rows.length }
}

/** Keys under which the context is placed in the field values (not valid slugs, so no clash). */
export function withCardContext(fields, ctx) {
  return { ...fields, '@card.id': ctx.id, '@card.number': String(ctx.number), '@card.count': String(ctx.count) }
}
