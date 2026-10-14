/**
 * Keyword rules (PRD §16.5): "whenever the text contains X, show it as Y". Applied to the parsed runs of a rich text when a
 * card is drawn; the stored data stays plain, so a CSV opened in a spreadsheet still reads naturally.
 *
 *   rule  { match, wholeWord, ignoreCase, isPattern, mode: 'style'|'icon'|'icon_text'|'replace', action, scope, enabled }
 *     action  style: { style: name }   icon, icon_text: { icon: name }   replace: { text }
 *     scope   null (all rich text) or a list of field slugs
 *
 * Rules are tried in order; text a rule has claimed is not offered to a later one.
 */
import { iconKey } from './richText.js'

export const MAX_MATCH_LENGTH = 100
export const MAX_PATTERN_LENGTH = 200
const WORD_BEFORE = '(?<![\\p{L}\\p{N}_])', WORD_AFTER = '(?![\\p{L}\\p{N}_])'

/** Whether a pattern is one the app will run: short, valid, and without the nesting that makes matching explode. */
export function checkPattern(pattern) {
  const p = String(pattern ?? '')
  if (!p || p.length > MAX_PATTERN_LENGTH) return { ok: false, reason: 'length' }
  // a group that repeats and itself contains a repeat, such as (a+)+ or (a|b*)*, can take exponential time
  if (/\((?:[^()\\]|\\.)*[+*](?:[^()\\]|\\.)*\)\s*[+*{]/.test(p) || /\\[1-9]/.test(p)) return { ok: false, reason: 'nested' }
  try { new RegExp(p, 'u') } catch { return { ok: false, reason: 'syntax' } }
  return { ok: true }
}

const escapeRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The regular expression for a rule, or null when it cannot be used. Matches nothing empty. */
export function compileRule(rule) {
  const text = String(rule.match ?? '')
  if (!text.trim() || text.length > (rule.isPattern ? MAX_PATTERN_LENGTH : MAX_MATCH_LENGTH)) return null
  let source
  if (rule.isPattern) { if (!checkPattern(text).ok) return null; source = text } else source = escapeRegex(text)
  if (rule.wholeWord) source = `${WORD_BEFORE}(?:${source})${WORD_AFTER}`
  try { return new RegExp(source, `gu${rule.ignoreCase ? 'i' : ''}`) } catch { return null }
}

const appliesTo = (rule, slug) => rule.enabled !== false && (rule.scope == null || (slug != null && rule.scope.includes(slug)))

/**
 * @param {object[]} runs from parseMarkup
 * @param {object[]} rules in order
 * @param {{ slug?: string }} [where] the field the text comes from, for rules limited to some fields
 * @returns {object[]} runs with the rules applied; a styled keyword gets the style name in `styles`
 */
export function applyKeywordRules(runs, rules, where = {}) {
  const active = rules.filter(r => appliesTo(r, where.slug)).map(r => ({ rule: r, re: compileRule(r) })).filter(x => x.re)
  if (!active.length) return runs
  let pieces = runs.map(run => ({ run, locked: !!run.icon }))
  for (const { rule, re } of active) {
    const next = []
    for (const piece of pieces) {
      if (piece.locked || piece.run.text === undefined) { next.push(piece); continue }
      const text = piece.run.text
      const matches = [...text.matchAll(re)].filter(m => m[0] !== '')
      if (!matches.length) { next.push(piece); continue }
      let at = 0
      for (const m of matches) {
        if (m.index > at) next.push({ run: { ...piece.run, text: text.slice(at, m.index) }, locked: false })
        next.push(...replacement(rule, piece.run, m[0]))
        at = m.index + m[0].length
      }
      if (at < text.length) next.push({ run: { ...piece.run, text: text.slice(at) }, locked: false })
    }
    pieces = next
  }
  return pieces.map(p => p.run).filter(r => r.icon || r.text !== '')
}

function replacement(rule, run, matched) {
  const action = rule.action ?? {}
  const icon = name => ({ ...run, icon: iconKey(name), scale: 1, iconColor: undefined, text: undefined })
  if (rule.mode === 'style') return [{ run: { ...run, text: matched, styles: [...run.styles, iconKey(action.style ?? '')] }, locked: true }]
  if (rule.mode === 'icon') return [{ run: icon(action.icon ?? ''), locked: true }]
  if (rule.mode === 'icon_text') return [{ run: icon(action.icon ?? ''), locked: true }, { run: { ...run, text: matched }, locked: true }]
  return [{ run: { ...run, text: String(action.text ?? '') }, locked: true }]
}
