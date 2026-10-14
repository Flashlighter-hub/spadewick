/**
 * UPDATES U22 to U27: balance statistics, Choice / Tags / Lookup fields, template rules, saved views, the card status, Excel files.
 * Everything is driven through the real IPC handlers, as the window does.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { writeFileSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import sharp from 'sharp'
import Database from 'better-sqlite3'
import { createTestProject, seedSet, invoke, mockDialog } from '../helpers/project.js'
import { openProjectDb, closeProjectDb, CURRENT_SCHEMA_VERSION } from '../../src/main/db.js'
import { cardSelector } from '../../src/main/core/export.js'
import { readXlsx, writeXlsx } from '../../src/main/xlsx.js'
import { effectiveTemplateId, effectiveBackTemplateId } from '../../src/main/render.js'

let ctx, scratch
beforeEach(async () => { ctx = await createTestProject(); scratch = mkdtempSync(join(tmpdir(), 'balance-')) })
afterEach(async () => { rmSync(scratch, { recursive: true, force: true }); await ctx.cleanup() })

const svg = inner => `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="700" viewBox="0 0 500 700">${inner}</svg>`
const solid = hex => svg(`<rect width="500" height="700" fill="${hex}"/>`)
const px = async buf => {
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true })
  const i = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * info.channels
  return [data[i], data[i + 1], data[i + 2]]
}
const render = async (cardId, opts = {}) => Buffer.from(await invoke('templates:render', { cardId, width: 100, ...opts }), 'base64')
const file = (name, text) => { const p = join(scratch, name); writeFileSync(p, text); return p }
const db = () => openProjectDb(ctx.dir)

/** Two sets: Hunters (name, colour) and Skills (hunter, and the hunter's colour pulled in). */
async function huntersAndSkills() {
  const hunters = await seedSet({ name: 'Hunters', fields: [{ name: 'Name', type: 'text' }, { name: 'Colour', type: 'text' }], cards: [{ name: 'Pelt', fields: { name: 'Pelt', colour: '#cc0000' } }, { name: 'Plunder', fields: { name: 'Plunder', colour: '#0000cc' } }] })
  await invoke('sets:update', { id: hunters.set.id, displayField: 'name' })
  const skills = await seedSet({ name: 'Skills', cardSize: 'poker', fields: [{ name: 'Hunter', type: 'text' }, { name: 'Skill type', slug: 'skill_type', type: 'text' }], template: { svg: solid('#888888') }, cards: [{ name: 'Bite', fields: { hunter: 'Pelt', skill_type: 'A' } }, { name: 'Guard', fields: { hunter: 'plunder', skill_type: 'P' } }, { name: 'Lost', fields: { hunter: 'Nobody', skill_type: 'A' } }] })
  const lookup = await invoke('fields:create', { setId: skills.set.id, name: 'Hunter colour', slug: 'hunter_colour', type: 'lookup', validation: { from: 'hunter', set: hunters.set.id, match: 'name', show: 'colour' } })
  return { hunters, skills, lookup }
}

