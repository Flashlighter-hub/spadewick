/**
 * The rich text markup (PRD §16.3): what each form means, what happens to markup that does not pair up, and that
 * escaping makes any text show exactly as written.
 */
import { describe, it, expect } from 'vitest'
import { parseMarkup, stripMarkup, escapeMarkup, hasMarkupCharacters, iconKey } from '../../src/shared/richText.js'

const runsOf = text => parseMarkup(text).runs
const texts = text => runsOf(text).map(r => r.text)
const problems = text => parseMarkup(text).problems.map(p => p.type)
const flags = r => ['bold', 'italic', 'underline', 'strike'].filter(k => r[k]).join('+') || 'plain'

describe('emphasis', () => {
  it('reads bold, italic, both, underline and strikethrough', () => {
    expect(runsOf('a **b** c').map(flags)).toEqual(['plain', 'bold', 'plain'])
    expect(runsOf('a *b* c').map(flags)).toEqual(['plain', 'italic', 'plain'])
    expect(runsOf('a ***b*** c').map(flags)).toEqual(['plain', 'bold+italic', 'plain'])
    expect(runsOf('a __b__ c').map(flags)).toEqual(['plain', 'underline', 'plain'])
    expect(runsOf('a ~~b~~ c').map(flags)).toEqual(['plain', 'strike', 'plain'])
    expect(texts('a **b** c')).toEqual(['a ', 'b', ' c'])
  })

  it('nests and combines', () => {
    const r = runsOf('**bold *and italic* still bold**')
    expect(r.map(flags)).toEqual(['bold', 'bold+italic', 'bold'])
    expect(runsOf('__**both**__').map(flags)).toEqual(['bold+underline'])
    expect(runsOf('~~**x**~~').map(flags)).toEqual(['bold+strike'])
  })

  it('joins neighbours that look the same into one run', () => {
    expect(runsOf('plain **b** **c**').map(flags)).toEqual(['plain', 'bold', 'plain', 'bold'])
    expect(runsOf('ab').length).toBe(1)
    expect(runsOf('a **b** and **c** d').length).toBe(5)
    expect(runsOf('**a**x**b**').map(r => r.text)).toEqual(['a', 'x', 'b'])
  })

  it('needs a non-space next to the marker, so arithmetic and bullets stay as written', () => {
    expect(texts('2 * 3 * 4')).toEqual(['2 * 3 * 4'])
    expect(runsOf('2 * 3 * 4').map(flags)).toEqual(['plain'])
    expect(texts('a*b*c')).toEqual(['a', 'b', 'c']) // inside a word, a pair still works
    expect(runsOf('a*b*c').map(flags)).toEqual(['plain', 'italic', 'plain'])
  })

  it('does not underline inside a word (snake__case)', () => {
    expect(texts('snake__case__name')).toEqual(['snake__case__name'])
  })

  it('shows markup that does not pair up as written, and lists it', () => {
    expect(texts('**oops')).toEqual(['**oops'])
    expect(problems('**oops')).toEqual(['unmatched'])
    expect(texts('oops**')).toEqual(['oops**'])
    expect(texts('a *b **c*')).toEqual(['a ', 'b **c']) // the lone ** stays as text inside the italic run
    expect(problems('a *b **c*')).toEqual(['unmatched'])
  })

  it('keeps single underscores and tildes and long runs as characters', () => {
    expect(texts('a_b ~c **** ____ d')).toEqual(['a_b ~c **** ____ d'])
    expect(problems('a_b ~c')).toEqual([])
  })
})

describe('escapes', () => {
  it('reads a backslash before * _ ~ { } \\ as that character', () => {
    expect(texts('\\*not italic\\*')).toEqual(['*not italic*'])
    expect(texts('\\{fire\\}')).toEqual(['{fire}'])
    expect(texts('a\\\\b')).toEqual(['a\\b'])
    expect(texts('\\_\\_x\\_\\_')).toEqual(['__x__'])
  })

  it('leaves a backslash before anything else alone', () => {
    expect(texts('a\\b')).toEqual(['a\\b'])
    expect(texts('end\\')).toEqual(['end\\'])
  })

  it('makes any text show exactly as written (random strings)', () => {
    const alphabet = ['*', '_', '~', '{', '}', '\\', ' ', 'a', 'B', '1', '\n', ':', '#', '/', 'x', '%']
    let seed = 12345
    const rnd = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n }
    for (let i = 0; i < 4000; i++) {
      const s = Array.from({ length: rnd(14) }, () => alphabet[rnd(alphabet.length)]).join('')
      const back = parseMarkup(escapeMarkup(s))
      expect(back.runs.map(r => r.text ?? '').join(''), JSON.stringify(s)).toBe(s)
      expect(back.runs.some(r => r.icon), JSON.stringify(s)).toBe(false)
      expect(back.problems, JSON.stringify(s)).toEqual([])
    }
  })

  it('knows when text contains anything rich text would read differently', () => {
    expect(hasMarkupCharacters('plain words, 3 + 4')).toBe(false)
    for (const s of ['a*b', 'snake_case', 'x~y', '{fire}', 'back\\slash', 'a}']) expect(hasMarkupCharacters(s)).toBe(true)
  })
})

