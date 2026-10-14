/**
 * Rich text fields in the places that need plain text (PRD §16.7): formulas, card names and descriptions in exports,
 * export filters. Markup is for drawing cards only; everywhere else a Rich text field counts as the text it reads as,
 * with an icon replaced by its name.
 */
import { stripMarkup } from '../shared/richText.js'

/** The slugs of the Rich text fields among these field definitions. */
export const richSlugsOf = fieldDefs => new Set(fieldDefs.filter(f => f.type === 'rich_text').map(f => f.slug))

/** The slugs of the Rich text fields of one set. */
export const richSlugsOfSet = (db, setId) => richSlugsOf(db.prepare("SELECT slug, type FROM fields WHERE set_id = ? AND type = 'rich_text'").all(setId))

/** A copy of the field values with the markup of Rich text fields removed. */
export function plainValues(values, richSlugs) {
  if (!richSlugs.size) return values
  const out = { ...values }
  for (const slug of richSlugs) if (slug in out) out[slug] = stripMarkup(out[slug])
  return out
}
