/**
 * Field value validation (PRD §5.3), shared by the card table editor and CSV/JSON import so a value
 * is accepted or rejected the same way wherever it enters the project.
 * Image references are resolved elsewhere (they need the asset list).
 */

import { tr } from './i18n.js'
import { parseRules, optionsOf, splitTags, joinTags, closestOption } from './fieldTypes.js'

export { parseRules }

/** @returns {{ value: string } | { error: string }} the normalised value, or why it was rejected */
export function validateValue(field, raw) {
  const value = String(raw ?? '')
  if (value === '') return { value }
  const rules = parseRules(field.validation)

  switch (field.type) {
    case 'number': {
      const n = Number(value)
      if (Number.isNaN(n)) return { error: tr('validation.notNumber', { value }) }
      if (rules.min != null && n < rules.min) return { error: tr('validation.belowMin', { n, min: rules.min }) }
      if (rules.max != null && n > rules.max) return { error: tr('validation.aboveMax', { n, max: rules.max }) }
      return { value }
    }
    case 'boolean': {
      const v = value.trim().toLowerCase()
      if (['true', '1', 'yes'].includes(v)) return { value: 'true' }
      if (['false', '0', 'no'].includes(v)) return { value: 'false' }
      return { error: tr('validation.notBoolean', { value }) }
    }
    case 'color':
      return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value) ? { value } : { error: tr('validation.notColor', { value }) }
    case 'choice': {
      const options = optionsOf(field)
      if (!options.length) return { value }   // a list that is not written yet allows anything
      const hit = options.find(o => o.toLowerCase() === value.trim().toLowerCase())   // "support" is the value "Support"
      if (hit) return { value: hit }
      const near = closestOption(value, options)
      const list = options.join(', ')
      return { error: near ? tr('validation.notInListDidYouMean', { value, list, near }) : tr('validation.notInList', { value, list }) }
    }
    case 'tags': {
      const options = optionsOf(field)
      const tags = splitTags(value)
      if (!options.length) return { value: joinTags(tags) }
      const out = []
      for (const tag of tags) {
        const hit = options.find(o => o.toLowerCase() === tag.toLowerCase())
        if (!hit) {
          const near = closestOption(tag, options)
          const list = options.join(', ')
          return { error: near ? tr('validation.notInListDidYouMean', { value: tag, list, near }) : tr('validation.notInList', { value: tag, list }) }
        }
        if (!out.includes(hit)) out.push(hit)
      }
      return { value: joinTags(out) }
    }
    case 'image_ref':
    case 'formula':
    case 'lookup':
      return { value }
    default: {
      if (rules.regex) {
        let re
        try { re = new RegExp(rules.regex) } catch { return { value } } // a broken rule never blocks data entry
        if (!re.test(value)) return { error: tr('validation.noMatch', { value, pattern: rules.regex }) }
      }
      return { value }
    }
  }
}

export const MAX_QUANTITY = 999

/** Copies of a card in exports (PRD §6.5): a whole number from 0 to 999. A blank value means the default of 1. */
export function validateQuantity(raw) {
  const text = String(raw ?? '').trim()
  if (text === '') return { value: 1 }
  const n = Number(text)
  if (!Number.isInteger(n) || n < 0 || n > MAX_QUANTITY) return { error: tr('validation.quantity', { value: text, max: MAX_QUANTITY }) }
  return { value: n }
}