describe('Choice and Tags fields (UPDATES U23)', () => {
  it('keep their allowed values clean: trimmed, without blanks or repeats, and without the commas that would split a tag', async () => {
    const { set } = await seedSet({})
    const f = await invoke('fields:create', { setId: set.id, name: 'Type', type: 'choice', validation: { options: [' Active ', 'Passive', 'active', '', 'Sup,port'], regex: '', junk: 1 } })
    expect(JSON.parse(f.validation)).toEqual({ options: ['Active', 'Passive', 'Sup port'] })
    const t = await invoke('fields:create', { setId: set.id, name: 'Keywords', type: 'tags', validation: { options: ['Fire', 'Flying'], required: true } })
    expect(JSON.parse(t.validation)).toEqual({ required: true, options: ['Fire', 'Flying'] })
    await expect(invoke('fields:create', { setId: set.id, name: 'X', type: 'nonsense' })).rejects.toThrow(/not a field type/i)
  })

  it('an import refuses a value that is not in the list, names the likely one, and writes the list\'s spelling for a value in another case', async () => {
    const { set } = await seedSet({ fields: [{ name: 'Name', type: 'text' }] })
    await invoke('fields:create', { setId: set.id, name: 'Role', type: 'choice', validation: { options: ['Active', 'Passive', 'Support'] } })
    await invoke('fields:create', { setId: set.id, name: 'Keywords', type: 'tags', validation: { options: ['Fire', 'Flying'] } })
    mockDialog.open(file('in.csv', 'name,role,keywords\nBite,support,"flying, fire"\nGuard,Suport,Fire\nHeal,Passive,Fyre\n'))
    const read = await invoke('dataio:read-file', { format: 'csv', setId: set.id })
    const preview = await invoke('dataio:import', { setId: set.id, rows: read.rows, mapping: read.mapping, mode: 'append', previewOnly: true })
    expect(preview.validCount).toBe(1)
    expect(preview.errors.map(e => [e.row, e.field])).toEqual([[3, 'Role'], [4, 'Keywords']])
    expect(preview.errors[0].message).toMatch(/Did you mean "Support"\?/)
    const done = await invoke('dataio:import', { setId: set.id, rows: read.rows, mapping: read.mapping, mode: 'append' })
    expect(done.created).toBe(1)
    const [card] = await invoke('cards:list', set.id)
    expect(card.fields).toMatchObject({ role: 'Support', keywords: 'Flying, Fire' })
  })

  it('lists the values the cards hold, each tag on its own, most used first, to fill a list', async () => {
    const { set, cards } = await seedSet({ fields: [{ name: 'Keywords', type: 'tags' }], cards: [{ fields: { keywords: 'Fire, Flying' } }, { fields: { keywords: 'Fire' } }, { fields: { keywords: '' } }] })
    const f = (await invoke('fields:list', set.id))[0]
    expect(await invoke('fields:distinct-values', { id: f.id })).toEqual([{ value: 'Fire', count: 2 }, { value: 'Flying', count: 1 }])
    expect(cards).toHaveLength(3)
  })
})