describe('icons', () => {
  it('reads {icon:name} and the short form {name}', () => {
    const r = runsOf('Tap {icon:fire} or {star}.')
    expect(r.map(x => x.icon ?? x.text)).toEqual(['Tap ', 'fire', ' or ', 'star', '.'])
    expect(r[1].scale).toBe(1)
  })

  it('reads a size multiple and a colour', () => {
    const r = runsOf('{icon:fire x1.4 color=#cc3333}')[0]
    expect(r.icon).toBe('fire')
    expect(r.scale).toBe(1.4)
    expect(r.iconColor).toBe('#cc3333')
    expect(runsOf('{icon:fire color=#abc}')[0].iconColor).toBe('#abc')
  })

  it('ignores a parameter it does not understand, and lists it', () => {
    expect(problems('{icon:fire x0 foo}')).toEqual(['badIconParam', 'badIconParam'])
    expect(runsOf('{icon:fire foo}')[0].icon).toBe('fire')
    expect(problems('{icon:fire color=red}')).toEqual(['badIconParam'])
  })

  it('treats names case-insensitively and hyphen and underscore alike', () => {
    expect(runsOf('{Fire_Ball}')[0].icon).toBe('fire-ball')
    expect(iconKey('  Fire Ball ')).toBe('fire-ball')
  })

  it('does not read reserved words as icons', () => {
    expect(texts('{color} {size} {font} {style} {icon}')).toEqual(['{color} {size} {font} {style} {icon}'])
  })

  it('leaves braces that are not markup as text', () => {
    expect(texts('{ not a tag } {a b} {}')).toEqual(['{ not a tag } {a b} {}'])
  })

  it('takes the text colour from the surroundings so the icon can follow it', () => {
    const r = runsOf('{color:#cc3333}{fire}{/color}')[0]
    expect(r.icon).toBe('fire')
    expect(r.color).toBe('#cc3333')
    expect(r.iconColor).toBeUndefined()
  })
})

describe('colour, size and font spans', () => {
  it('applies a colour to its span only, and nests', () => {
    const r = runsOf('a {color:#f00}b {color:#00f}c{/color} d{/color} e')
    expect(r.map(x => [x.text, x.color])).toEqual([['a ', undefined], ['b ', '#f00'], ['c', '#00f'], [' d', '#f00'], [' e', undefined]])
    expect(runsOf('{color:#abcd}x{/color}')[0].color).toBe('#abcd')
    expect(runsOf('{color:#aabbccdd}x{/color}')[0].color).toBe('#aabbccdd')
  })

  it('refuses anything but a hex colour, so nothing else can reach the picture', () => {
    for (const bad of ['red', 'rgb(1,2,3)', '#12', '#gg0000', 'url(#x)', '#ff0000"onload=']) {
      expect(texts(`{color:${bad}}x{/color}`).join(''), bad).toContain('x')
      expect(runsOf(`{color:${bad}}x{/color}`).every(r => !r.color), bad).toBe(true)
      expect(problems(`{color:${bad}}x{/color}`), bad).toContain('invalidColor')
    }
  })

  it('multiplies nested sizes and limits them to 10 to 500 per cent', () => {
    const r = runsOf('a{size:120%}b{size:50%}c{/size}d{/size}e')
    expect(r.map(x => [x.text, Math.round(x.size * 100) / 100])).toEqual([['a', 1], ['b', 1.2], ['c', 0.6], ['d', 1.2], ['e', 1]])
    for (const bad of ['5%', '600%', '120', 'big', '-10%']) expect(problems(`{size:${bad}}x{/size}`), bad).toContain('invalidSize')
  })

  it('reads a font name and refuses characters that do not belong in one', () => {
    expect(runsOf('{font:Cinzel Decorative}x{/font}')[0].font).toBe('Cinzel Decorative')
    expect(problems('{font:a"b}x{/font}')).toContain('invalidFont')
    expect(runsOf('{font:a"b}x{/font}').every(r => !r.font)).toBe(true)
  })

  it('shows tags without a partner as written, and lists them', () => {
    expect(texts('{color:#f00}abc')).toEqual(['{color:#f00}abc'])
    expect(problems('{color:#f00}abc')).toEqual(['unmatched'])
    expect(texts('abc{/color}')).toEqual(['abc{/color}'])
    expect(texts('{size:120%}a{/color}')).toEqual(['{size:120%}a{/color}'])
  })

  it('reads {style:name} but does not apply it yet, and lists the unknown style', () => {
    const r = parseMarkup('a {style:keyword}Flying{/style} b')
    expect(r.runs.map(x => x.text).join('')).toBe('a Flying b')
    expect(r.problems.map(p => p.type)).toEqual(['unknownStyle'])
    expect(parseMarkup('{style:keyword}x{/style}', { knownStyles: new Set(['keyword']) }).problems).toEqual([])
  })

  it('can mix everything in one string', () => {
    const r = runsOf('**Flying** {icon:star x1.2} {color:#c00}*red*{/color}\nNext{nbsp}line{shy}break')
    expect(r.map(x => x.icon ?? x.text)).toEqual(['Flying', ' ', 'star', ' ', 'red', '\nNext line­break'])
  })
})

describe('plain text without markup (PRD §16.7)', () => {
  it('strips emphasis, tags and escapes, and replaces an icon by its name', () => {
    expect(stripMarkup('**Flying** {icon:star} {color:#c00}red{/color} \\*x\\*')).toBe('Flying star red *x*')
    expect(stripMarkup('a{nbsp}b{shy}c')).toBe('a b­c')
    expect(stripMarkup('plain')).toBe('plain')
    expect(stripMarkup('')).toBe('')
    expect(stripMarkup(null)).toBe('')
  })

  it('lets the caller say what an icon is called', () => {
    expect(stripMarkup('{fire}', { iconText: n => `[${n}]` })).toBe('[fire]')
  })

  it('keeps unmatched markup, which is shown as written too', () => {
    expect(stripMarkup('**oops')).toBe('**oops')
  })

  it('copes with very long text', () => {
    const long = 'word **bold** *it* {fire} '.repeat(5000)
    const t = performance.now()
    const r = parseMarkup(long)
    expect(r.runs.length).toBeGreaterThan(1000)
    expect(performance.now() - t).toBeLessThan(1000)
  })
})
