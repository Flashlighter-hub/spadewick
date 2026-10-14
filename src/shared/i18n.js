/**
 * Translation lookup (PRD §14.5). Every user-facing string lives in strings.js; code asks for it by
 * key, so adding a language later means adding one more strings file and choosing it here.
 *
 *   tr('assetBrowser.import')                      → "+ Import"
 *   tr('assetBrowser.usedBy', { n: 3 })            → "Used by 3 cards"
 *
 * A string may contain {placeholders}, or be a function of the parameters (for plurals and
 * anything else a plain template cannot express).
 */
import { strings } from './strings.js'

let catalog = strings

/** Swap the active catalog (used by tests and, later, a language setting). */
export function setCatalog(next) { catalog = next ?? strings }

export function tr(key, params = {}) {
  let value = key.split('.').reduce((node, part) => node?.[part], catalog)
  if (value === undefined) value = key.split('.').reduce((node, part) => node?.[part], strings)   // fall back to English
  if (value === undefined) return key                                                             // visible, greppable, never a crash
  if (typeof value === 'function') return value(params)
  return value.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m))
}

export { plural } from './plural.js'
