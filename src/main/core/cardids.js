import { getIdSettings, saveIdSettings, getAuthorCode, setAuthorCode, syncCounters } from '../cardIds.js'
import { tr } from '../../shared/i18n.js'
import { normalizeSetCode, AUTHOR_LENGTH } from '../../shared/cardIds.js'
import { dbOf } from './context.js'

/** Project → Card IDs… (PRD §5.8): the generator's pattern, counter scope, start and step, and this installation's author code. */
export function get(ctx) {
  const d = dbOf(ctx)
  return { ...getIdSettings(d), author: getAuthorCode(), sets: d.prepare('SELECT id, name, code FROM sets ORDER BY sort_order').all() }
}

export function save(ctx, { pattern, scope, start, step, author }) {
  const d = dbOf(ctx)
  // check everything before saving anything, so a refused request changes nothing
  if (author !== undefined && normalizeSetCode(author).length !== AUTHOR_LENGTH) throw new Error(tr('cardIds.authorInvalid', { n: AUTHOR_LENGTH }))
  d.transaction(() => {
    saveIdSettings(d, { pattern, scope, start, step })
    syncCounters(d)   // a new pattern or scope must still never reuse an ID
  })()
  if (author !== undefined && author !== getAuthorCode()) setAuthorCode(author)
  return { ...getIdSettings(d), author: getAuthorCode() }
}

