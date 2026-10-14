/**
 * Text style properties, keyword rules, and renaming icons and styles inside markup (PRD §16.4, §16.5).
 */
import { describe, it, expect } from 'vitest'
import { parseMarkup, renameIconInMarkup, renameStyleInMarkup, stripMarkup } from '../../src/shared/richText.js'
import { normalizeStyleProps, mergeStyles, STYLE_KEYS } from '../../src/shared/textStyleProps.js'
import { applyKeywordRules, compileRule, checkPattern } from '../../src/shared/keywords.js'

const rule = (o = {}) => ({ match: 'Flying', wholeWord: true, ignoreCase: false, isPattern: false, mode: 'style', action: { style: 'keyword' }, scope: null, enabled: true, ...o })
const apply = (text, rules, where) => applyKeywordRules(parseMarkup(text).runs, rules, where)
const shape = runs => runs.map(r => (r.icon ? `<${r.icon}>` : r.styles.length ? `[${r.styles.join('+')}:${r.text}]` : r.text)).join('')

describe('style properties', () => {
  it('keeps the valid ones and names the refused', () => {
    const { props, rejected } = normalizeStyleProps({ bold: true, color: '#cc3333', size: 1.2, tracking: 20, fontFamily: 'Cinzel', bogus: 1, outlineColor: 'red', shadowX: 9 })
    expect(props).toEqual({ bold: true, color: '#cc3333', size: 1.2, tracking: 20, fontFamily: 'Cinzel' })
    expect(rejected.sort()).toEqual(['bogus', 'outlineColor', 'shadowX'])
  })

  it('leaves out switches that are off and empty values', () => {
    expect(normalizeStyleProps({ bold: false, italic: null, color: '', underline: true }).props).toEqual({ underline: true })
    expect(normalizeStyleProps({ bold: 'yes' }).rejected).toEqual(['bold'])
    expect(normalizeStyleProps(null)).toEqual({ props: {}, rejected: [] })
  })

  it('limits numbers to sensible ranges and refuses unsafe font names', () => {
    expect(normalizeStyleProps({ size: 0 }).rejected).toEqual(['size'])
    expect(normalizeStyleProps({ size: 6 }).rejected).toEqual(['size'])
    expect(normalizeStyleProps({ outlineWidth: 0.5 }).rejected).toEqual(['outlineWidth'])
    expect(normalizeStyleProps({ fontFamily: 'a"b' }).rejected).toEqual(['fontFamily'])
    expect(normalizeStyleProps({ color: 'url(#x)' }).rejected).toEqual(['color'])
    expect(STYLE_KEYS).toContain('smallCaps')
  })

  it('merges styles, the later one winning', () => {
    expect(mergeStyles([{ color: '#111111', bold: true }, { color: '#222222' }, null])).toEqual({ color: '#222222', bold: true })
  })
})

