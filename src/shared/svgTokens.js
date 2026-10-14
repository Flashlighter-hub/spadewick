/**
 * Rewriting one field's slug inside SVG source (templates refer to a field in three ways): the
 * `{{slug}}` token, the dynamic-text attribute and the expressions of the show-if / hide-if
 * attributes. Both attribute prefixes are handled, because projects from before the rename to
 * Spadewick still hold `data-cardexy-*` until a template is next saved (PRD §24.2).
 */
export const COND_ATTR = /data-(?:spadewick|cardexy)-(?:show|hide)-if="([^"]*)"/g
export const FIELD_ATTR = /data-(?:spadewick|cardexy)-field="([^"]*)"/g

const escapeRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function renameSlugInSvg(svg, from, to) {
  const word = new RegExp(`\\b${escapeRegex(from)}\\b`, 'g')
  return svg
    .replace(new RegExp(`\\{\\{\\s*${escapeRegex(from)}\\s*\\}\\}`, 'g'), `{{${to}}}`)
    .replace(new RegExp(`(data-(?:spadewick|cardexy)-field=")${escapeRegex(from)}(")`, 'g'), `$1${to}$2`)
    .replace(COND_ATTR, m => m.replace(/="([^"]*)"/, (_, expr) => `="${expr.replace(word, to)}"`))
}
