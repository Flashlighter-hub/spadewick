/**
 * The built-in guide (UPDATES U11): it cannot go out of date, because it is built from the formula language itself and checked against it.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { evaluateFormula, FORMULA_FUNCTIONS, FORMULA_OPERATORS, HELP_SAMPLE } from '../../src/main/formula.js'
import { HELP_GROUPS, HELP_SECTIONS, HELP_ITEMS, HELP_EXAMPLES } from '../../src/shared/help.js'
import { strings } from '../../src/shared/strings.js'

const names = Object.values(FORMULA_FUNCTIONS).flat()
const keysOf = o => Object.keys(o).sort()

describe('the formula functions in the guide', () => {
  it('lists every function the evaluator understands, and no other', () => {
    const source = readFileSync('src/main/formula.js', 'utf8')
    const body = source.slice(source.indexOf('function applyFn'))
    const implemented = [...body.matchAll(/case '([a-z_]+)':/g)].map(m => m[1])
    expect(implemented.sort()).toEqual([...names].sort())
  })

  it('has a help entry for each function: how it is written, what it does, an example and what the example gives', () => {
    for (const name of names) {
      const entry = strings.help.fn[name]
      expect(entry, `help for ${name}`).toBeTruthy()
      expect(keysOf(entry), name).toEqual(['does', 'example', 'result', 'sig'])
      for (const v of Object.values(entry)) expect(v.length, name).toBeGreaterThan(0)
      expect(entry.sig.startsWith(`${name}(`), `${name} is written as ${entry.sig}`).toBe(true)
    }
    expect(keysOf(strings.help.fn)).toEqual([...names].sort())   // nothing is left over for a function that is gone
  })

  it('has a help entry for each operator', () => {
    expect(keysOf(strings.help.ops)).toEqual([...FORMULA_OPERATORS].sort())
    for (const op of FORMULA_OPERATORS) expect(keysOf(strings.help.ops[op])).toEqual(['does', 'example', 'result'])
  })

  it('names every group of functions', () => {
    expect(keysOf(strings.help.formulas.groups)).toEqual(keysOf(FORMULA_FUNCTIONS))
  })

  it('every example gives what the guide says it gives, worked out by the real evaluator on the sample card', () => {
    for (const name of names) {
      const { example, result } = strings.help.fn[name]
      expect(evaluateFormula(example, HELP_SAMPLE), `${name}: ${example}`).toBe(result)
    }
    for (const op of FORMULA_OPERATORS) {
      const { example, result } = strings.help.ops[op]
      expect(evaluateFormula(example, HELP_SAMPLE), `${op}: ${example}`).toBe(result)
    }
    for (const key of HELP_EXAMPLES) {
      const { formula, result } = strings.help.examples[key]
      expect(evaluateFormula(formula, HELP_SAMPLE), `${key}: ${formula}`).toBe(result)
    }
    expect(keysOf(strings.help.examples)).toEqual([...HELP_EXAMPLES].sort())
  })

  it('uses a function in its example that really is that function (not a field that has the same name)', () => {
    for (const name of names) expect(strings.help.fn[name].example, name).toContain(`${name}(`)
  })
})

describe('the other guides', () => {
  it('every section has a name, and every entry the words that go with it', () => {
    expect(keysOf(strings.help.sections)).toEqual([...HELP_SECTIONS].sort())
    for (const [section, keys] of Object.entries(HELP_ITEMS)) {
      const words = strings.help.items[section]
      expect(words, section).toBeTruthy()
      expect(keysOf(words), section).toEqual(['intro', ...keys].sort())
      for (const key of keys) {
        expect(Object.keys(words[key]).sort(), `${section}.${key}`).toEqual(['code', 'text', 'title'])
        expect(words[key].title.length, `${section}.${key} title`).toBeGreaterThan(0)
        expect(words[key].text.length, `${section}.${key} text`).toBeGreaterThan(0)
      }
    }
    expect(keysOf(strings.help.items)).toEqual(Object.keys(HELP_ITEMS).sort())
  })

  it('the template tokens it shows are the ones the renderer fills', () => {
    const render = readFileSync('src/main/render.js', 'utf8'), ids = readFileSync('src/main/cardIds.js', 'utf8')
    for (const token of ['@card.id', '@card.number', '@card.count']) expect(ids).toContain(token)
    expect(render).toMatch(/@asset/)
    expect(render).toContain('display_name')
    for (const key of HELP_ITEMS.tokens) expect(strings.help.items.tokens[key].code).toMatch(/^\{\{.+\}\}$/)
  })

  it('every attribute it names for fitting text exists in the text engine', () => {
    const engine = ['src/main/dynamicText.js', 'src/main/text/svgText.js', 'src/main/text/controls.js', 'src/main/text/layout.js', 'src/main/render.js'].map(f => readFileSync(f, 'utf8')).join('\n')
    for (const section of ['fitting', 'conditions']) {
      for (const key of HELP_ITEMS[section]) {
        for (const m of strings.help.items[section][key].code.matchAll(/data-spadewick-([a-z-]+)/g)) expect(engine, `${section}.${key}: ${m[0]}`).toContain(`data-spadewick-${m[1]}`)
        for (const m of strings.help.items[section][key].text.matchAll(/data-spadewick-([a-z-]+)/g)) expect(engine, `${section}.${key}: ${m[0]}`).toContain(`data-spadewick-${m[1]}`)
      }
    }
  })
})

describe('the whole guide', () => {
  it('puts every section in exactly one group, and names every group', () => {
    const all = Object.values(HELP_GROUPS).flat()
    expect(new Set(all).size).toBe(all.length)
    expect(all.sort()).toEqual(keysOf(strings.help.sections))
    expect(keysOf(strings.help.groups)).toEqual(keysOf(HELP_GROUPS))
  })

  it('has something to say in every section, and no entry that is empty', () => {
    for (const section of HELP_SECTIONS) {
      expect(HELP_ITEMS[section].length, section + ' has entries').toBeGreaterThan(2)
      expect(strings.help.items[section].intro.length, section + ' intro').toBeGreaterThan(20)
      for (const key of HELP_ITEMS[section]) expect(strings.help.items[section][key].text.length, section + '.' + key).toBeGreaterThan(10)
    }
  })

  it('every template attribute named anywhere in the guide exists in the application', () => {
    const source = ['src/main/dynamicText.js', 'src/main/text/svgText.js', 'src/main/text/controls.js', 'src/main/text/layout.js', 'src/main/render.js', 'src/main/svgImport/build.js', 'src/main/svgImport/bind.js', 'src/renderer/src/components/CanvasEditor.svelte', 'src/renderer/src/lib/docEdit.js'].map(f => readFileSync(f, 'utf8')).join(String.fromCharCode(10))
    const seen = new Set()
    for (const section of Object.values(strings.help.items)) {
      for (const entry of Object.values(section)) {
        if (typeof entry !== 'object') continue
        for (const m of (entry.code + ' ' + entry.text).matchAll(/data-spadewick-([a-z]+(?:-[a-z]+)*)/g)) seen.add(m[0])
      }
    }
    for (const attr of seen) expect(source, attr).toContain(attr)
  })

  it('every shortcut it names is wired to something', () => {
    const view = readFileSync('src/renderer/src/components/CanvasEditor.svelte', 'utf8')
    for (const k of ["'g'", "'d'", "'a'", "'c'", "'x'", "'v'"]) expect(view).toContain("k === " + k)
    expect(readFileSync('src/main/index.js', 'utf8')).toContain('CmdOrCtrl+H')
  })
})