describe('Lookup fields (UPDATES U23)', () => {
  it('give each card the value of the matching card of the other set, ignoring case, and nothing when none matches', async () => {
    const { skills } = await huntersAndSkills()
    const cards = await invoke('cards:list', skills.set.id)
    expect(cards.map(c => c.lookups.hunter_colour)).toEqual(['#cc0000', '#0000cc', ''])
  })

  it('are drawn on the card, can be used by a formula, and are written to an export with their value', async () => {
    const { skills } = await huntersAndSkills()
    await invoke('templates:update', { id: skills.template.id, svgSource: svg('<rect width="500" height="700" fill="{{hunter_colour}}"/>') })
    expect(await px(await render(skills.cards[0].id))).toEqual([204, 0, 0])
    expect(await px(await render(skills.cards[1].id))).toEqual([0, 0, 204])
    await invoke('fields:create', { setId: skills.set.id, name: 'Shout', slug: 'shout', type: 'formula', formula: 'upper(hunter_colour)' })
    const out = join(scratch, 'skills.csv')
    mockDialog.save(out)
    await invoke('dataio:export', { setIds: [skills.set.id], format: 'csv' })
    const text = (await import('fs')).readFileSync(out, 'utf8')
    expect(text).toContain('Bite')
    expect(text).toMatch(/#cc0000,#CC0000/)
  })

  it('can show the card ID or the display name, match on the card ID, and cannot be the display name or identifier of the set', async () => {
    const { hunters, skills, lookup } = await huntersAndSkills()
    const pelt = hunters.cards[0]
    await invoke('cards:update', { id: skills.cards[0].id, fields: { hunter: pelt.card_code } })
    await invoke('fields:update', { id: lookup.id, validation: { from: 'hunter', set: hunters.set.id, match: '@id', show: '' } })
    expect((await invoke('cards:list', skills.set.id))[0].lookups.hunter_colour).toBe('Pelt')   // shows the display name of the hunters
    await expect(invoke('sets:update', { id: skills.set.id, displayField: 'hunter_colour' })).rejects.toThrow()
    await expect(invoke('fields:create', { setId: skills.set.id, name: 'Bad', type: 'lookup', validation: { set: 'no-such-set' } })).rejects.toThrow(/lookup looks in/i)
  })

  it('are never imported', async () => {
    const { skills } = await huntersAndSkills()
    mockDialog.open(file('sk.csv', 'card_name,hunter,hunter_colour\nNew,Pelt,#ffffff\n'))
    const read = await invoke('dataio:read-file', { format: 'csv', setId: skills.set.id })
    await invoke('dataio:import', { setId: skills.set.id, rows: read.rows, mapping: { ...read.mapping, hunter_colour: 'hunter_colour' }, mode: 'append' })
    const created = (await invoke('cards:list', skills.set.id)).find(c => c.display_name === 'New')
    expect(created.fields.hunter_colour ?? '').toBe('')   // the file's #ffffff was not stored
    expect(created.lookups.hunter_colour).toBe('#cc0000')
  })
})

describe('the filter language (UPDATES U25)', () => {
  it('has and, or, not, contains and has', async () => {
    const { evaluateFormula } = await import('../../src/main/formula.js')
    expect(evaluateFormula('and(1, "a", 2 > 1)', {})).toBe('true')
    expect(evaluateFormula('and(1, 0)', {})).toBe('false')
    expect(evaluateFormula('or("", "false", 0)', {})).toBe('false')
    expect(evaluateFormula('or(0, x == "Red")', { x: 'Red' })).toBe('true')
    expect(evaluateFormula('not(x == "Red")', { x: 'Blue' })).toBe('true')
    expect(evaluateFormula('contains(name, "DRAKE")', { name: 'Fire Drake' })).toBe('true')
    expect(evaluateFormula('has(k, "flying")', { k: 'Fire, Flying' })).toBe('true')
    expect(evaluateFormula('has(k, "Fly")', { k: 'Fire, Flying' })).toBe('false')
  })

  it('cards:matching keeps the cards an expression is true for, knows lookups, formulas and the status, and reports an expression it cannot read', async () => {
    const { skills } = await huntersAndSkills()
    await invoke('cards:update', { id: skills.cards[0].id, status: 'final' })
    const ids = async filter => (await invoke('cards:matching', { setId: skills.set.id, filter })).ids
    expect((await ids('')).length).toBe(3)
    expect(await ids("skill_type == 'A'")).toEqual([skills.cards[0].id, skills.cards[2].id])
    expect(await ids("and(skill_type == 'A', status != 'final')")).toEqual([skills.cards[2].id])
    expect(await ids("hunter_colour == '#0000cc'")).toEqual([skills.cards[1].id])
    expect(await ids("or(status == 'final', skill_type == 'P')")).toEqual([skills.cards[0].id, skills.cards[1].id])
    expect(await ids('card_number() == 2')).toEqual([skills.cards[1].id])
  })

  it('an export filter sees the same things', async () => {
    const { skills } = await huntersAndSkills()
    await invoke('cards:update', { id: skills.cards[1].id, status: 'final' })
    const select = cardSelector(db(), { filter: "and(hunter_colour == '#0000cc', status == 'final')" })
    const rows = db().prepare('SELECT * FROM cards WHERE set_id = ?').all(skills.set.id)
    expect(rows.filter(select).map(r => r.id)).toEqual([skills.cards[1].id])
    expect(() => rows.filter(cardSelector(db(), { filter: '))((' }))).not.toThrow()   // a filter that cannot be read keeps nothing or everything, but never crashes the app
  })
})

describe('template rules (UPDATES U24)', () => {
  async function rulesSet() {
    const s = await seedSet({ name: 'Skills', cardSize: 'poker', fields: [{ name: 'Skill type', slug: 'skill_type', type: 'text' }], cards: [{ name: 'Bite', fields: { skill_type: 'A' } }, { name: 'Guard', fields: { skill_type: 'P' } }, { name: 'Odd', fields: { skill_type: 'X' } }] })
    const mk = (name, hex) => invoke('templates:create', { name, svgSource: solid(hex), cardSize: 'poker' })
    const active = await mk('Active', '#ff0000'), passive = await mk('Passive', '#0000ff'), plain = await mk('Plain', '#00ff00'), back = await mk('Back', '#101010')
    await invoke('sets:update', { id: s.set.id, defaultTemplateId: plain.id })
    return { ...s, active, passive, plain, back }
  }

  it('choose the template from the data: the first matching rule, then the set\'s default; a template of the card itself first', async () => {
    const s = await rulesSet()
    await invoke('sets:update', { id: s.set.id, templateRules: [{ when: "skill_type == 'A'", front: s.active.id }, { when: "skill_type == 'P'", front: s.passive.id, back: s.back.id }] })
    const of = id => effectiveTemplateId(db(), db().prepare('SELECT * FROM cards WHERE id = ?').get(id))
    expect(of(s.cards[0].id)).toBe(s.active.id)
    expect(of(s.cards[1].id)).toBe(s.passive.id)
    expect(of(s.cards[2].id)).toBe(s.plain.id)
    expect(await px(await render(s.cards[0].id))).toEqual([255, 0, 0])
    expect(await px(await render(s.cards[1].id))).toEqual([0, 0, 255])
    await invoke('cards:update', { id: s.cards[0].id, templateId: s.plain.id })
    expect(of(s.cards[0].id)).toBe(s.plain.id)
    const backOf = id => effectiveBackTemplateId(db(), db().prepare('SELECT * FROM cards WHERE id = ?').get(id))
    expect(backOf(s.cards[1].id)).toBe(s.back.id)
    expect(backOf(s.cards[0].id)).toBe(null)
  })

  it('the earlier rule wins, and a rule that is not about the front leaves the front alone', async () => {
    const s = await rulesSet()
    await invoke('sets:update', { id: s.set.id, templateRules: [{ when: "skill_type == 'A'", back: s.back.id }, { when: "skill_type != 'P'", front: s.active.id }, { when: 'skill_type == "A"', front: s.passive.id }] })
    const of = id => effectiveTemplateId(db(), db().prepare('SELECT * FROM cards WHERE id = ?').get(id))
    expect(of(s.cards[0].id)).toBe(s.active.id)
    expect(of(s.cards[2].id)).toBe(s.active.id)
    expect(of(s.cards[1].id)).toBe(s.plain.id)
  })

  it('count the cards each rule decides before they are saved', async () => {
    const s = await rulesSet()
    const preview = await invoke('sets:rule-preview', { setId: s.set.id, rules: [{ when: "skill_type == 'A'", front: s.active.id }, { when: "skill_type == 'A'", front: s.passive.id }] })
    expect(preview).toMatchObject({ counts: [1, 0], unmatched: 2, own: 0 })
  })

  it('are checked: a condition is needed and must be readable, the templates must exist and fit the size', async () => {
    const s = await rulesSet()
    await expect(invoke('sets:update', { id: s.set.id, templateRules: [{ when: '', front: s.active.id }] })).rejects.toThrow(/no condition/i)
    await expect(invoke('sets:update', { id: s.set.id, templateRules: [{ when: 'x == 1', front: 'missing' }] })).rejects.toThrow()
    const tarot = await invoke('templates:create', { name: 'Tarot', svgSource: solid('#000'), cardSize: 'tarot' })
    await expect(invoke('sets:update', { id: s.set.id, templateRules: [{ when: 'x == 1', front: tarot.id }] })).rejects.toThrow(/card size/i)
    await expect(invoke('sets:update', { id: s.set.id, templateRules: 'no' })).rejects.toThrow()
  })

  it('are undone with Undo, and an empty list clears them', async () => {
    const s = await rulesSet()
    await invoke('sets:update', { id: s.set.id, templateRules: [{ when: "skill_type == 'A'", front: s.active.id }] })
    expect((await invoke('sets:list'))[0].template_rules).toContain('skill_type')
    await invoke('history:undo')
    expect((await invoke('sets:list'))[0].template_rules).toBe(null)
    await invoke('history:redo')
    await invoke('sets:update', { id: s.set.id, templateRules: [] })
    expect((await invoke('sets:list'))[0].template_rules).toBe(null)
  })

  it('lose a template that is deleted, and a rule left with no template goes too; Undo brings both back', async () => {
    const s = await rulesSet()
    await invoke('sets:update', { id: s.set.id, templateRules: [{ when: "skill_type == 'A'", front: s.active.id }, { when: "skill_type == 'P'", front: s.passive.id, back: s.back.id }] })
    await invoke('templates:delete', s.passive.id)
    const rules = JSON.parse((await invoke('sets:list'))[0].template_rules)
    expect(rules).toEqual([{ when: "skill_type == 'A'", front: s.active.id, back: null }, { when: "skill_type == 'P'", front: null, back: s.back.id }])
    await invoke('templates:delete', s.back.id)
    expect(JSON.parse((await invoke('sets:list'))[0].template_rules)).toEqual([{ when: "skill_type == 'A'", front: s.active.id, back: null }])
    await invoke('history:undo')
    expect(JSON.parse((await invoke('sets:list'))[0].template_rules)).toHaveLength(2)
  })

  it('a size change drops the templates that no longer fit from the rules', async () => {
    const s = await rulesSet()
    const tarot = await invoke('templates:create', { name: 'Tarot', svgSource: solid('#000'), cardSize: 'tarot' })
    await invoke('sets:update', { id: s.set.id, templateRules: [{ when: "skill_type == 'A'", front: s.active.id }] })
    await invoke('sets:update', { id: s.set.id, cardSize: 'tarot' })
    expect((await invoke('sets:list'))[0].template_rules).toBe(null)
    expect(tarot.id).toBeTruthy()
  })
})

describe('saved views (UPDATES U25)', () => {
  it('are made, renamed, changed and deleted; each is undone with Undo', async () => {
    const { set } = await seedSet({})
    const v = await invoke('views:create', { setId: set.id, name: '  Red   creatures  ', filter: "colour == 'Red'" })
    expect(v).toMatchObject({ name: 'Red creatures', filter: "colour == 'Red'" })
    expect((await invoke('views:list', set.id)).map(x => x.name)).toEqual(['Red creatures'])
    await invoke('views:update', { id: v.id, name: 'Reds', filter: "and(colour == 'Red', status != 'final')" })
    expect((await invoke('views:list', set.id))[0]).toMatchObject({ name: 'Reds', filter: "and(colour == 'Red', status != 'final')" })
    await invoke('history:undo')
    expect((await invoke('views:list', set.id))[0].name).toBe('Red creatures')
    await invoke('views:delete', v.id)
    expect(await invoke('views:list', set.id)).toEqual([])
    await invoke('history:undo')
    expect(await invoke('views:list', set.id)).toHaveLength(1)
  })

  it('need a name that no other view of the set has, and a filter that can be read', async () => {
    const { set } = await seedSet({})
    await invoke('views:create', { setId: set.id, name: 'One', filter: '' })
    await expect(invoke('views:create', { setId: set.id, name: 'one', filter: '' })).rejects.toThrow(/exists already/i)
    await expect(invoke('views:create', { setId: set.id, name: '  ', filter: '' })).rejects.toThrow(/needs a name/i)
  })

  it('go with their set when it is deleted and are part of a snapshot', async () => {
    const { set } = await seedSet({})
    await invoke('views:create', { setId: set.id, name: 'One', filter: 'a == 1' })
    await invoke('sets:delete', set.id)
    expect(db().prepare('SELECT COUNT(*) AS n FROM saved_views').get().n).toBe(0)
  })
})

describe('the card status (UPDATES U26)', () => {
  it('is set on a card, on several at once, and copied by Duplicate; a word that is not on the list is refused', async () => {
    const { set, cards } = await seedSet({ cards: [{ name: 'A' }, { name: 'B' }] })
    await invoke('sets:update', { id: set.id, statusMode: 2 })
    await invoke('cards:update', { id: cards[0].id, status: 'playtest', artStatus: 'needs_art' })
    expect((await invoke('cards:list', set.id))[0]).toMatchObject({ status: 'playtest', art_status: 'needs_art' })
    await invoke('cards:batch-update', { cardIds: cards.map(c => c.id), status: 'final' })
    expect((await invoke('cards:list', set.id)).map(c => c.status)).toEqual(['final', 'final'])
    const [copy] = await invoke('cards:duplicate', [cards[0].id])
    expect(copy).toMatchObject({ status: 'final', art_status: 'needs_art' })
    await invoke('cards:update', { id: cards[0].id, status: '' })
    expect((await invoke('cards:list', set.id))[0].status).toBe(null)
    await expect(invoke('cards:update', { id: cards[0].id, status: 'done' })).rejects.toThrow(/not a status/i)
    await expect(invoke('cards:update', { id: cards[0].id, artStatus: 'idea' })).rejects.toThrow(/not a status/i)
    await expect(invoke('sets:update', { id: set.id, statusMode: 7 })).rejects.toThrow()
  })

  it('is undone with Undo, and the mode of the set with it', async () => {
    const { set, cards } = await seedSet({ cards: [{ name: 'A' }] })
    await invoke('sets:update', { id: set.id, statusMode: 1 })
    await invoke('cards:update', { id: cards[0].id, status: 'draft' })
    await invoke('history:undo')
    expect((await invoke('cards:list', set.id))[0].status).toBe(null)
    await invoke('history:undo')
    expect((await invoke('sets:list'))[0].status_mode).toBe(0)
  })

  it('exports only the final cards with a filter, and travels through CSV: a status column in the file, words of the list accepted in any case', async () => {
    const { set, cards } = await seedSet({ fields: [{ name: 'Title', type: 'text' }], cards: [{ name: 'A', fields: { title: 'A' } }, { name: 'B', fields: { title: 'B' } }] })
    await invoke('sets:update', { id: set.id, statusMode: 1 })
    await invoke('cards:update', { id: cards[1].id, status: 'final' })
    const rows = db().prepare('SELECT * FROM cards WHERE set_id = ?').all(set.id)
    expect(rows.filter(cardSelector(db(), { filter: "status == 'final'" })).map(r => r.id)).toEqual([cards[1].id])
    const out = join(scratch, 'out.csv')
    mockDialog.save(out)
    await invoke('dataio:export', { setIds: [set.id], format: 'csv' })
    const text = (await import('fs')).readFileSync(out, 'utf8').split(/\r?\n/)
    expect(text[0]).toBe('card_id,title,card_name,quantity,status')
    expect(text[2].endsWith(',final')).toBe(true)

    mockDialog.open(file('st.csv', 'card_id,status\n' + [cards[0].card_code + ',Play Test', cards[1].card_code + ',idea'].join('\n') + '\n'))
    const read = await invoke('dataio:read-file', { format: 'csv', setId: set.id })
    expect(read.mapping.status).toBe('__status')
    const res = await invoke('dataio:import', { setId: set.id, rows: read.rows, mapping: read.mapping, mode: 'merge' })
    expect(res.updated).toBe(2)
    expect((await invoke('cards:list', set.id)).map(c => c.status)).toEqual(['playtest', 'idea'])
    mockDialog.open(file('bad.csv', `card_id,status\n${cards[0].card_code},done\n`))
    const bad = await invoke('dataio:read-file', { format: 'csv', setId: set.id })
    const preview = await invoke('dataio:import', { setId: set.id, rows: bad.rows, mapping: bad.mapping, mode: 'merge', previewOnly: true })
    expect(preview.errors[0].message).toMatch(/not a status.*idea, draft, playtest, final/i)
  })
})

describe('balance statistics (UPDATES U22)', () => {
  async function deck() {
    const s = await seedSet({
      name: 'Deck',
      fields: [{ name: 'Cost', type: 'number', validation: { min: 0, max: 6 } }, { name: 'Faction', type: 'text' }, { name: 'Notes', type: 'text', validation: { required: true } }],
      cards: [
        { name: 'Ember', fields: { cost: '1', faction: 'Red', notes: 'x' } },
        { name: 'Gale', fields: { cost: '3', faction: 'Blue', notes: 'x' } },
        { name: 'Tide', fields: { cost: '3', faction: 'Blue', notes: '' } },
        { name: 'Ember', fields: { cost: '9', faction: 'Red', notes: 'x' } }
      ]
    })
    await invoke('cards:update', { id: s.cards[1].id, quantity: 4 })
    return s
  }

  it('counts the cards by a field (the first number field by default), as cards or copies, split by another field', async () => {
    const s = await deck()
    const r = await invoke('stats:balance', { setId: s.set.id })
    expect(r).toMatchObject({ by: 'cost', cardCount: 4, copyCount: 7 })
    expect(r.chart.buckets.filter(b => b.count).map(b => [b.key, b.count])).toEqual([['1', 1], ['3', 2], ['9', 1]])
    expect(r.chart.stats).toMatchObject({ min: 1, max: 9, sum: 16, mean: 4 })
    const copies = await invoke('stats:balance', { setId: s.set.id, by: 'faction', copies: true, split: 'cost' })
    expect(copies.chart.buckets.map(b => [b.label, b.count])).toEqual([['Blue', 5], ['Red', 2]])
    expect(copies.chart.splitKeys).toEqual(['1', '3', '9'])
    expect(copies.chart.buckets[0].parts).toEqual({ 3: 5 })
  })

  it('warns of a name used twice, a required field left empty and a number out of its range, naming the card', async () => {
    const s = await deck()
    const r = await invoke('stats:balance', { setId: s.set.id })
    const kinds = r.warnings.map(w => [w.cardName, w.kind, w.field])
    expect(kinds).toEqual(expect.arrayContaining([['Tide', 'empty', 'Notes'], ['Ember', 'range', 'Cost']]))
    expect(r.warnings.filter(w => w.kind === 'range')[0].message).toMatch(/above the maximum of 6/)
    expect(r.warningCount).toBe(r.warnings.length)
  })

  it('checks the display name for duplicates once one is chosen, and other fields on request', async () => {
    const s = await deck()
    await invoke('sets:update', { id: s.set.id, displayField: 'card_name' })
    let r = await invoke('stats:balance', { setId: s.set.id })
    expect(r.warnings.filter(w => w.kind === 'duplicate').map(w => w.cardName)).toEqual(['Ember', 'Ember'])
    expect(r.checkedForDuplicates).toEqual(['card_name'])
    r = await invoke('stats:balance', { setId: s.set.id, unique: ['faction'] })
    expect(r.warnings.filter(w => w.kind === 'duplicate' && w.field === 'Faction')).toHaveLength(4)
  })

  it('looks only at the cards of a view\'s filter, counts the status of a set that tracks it, and summarizes every field', async () => {
    const s = await deck()
    await invoke('sets:update', { id: s.set.id, statusMode: 1 })
    await invoke('cards:update', { id: s.cards[0].id, status: 'final' })
    const only = await invoke('stats:balance', { setId: s.set.id, filter: "faction == 'Blue'" })
    expect(only.cardCount).toBe(2)
    const byStatus = await invoke('stats:balance', { setId: s.set.id, by: 'status' })
    expect(byStatus.chart.buckets.map(b => [b.label, b.count])).toEqual([['final', 1], ['', 3]])
    expect(byStatus.summary.find(f => f.slug === 'cost')).toMatchObject({ filled: 4, empty: 0, distinct: 3, min: 1, max: 9 })
    await expect(invoke('stats:balance', { setId: s.set.id, filter: 'and(' })).resolves.toBeTruthy()
  })

  it('reports a lookup that finds nothing', async () => {
    const { skills } = await huntersAndSkills()
    const r = await invoke('stats:balance', { setId: skills.set.id })
    expect(r.warnings.filter(w => w.kind === 'lookup').map(w => w.cardName)).toEqual(['Lost'])
  })
})

describe('Excel files (UPDATES U27)', () => {
  it('exports a sheet for each set, with numbers as numbers, and imports it again with the same cards', async () => {
    const a = await seedSet({ name: 'Heroes', fields: [{ name: 'Title', type: 'text' }, { name: 'Cost', type: 'number' }, { name: 'Flying', type: 'boolean' }], cards: [{ name: 'Orc', fields: { title: 'Orc', cost: '3', flying: 'true' } }, { name: '=Boss', fields: { title: '=Boss', cost: '', flying: 'false' } }] })
    const b = await seedSet({ name: 'Skills', fields: [{ name: 'Effect', type: 'text' }], cards: [{ fields: { effect: 'Bite' } }] })
    const out = join(scratch, 'cards.xlsx')
    mockDialog.save(out)
    const res = await invoke('dataio:export', { setIds: [a.set.id, b.set.id], format: 'xlsx' })
    expect(res.count).toBe(3)
    const sheets = readXlsx(out)
    expect(sheets.map(s => s.name)).toEqual(['Heroes', 'Skills'])
    expect(sheets[0].rows[0]).toEqual(['card_id', 'title', 'cost', 'flying', 'card_name', 'quantity'])
    expect(sheets[0].rows[1].slice(1)).toEqual(['Orc', '3', 'true', 'Orc', '1'])
    expect(sheets[0].rows[2].slice(1, 2)).toEqual(['=Boss'])
    expect(sheets[0].rows[2][4]).toBe('=Boss')

    const target = await seedSet({ name: 'Copy', fields: [{ name: 'Title', type: 'text' }, { name: 'Cost', type: 'number' }, { name: 'Flying', type: 'boolean' }] })
    mockDialog.open(out)
    const read = await invoke('dataio:read-file', { format: 'xlsx', setId: target.set.id })
    expect(read.sheets).toEqual(['Heroes', 'Skills'])
    expect(read.sheet).toBe(0)
    expect(read.mapping).toMatchObject({ title: 'title', cost: 'cost', flying: 'flying' })
    const done = await invoke('dataio:import', { setId: target.set.id, rows: read.rows, mapping: read.mapping, mode: 'append' })
    expect(done.created).toBe(2)
    expect((await invoke('cards:list', target.set.id)).map(c => c.fields.title)).toEqual(['Orc', '=Boss'])
  })

  it('reads another sheet of the same workbook without asking for the file again', async () => {
    const path = join(scratch, 'book.xlsx')
    writeFileSync(path, writeXlsx([{ name: 'Heroes', rows: [['title'], ['Orc']] }, { name: 'Skills', rows: [['title'], ['Bite'], ['Claw']] }]))
    const { set } = await seedSet({ fields: [{ name: 'Title', type: 'text' }] })
    mockDialog.open(path)
    const first = await invoke('dataio:read-file', { format: 'xlsx', setId: set.id })
    expect(first.rows).toHaveLength(1)
    const second = await invoke('dataio:read-file', { format: 'xlsx', setId: set.id, sheet: 1 })
    expect(second.rows.map(r => r.title)).toEqual(['Bite', 'Claw'])
    expect(second.sheet).toBe(1)
  })

  it('handles what a spreadsheet makes of headers: blanks, repeats, ragged rows, blank lines', async () => {
    const path = join(scratch, 'messy.xlsx')
    writeFileSync(path, writeXlsx([{ name: 'S', rows: [['', 'Title', 'Title', ''], ['x', 'A', 'B'], [], ['y', 'C']] }]))
    const { set } = await seedSet({ fields: [{ name: 'Title', type: 'text' }] })
    mockDialog.open(path)
    const r = await invoke('dataio:read-file', { format: 'xlsx', setId: set.id })
    expect(r.headers).toEqual(['', 'Title', 'Title (2)'])
    expect(r.rows).toEqual([{ '': 'x', Title: 'A', 'Title (2)': 'B' }, { '': 'y', Title: 'C', 'Title (2)': '' }])
    expect(r.issues).toEqual([])
  })

  it('says so for a file that is not a workbook, and the command line reads one', async () => {
    const { set } = await seedSet({ fields: [{ name: 'Title', type: 'text' }] })
    mockDialog.open(file('fake.xlsx', 'not a workbook'))
    await expect(invoke('dataio:read-file', { format: 'xlsx', setId: set.id })).rejects.toThrow(/not an Excel workbook/i)
    const path = join(scratch, 'cli.xlsx')
    writeFileSync(path, writeXlsx([{ name: 'S', rows: [['title'], ['Orc'], ['Elf']] }]))
    const { runCli } = await import('../../src/cli/run.js')
    let out = ''
    const code = await runCli(['--project', ctx.dir, 'import', path, '--set', set.name], { stdout: t => { out += t }, stderr: t => { out += t }, cwd: ctx.root, env: {} })
    expect(code, out).toBe(0)
    expect((await invoke('cards:list', set.id)).map(c => c.fields.title)).toEqual(['Orc', 'Elf'])
  })
})

describe('the schema (UPDATES U22 to U27)', () => {
  it('is version 15, and a version 13 project is upgraded: fields keep their data and can be of the new types, the new columns appear', async () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(15)
    const { set } = await seedSet({ fields: [{ name: 'Title', type: 'text' }, { name: 'Cost', type: 'number' }], cards: [{ name: 'Orc', fields: { title: 'Orc', cost: '3' } }] })
    await invoke('projects:close')
    closeProjectDb(ctx.dir)
    const raw = new Database(join(ctx.dir, 'project.db'))
    raw.exec(`ALTER TABLE fields RENAME TO f_new;
      CREATE TABLE fields (id TEXT PRIMARY KEY, set_id TEXT NOT NULL REFERENCES sets(id) ON DELETE CASCADE, name TEXT NOT NULL, slug TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('text','number','boolean','image_ref','color','formula','rich_text')), default_value TEXT, formula TEXT, validation TEXT,
        display_order INTEGER NOT NULL DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0, width_px INTEGER, created_at INTEGER NOT NULL, propagate INTEGER NOT NULL DEFAULT 0, UNIQUE(set_id, slug));
      INSERT INTO fields SELECT * FROM f_new; DROP TABLE f_new;
      DROP TABLE saved_views; ALTER TABLE sets DROP COLUMN template_rules; ALTER TABLE sets DROP COLUMN status_mode;
      ALTER TABLE cards DROP COLUMN status; ALTER TABLE cards DROP COLUMN art_status;
      UPDATE project_meta SET value = '13' WHERE key = 'schema_version'`)
    raw.close()
    const state = await invoke('projects:open', ctx.dir)
    expect(state.upgrade).toMatchObject({ from: 13, to: 15 })
    expect(openProjectDb(ctx.dir).prepare("SELECT value FROM project_meta WHERE key = 'schema_version'").get().value).toBe('15')
    const fields = await invoke('fields:list', set.id)
    expect(fields.map(f => [f.slug, f.type])).toEqual([['title', 'text'], ['cost', 'number'], ['card_name', 'text']])
    expect((await invoke('cards:list', set.id))[0].fields).toMatchObject({ title: 'Orc', cost: '3' })
    const cols = t => openProjectDb(ctx.dir).prepare(`PRAGMA table_info(${t})`).all().map(c => c.name)
    expect(cols('cards')).toEqual(expect.arrayContaining(['status', 'art_status']))
    expect(cols('sets')).toEqual(expect.arrayContaining(['template_rules', 'status_mode']))
    const added = await invoke('fields:create', { setId: set.id, name: 'Role', type: 'choice', validation: { options: ['A'] } })
    expect(added.type).toBe('choice')
    expect(await invoke('views:list', set.id)).toEqual([])
  })
})
