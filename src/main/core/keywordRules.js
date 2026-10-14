/**
 * Keyword rules (PRD §16.5): "when the text contains X, show it as Y". The rules are project data, in an order that matters
 * (the first rule to claim a word wins). Covered by undo and redo.
 */
import { randomUUID } from 'crypto'
import { dbOf } from './context.js'
import { recordChange, rowOf, rowsOf, changesFor } from './history.js'
import { checkPattern, MAX_MATCH_LENGTH, MAX_PATTERN_LENGTH } from '../../shared/keywords.js'
import { iconKey } from '../../shared/richText.js'
import { tr } from '../../shared/i18n.js'

const MODES = ['style', 'icon', 'icon_text', 'replace']

const parse = r => ({
  id: r.id, match: r.match, wholeWord: !!r.whole_word, ignoreCase: !!r.ignore_case, isPattern: !!r.is_pattern, mode: r.mode,
  action: JSON.parse(r.action || '{}'), scope: r.scope == null ? null : JSON.parse(r.scope), enabled: !!r.enabled, order: r.sort_order
})

/** The rule's fields, checked, as the columns they are stored in. */
function columns(input) {
  const match = String(input.match ?? '').trim()
  const isPattern = !!input.isPattern
  if (!match || match.length > (isPattern ? MAX_PATTERN_LENGTH : MAX_MATCH_LENGTH)) throw new Error(tr('errors.keywordMatchInvalid'))
  if (isPattern) {
    const check = checkPattern(match)
    if (!check.ok) throw new Error(check.reason === 'syntax' ? tr('errors.keywordPatternSyntax') : tr('errors.keywordPatternUnsafe'))
  }
  if (!MODES.includes(input.mode)) throw new Error(tr('errors.keywordModeInvalid'))
  const a = input.action ?? {}
  let action
  if (input.mode === 'style') { if (!iconKey(a.style ?? '')) throw new Error(tr('errors.keywordActionMissing')); action = { style: iconKey(a.style) } }
  else if (input.mode === 'replace') { if (typeof a.text !== 'string') throw new Error(tr('errors.keywordActionMissing')); action = { text: a.text.slice(0, 200) } }
  else { if (!iconKey(a.icon ?? '')) throw new Error(tr('errors.keywordActionMissing')); action = { icon: iconKey(a.icon) } }
  const scope = input.scope == null ? null : [...new Set((input.scope ?? []).map(String))].slice(0, 50)
  return { match, whole_word: input.wholeWord === false ? 0 : 1, ignore_case: input.ignoreCase ? 1 : 0, is_pattern: isPattern ? 1 : 0, mode: input.mode, action: JSON.stringify(action), scope: scope && scope.length ? JSON.stringify(scope) : null }
}

export const list = ctx => dbOf(ctx).prepare('SELECT * FROM keyword_rules ORDER BY sort_order, created_at').all().map(parse)

export function create(ctx, input) {
  const d = dbOf(ctx)
  const c = columns(input)
  const id = randomUUID()
  const order = d.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM keyword_rules').get().n
  d.prepare('INSERT INTO keyword_rules (id, match, whole_word, ignore_case, is_pattern, mode, action, scope, enabled, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, c.match, c.whole_word, c.ignore_case, c.is_pattern, c.mode, c.action, c.scope, input.enabled === false ? 0 : 1, order, Date.now())
  recordChange(d, 'CREATE_KEYWORD_RULE', [{ table: 'keyword_rules', before: null, after: rowOf(d, 'keyword_rules', id) }])
  return parse(d.prepare('SELECT * FROM keyword_rules WHERE id = ?').get(id))
}

/** Change a rule: any of the fields of `create`, given again in full, and `enabled`. */
export function update(ctx, { id, ...patch }) {
  const d = dbOf(ctx)
  const before = rowOf(d, 'keyword_rules', id)
  if (!before) throw new Error(tr('errors.keywordNotFound'))
  const current = parse(d.prepare('SELECT * FROM keyword_rules WHERE id = ?').get(id))
  const merged = { ...current, ...patch }
  const c = columns(merged)
  d.prepare('UPDATE keyword_rules SET match = ?, whole_word = ?, ignore_case = ?, is_pattern = ?, mode = ?, action = ?, scope = ?, enabled = ? WHERE id = ?')
    .run(c.match, c.whole_word, c.ignore_case, c.is_pattern, c.mode, c.action, c.scope, merged.enabled === false ? 0 : 1, id)
  recordChange(d, 'UPDATE_KEYWORD_RULE', changesFor(d, 'keyword_rules', [before]))
  return parse(d.prepare('SELECT * FROM keyword_rules WHERE id = ?').get(id))
}

export function remove(ctx, id) {
  const d = dbOf(ctx)
  const before = rowOf(d, 'keyword_rules', id)
  if (!before) return
  d.prepare('DELETE FROM keyword_rules WHERE id = ?').run(id)
  recordChange(d, 'DELETE_KEYWORD_RULE', [{ table: 'keyword_rules', before, after: null }])
}

/** Put the rules in the given order (the first to claim a word wins). */
export function reorder(ctx, orderedIds) {
  const d = dbOf(ctx)
  const befores = rowsOf(d, 'keyword_rules', orderedIds)
  const stmt = d.prepare('UPDATE keyword_rules SET sort_order = ? WHERE id = ?')
  d.transaction(() => orderedIds.forEach((id, i) => stmt.run(i, id)))()
  recordChange(d, 'REORDER_KEYWORD_RULES', changesFor(d, 'keyword_rules', befores))
}