describe('keyword rules', () => {
  it('styles a whole word wherever it appears, and not inside another word', () => {
    expect(shape(apply('Flying creatures, flying not, Flyingfox, Flying.', [rule()]))).toBe('[keyword:Flying] creatures, flying not, Flyingfox, [keyword:Flying].')
  })

  it('honours ignore case, and part-of-word matching when whole word is off', () => {
    expect(shape(apply('Flying flying FLYING', [rule({ ignoreCase: true })]))).toBe('[keyword:Flying] [keyword:flying] [keyword:FLYING]')
    expect(shape(apply('Flyingfox', [rule({ wholeWord: false })]))).toBe('[keyword:Flying]fox')
  })

  it('shows a keyword as an icon, an icon followed by the text, or other text', () => {
    expect(shape(apply('a Flying b', [rule({ mode: 'icon', action: { icon: 'wing' } })]))).toBe('a <wing> b')
    const both = apply('a Flying b', [rule({ mode: 'icon_text', action: { icon: 'wing' } })])
    expect(shape(both)).toBe('a <wing>Flying b')
    expect(shape(apply('a Flying b', [rule({ mode: 'replace', action: { text: 'Soaring' } })]))).toBe('a Soaring b')
  })

  it('keeps the formatting of the text around a keyword', () => {
    const runs = apply('**Flying** and *Flying*', [rule()])
    expect(runs.filter(r => r.styles.length).map(r => [r.text, r.bold, r.italic])).toEqual([['Flying', true, false], ['Flying', false, true]])
  })

  it('tries rules in order, and a keyword claimed by one is not offered to the next', () => {
    const rules = [rule({ match: 'Flying', action: { style: 'first' } }), rule({ match: 'Flying', action: { style: 'second' } }), rule({ match: 'Fly', wholeWord: false, action: { style: 'third' } })]
    expect(shape(apply('Flying', rules))).toBe('[first:Flying]')
    expect(shape(apply('Fly and Flying', [rules[2], rules[0]]))).toBe('[third:Fly] and [third:Fly][ing]'.replace('[ing]', 'ing'))
  })

  it('does not touch icons, and does not match across run boundaries', () => {
    expect(shape(apply('{Flying} and Fl**yi**ng', [rule()]))).toBe('<flying> and Flying'.replace('Flying', 'Fl' + 'yi' + 'ng'))
  })

  it('applies a rule only to its fields, and not when switched off', () => {
    const only = rule({ scope: ['rules'] })
    expect(shape(apply('Flying', [only], { slug: 'rules' }))).toBe('[keyword:Flying]')
    expect(shape(apply('Flying', [only], { slug: 'flavor' }))).toBe('Flying')
    expect(shape(apply('Flying', [only]))).toBe('Flying')
    expect(shape(apply('Flying', [rule({ enabled: false })]))).toBe('Flying')
    expect(shape(apply('Flying', [rule({ scope: null })], {}))).toBe('[keyword:Flying]')
  })

  it('matches patterns, and refuses ones that could take forever', () => {
    expect(shape(apply('Deal 3 damage, deal 12 damage', [rule({ isPattern: true, match: 'deal \\d+ damage', ignoreCase: true, wholeWord: false })]))).toBe('[keyword:Deal 3 damage], [keyword:deal 12 damage]')
    expect(checkPattern('(a+)+$')).toEqual({ ok: false, reason: 'nested' })
    expect(checkPattern('(a|b*)*')).toEqual({ ok: false, reason: 'nested' })
    expect(checkPattern('(a)\\1')).toEqual({ ok: false, reason: 'nested' })
    expect(checkPattern('[')).toEqual({ ok: false, reason: 'syntax' })
    expect(checkPattern('x'.repeat(300))).toEqual({ ok: false, reason: 'length' })
    expect(checkPattern('a+b')).toEqual({ ok: true })
    expect(compileRule(rule({ isPattern: true, match: '(a+)+$' }))).toBeNull()
    const t = performance.now()
    apply('a'.repeat(5000) + '!', [rule({ isPattern: true, match: '(a+)+$' })])
    expect(performance.now() - t).toBeLessThan(200) // the dangerous rule was not run
  })

  it('never matches the empty string, and ignores an empty or oversized match', () => {
    expect(shape(apply('abc', [rule({ isPattern: true, match: 'x*', wholeWord: false })]))).toBe('abc')
    expect(compileRule(rule({ match: '  ' }))).toBeNull()
    expect(compileRule(rule({ match: 'x'.repeat(101) }))).toBeNull()
  })

  it('treats a regex character in a plain keyword as itself', () => {
    expect(shape(apply('cost (X)', [rule({ match: '(X)', wholeWord: false })]))).toBe('cost [keyword:(X)]')
  })

  it('finds Unicode words', () => {
    expect(shape(apply('Fliegen', [rule({ match: 'Fliegen' })]))).toBe('[keyword:Fliegen]')
    expect(shape(apply('Überflug', [rule({ match: 'flug' })]))).toBe('Überflug')
  })
})

describe('renaming inside markup', () => {
  it('renames an icon in both forms, with its parameters, and nowhere else', () => {
    expect(renameIconInMarkup('a {icon:fire x1.4 color=#cc3333} b {fire} c {fire2} d \\{fire\\} e {icon:fire}', 'fire', 'flame'))
      .toBe('a {icon:flame x1.4 color=#cc3333} b {flame} c {fire2} d \\{fire\\} e {icon:flame}')
    expect(renameIconInMarkup('{Fire}', 'FIRE', 'flame')).toBe('{flame}')
    expect(renameIconInMarkup('nothing here', 'fire', 'x')).toBe('nothing here')
    expect(stripMarkup(renameIconInMarkup('{fire}', 'fire', 'flame'))).toBe('flame')
  })

  it('renames a style on its opening tag', () => {
    expect(renameStyleInMarkup('{style:keyword}A{/style} {style:Keyword}B{/style} {style:other}C{/style}', 'keyword', 'kw'))
      .toBe('{style:kw}A{/style} {style:kw}B{/style} {style:other}C{/style}')
  })

  it('keeps the style names of runs as keys', () => {
    const runs = parseMarkup('{style:My Style}x{/style}', { knownStyles: new Set(['my-style']) })
    expect(runs.problems).toEqual([])
    expect(runs.runs[0].styles).toEqual(['my-style'])
  })
})
