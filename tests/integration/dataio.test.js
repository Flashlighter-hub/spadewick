import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { createTestProject, seedSet, invoke, mockDialog, makePng } from '../helpers/project.js'
import { parseCsv } from '../../src/main/csv.js'

let ctx
beforeEach(async () => { ctx = await createTestProject() })
afterEach(async () => { await ctx.cleanup() })

const writeCsv = (name, text) => { const p = join(ctx.root, name); writeFileSync(p, text); return p }

async function readFile(format, text, setId) {
  mockDialog.open(writeCsv(`in.${format}`, text))
  return invoke('dataio:read-file', { format, setId })
}

describe('a CSV that breaks the CSV rules is reported, not read silently', () => {
  it('lists each problem with its line in words, and says nothing about a clean file or a JSON file', async () => {
    const { set } = await seedSet({ fields: [{ name: 'Title', type: 'text' }, { name: 'Text', type: 'text' }] })
    const clean = await readFile('csv', 'title,text\nA,"one, ""two"""\nB,three\n', set.id)
    expect(clean.issues).toEqual([])
    const stray = await readFile('csv', 'title,text\nA,"Level 1 - "On a hit.","x"\nB,y\nC,z\n', set.id)
    expect(stray.issues[0]).toMatchObject({ line: 2 })
    expect(stray.issues[0].message).toMatch(/quote mark inside a quoted field/i)
    expect(stray.rows.length).toBeLessThan(3)   // cards really were lost
    const ragged = await readFile('csv', 'title,text\nA,1\nB\n', set.id)
    expect(ragged.issues).toEqual([{ line: 3, message: 'This row has 1 columns but the header has 2, so the cards may be run together or cut short.' }])
    const json = await readFile('json', JSON.stringify([{ title: 'A', text: 'b' }]), set.id)
    expect(json.issues).toEqual([])
  })
})

describe('CSV/JSON import (PRD §5.5, §5.6)', () => {
  it('maps headers to fields by full name match, case-insensitively', async () => {
    const { set } = await seedSet({ fields: [{ name: 'Card Title', type: 'text' }, { name: 'Mana Cost', slug: 'cost', type: 'number' }] })
    const file = await readFile('csv', 'card title, MANA COST ,Flavor\nOrc,3,Grr\n', set.id)
    expect(file.mapping).toEqual({ 'card title': 'card_title', ' MANA COST ': 'cost', Flavor: '__ignore' })
  })

  it('falls back to matching the slug, and prefers a name match over a slug match', async () => {
    const { set } = await seedSet({ fields: [{ name: 'Attack', slug: 'atk', type: 'number' }, { name: 'atk', slug: 'other', type: 'text' }] })
    const file = await readFile('csv', 'atk,Attack\n1,2\n', set.id)
    expect(file.mapping.atk).toBe('other')   // name "atk" beats slug "atk"
    expect(file.mapping.Attack).toBe('atk')
  })

  it('maps a display_name column when no field matches it', async () => {
    const { set } = await seedSet({ fields: [{ name: 'Cost', type: 'number' }] })
    const file = await readFile('csv', 'display_name,cost\nOrc,3\n', set.id)
    expect(file.mapping.display_name).toBe('display_name')
  })

  it('a display_name column fills the display field of the set, or makes a Name field when the set has none (UPDATES U10)', async () => {
    const has = await seedSet({ name: 'Has', fields: [{ name: 'Title', type: 'text' }] })
    await invoke('sets:update', { id: has.set.id, displayField: 'title' })
    const file = await readFile('csv', 'display_name\nOrc\n', has.set.id)
    await invoke('dataio:import', { setId: has.set.id, rows: file.rows, mapping: file.mapping, mode: 'append' })
    const [orc] = await invoke('cards:list', has.set.id)
    expect(orc).toMatchObject({ display_name: 'Orc', fields: { title: 'Orc' } })

    const none = await seedSet({ name: 'None', fields: [{ name: 'Cost', type: 'number' }] })
    const again = await readFile('csv', 'display_name,cost\nElf,2\n', none.set.id)
    await invoke('dataio:import', { setId: none.set.id, rows: again.rows, mapping: again.mapping, mode: 'append' })
    expect((await invoke('sets:list')).find(s => s.id === none.set.id).display_field).toBe('name')
    expect((await invoke('fields:list', none.set.id)).map(f => f.slug)).toEqual(['cost', 'name'])
    expect((await invoke('cards:list', none.set.id))[0]).toMatchObject({ display_name: 'Elf', fields: { name: 'Elf' } })
    await invoke('history:undo')   // the Name field and the choice go back with the cards
    expect((await invoke('sets:list')).find(s => s.id === none.set.id).display_field).toBe(null)
    expect((await invoke('fields:list', none.set.id)).map(f => f.slug)).toEqual(['cost'])
  })

  it('appends new cards with parsed values and defaults for unmapped fields', async () => {
    const { set } = await seedSet({ fields: [{ name: 'Name', type: 'text' }, { name: 'Cost', type: 'number' }, { name: 'Rarity', type: 'text', defaultValue: 'common' }] })
    await invoke('sets:update', { id: set.id, displayField: 'name' })
    const file = await readFile('csv', 'name,cost\nOrc,3\nElf,2\n', set.id)
    const res = await invoke('dataio:import', { setId: set.id, rows: file.rows, mapping: file.mapping, mode: 'append' })
    expect(res).toMatchObject({ created: 2, updated: 0, skipped: 0 })
    const cards = await invoke('cards:list', set.id)
    expect(cards.map(c => c.display_name)).toEqual(['Orc', 'Elf'])
    expect(cards[0].fields).toEqual({ name: 'Orc', cost: '3', rarity: 'common' })
  })

  it('merges on the unique identifier of the set when no key field is given (UPDATES U9)', async () => {
    const { set } = await seedSet({ fields: [{ name: 'Sku', type: 'text' }, { name: 'Cost', type: 'number' }], cards: [{ fields: { sku: 'A', cost: '1' } }] })
    await invoke('sets:update', { id: set.id, identifierField: 'sku' })
    const file = await readFile('csv', 'sku,cost\nA,7\nB,2\n', set.id)
    const res = await invoke('dataio:import', { setId: set.id, rows: file.rows, mapping: file.mapping, mode: 'merge' })
    expect(res).toMatchObject({ created: 1, updated: 1 })
    expect((await invoke('cards:list', set.id)).map(c => c.fields.cost)).toEqual(['7', '2'])
  })

  it('reports validation errors with row numbers and skips only the bad rows', async () => {
    const { set } = await seedSet({ fields: [{ name: 'Cost', type: 'number', validation: { min: 0, max: 10 } }, { name: 'Code', type: 'text', validation: { regex: '^[A-Z]{2}$' } }, { name: 'Flag', type: 'boolean' }, { name: 'Tint', type: 'color' }] })
    const csv = 'cost,code,flag,tint\n3,AB,yes,#fff\nabc,AB,true,#000000\n11,AB,true,#000000\n4,ab,true,#000000\n5,CD,maybe,#000000\n6,EF,0,red\n7,GH,1,#a1b2c3\n'
    const file = await readFile('csv', csv, set.id)
    const preview = await invoke('dataio:import', { setId: set.id, rows: file.rows, mapping: file.mapping, mode: 'append', previewOnly: true })
    expect(preview.validCount).toBe(2)
    expect(preview.errors.map(e => e.row)).toEqual([3, 4, 5, 6, 7])
    const res = await invoke('dataio:import', { setId: set.id, rows: file.rows, mapping: file.mapping, mode: 'append' })
    expect(res.created).toBe(2)
    const cards = await invoke('cards:list', set.id)
    expect(cards.map(c => c.fields.flag)).toEqual(['true', 'true'])  // normalised
  })

  it('previewOnly changes nothing', async () => {
    const { set } = await seedSet({ fields: [{ name: 'N', type: 'text' }] })
    const file = await readFile('csv', 'n\na\nb\n', set.id)
    await invoke('dataio:import', { setId: set.id, rows: file.rows, mapping: file.mapping, mode: 'append', previewOnly: true })
    expect(await invoke('cards:list', set.id)).toEqual([])
  })

  it('creates new text fields from unmatched columns named like the CSV header', async () => {
    const { set } = await seedSet({ fields: [{ name: 'Name', type: 'text' }] })
    const file = await readFile('csv', 'Name,Flavor Text\nOrc,Grr\n', set.id)
    file.mapping['Flavor Text'] = '__new'
    await invoke('dataio:import', { setId: set.id, rows: file.rows, mapping: file.mapping, mode: 'append' })
    const fields = await invoke('fields:list', set.id)
    expect(fields.find(f => f.name === 'Flavor Text')).toMatchObject({ slug: 'flavor_text', type: 'text' })
    expect((await invoke('cards:list', set.id))[0].fields.flavor_text).toBe('Grr')
  })

  it('works for a completely different game layout without any setup', async () => {
    const set = await invoke('sets:create', { name: 'Tarot Deck' })
    const file = await readFile('csv', 'Arcana,Number,Meaning (upright)\nThe Fool,0,New beginnings\nThe Magician,1,Manifestation\n', set.id)
    for (const h of file.headers) file.mapping[h] = '__new'
    await invoke('dataio:import', { setId: set.id, rows: file.rows, mapping: file.mapping, mode: 'append' })
    const [a] = await invoke('cards:list', set.id)
    expect(a.fields).toEqual({ arcana: 'The Fool', number: '0', meaning_upright: 'New beginnings' })
    // Re-importing the same layout later matches the now-existing fields by name
    const again = await readFile('csv', 'Arcana,Number,Meaning (upright)\nX,2,Y\n', set.id)
    expect(Object.values(again.mapping)).toEqual(['arcana', 'number', 'meaning_upright'])
  })

  it('merge mode updates matching cards by key and adds the rest', async () => {
    const { set } = await seedSet({ fields: [{ name: 'Id', type: 'text' }, { name: 'Cost', type: 'number' }, { name: 'Note', type: 'text' }], cards: [{ name: 'one', fields: { id: 'A', cost: '1', note: 'keep' } }] })
    const file = await readFile('csv', 'id,cost\nA,9\nB,4\n', set.id)
    const res = await invoke('dataio:import', { setId: set.id, rows: file.rows, mapping: file.mapping, mode: 'merge', keyField: 'id' })
    expect(res).toMatchObject({ created: 1, updated: 1 })
    const cards = await invoke('cards:list', set.id)
    expect(cards.map(c => c.fields)).toEqual([expect.objectContaining({ id: 'A', cost: '9', note: 'keep' }), expect.objectContaining({ id: 'B', cost: '4' })])
    expect(cards[0].display_name).toBe('one')
  })

  it('merge mode requires a key field', async () => {
    const { set } = await seedSet({ fields: [{ name: 'Id', type: 'text' }] })
    const file = await readFile('csv', 'id\nA\n', set.id)
    await expect(invoke('dataio:import', { setId: set.id, rows: file.rows, mapping: file.mapping, mode: 'merge' })).rejects.toThrow(/key field/i)
  })

  it('resolves image columns by asset filename', async () => {
    const png = await makePng(join(ctx.root, 'dragon.png'))
    const [asset] = await invoke('assets:import', [png])
    const { set } = await seedSet({ fields: [{ name: 'Art', type: 'image_ref' }] })
    const file = await readFile('csv', 'art\ndragon.png\nmissing.png\n', set.id)
    const prev = await invoke('dataio:import', { setId: set.id, rows: file.rows, mapping: file.mapping, mode: 'append', previewOnly: true })
    expect(prev.errors).toHaveLength(1)
    await invoke('dataio:import', { setId: set.id, rows: file.rows, mapping: file.mapping, mode: 'append' })
    expect((await invoke('cards:list', set.id))[0].fields.art).toBe(`asset:${asset.id}`)
  })

  it('ignores formula columns (computed, never stored)', async () => {
    const { set } = await seedSet({ fields: [{ name: 'A', type: 'text' }, { name: 'Both', type: 'formula', formula: 'upper(a)' }] })
    const file = await readFile('csv', 'a,both\nx,STALE\n', set.id)
    await invoke('dataio:import', { setId: set.id, rows: file.rows, mapping: file.mapping, mode: 'append' })
    expect((await invoke('cards:list', set.id))[0].fields).toEqual({ a: 'x', both: '' })
  })

  it('imports JSON arrays, stringifying non-string values', async () => {
    const { set } = await seedSet({ fields: [{ name: 'Name', type: 'text' }, { name: 'Cost', type: 'number' }, { name: 'Legendary', type: 'boolean' }] })
    const file = await readFile('json', JSON.stringify([{ Name: 'Orc', Cost: 3, Legendary: false }, { name: 'Elf', cost: null }]), set.id)
    expect(file.rows[0]).toEqual({ Name: 'Orc', Cost: '3', Legendary: 'false' })
    await invoke('dataio:import', { setId: set.id, rows: file.rows, mapping: file.mapping, mode: 'append' })
    expect((await invoke('cards:list', set.id)).map(c => c.fields.cost)).toEqual(['3', ''])
  })

  it('rejects JSON that is not an array and survives invalid JSON', async () => {
    const { set } = await seedSet({ fields: [] })
    mockDialog.open(writeCsv('bad.json', '{"a":1}'))
    await expect(invoke('dataio:read-file', { format: 'json', setId: set.id })).rejects.toThrow(/array/)
    mockDialog.open(writeCsv('bad2.json', '{nope'))
    await expect(invoke('dataio:read-file', { format: 'json', setId: set.id })).rejects.toThrow()
  })

  it('returns null when the file dialog is cancelled', async () => {
    const { set } = await seedSet({ fields: [] })
    expect(await invoke('dataio:read-file', { format: 'csv', setId: set.id })).toBe(null)
  })

  it('treats a whole import as one undoable step, and redo restores it', async () => {
    const { set } = await seedSet({ fields: [{ name: 'Id', type: 'text' }, { name: 'Cost', type: 'number' }], cards: [{ name: 'one', fields: { id: 'A', cost: '1' } }] })
    const file = await readFile('csv', 'id,cost,extra\nA,9,x\nB,4,y\n', set.id)
    file.mapping.extra = '__new'
    await invoke('dataio:import', { setId: set.id, rows: file.rows, mapping: file.mapping, mode: 'merge', keyField: 'id' })
    expect(await invoke('cards:list', set.id)).toHaveLength(2)
    expect(await invoke('history:undo')).toBe(true)
    let cards = await invoke('cards:list', set.id)
    expect(cards).toHaveLength(1)
    expect(cards[0].fields).toMatchObject({ id: 'A', cost: '1' })
    expect((await invoke('fields:list', set.id)).map(f => f.slug)).toEqual(['id', 'cost', 'card_name'])
    expect(await invoke('history:redo')).toBe(true)
    cards = await invoke('cards:list', set.id)
    expect(cards).toHaveLength(2)
    expect(cards[0].fields).toMatchObject({ cost: '9', extra: 'x' })
    expect((await invoke('fields:list', set.id)).map(f => f.slug)).toContain('extra')
  })
})

describe('CSV/JSON export', () => {
  async function exportTo(setIds, format, opts = {}) {
    const out = join(ctx.root, `out.${format}`)
    mockDialog.save(out)
    const res = await invoke('dataio:export', { setIds, format, ...opts })
    return { res, text: readFileSync(out, 'utf8') }
  }

  it('exports headers by slug, in field order, with computed formulas and asset filenames', async () => {
    const png = await makePng(join(ctx.root, 'dragon.png'))
    const [asset] = await invoke('assets:import', [png])
    const { set } = await seedSet({
      fields: [{ name: 'Name', type: 'text' }, { name: 'Art', type: 'image_ref' }, { name: 'Loud', type: 'formula', formula: 'upper(name)' }],
      cards: [{ name: 'a', fields: { name: 'orc, big', art: `asset:${asset.id}` } }]
    })
    const { res, text } = await exportTo([set.id], 'csv')
    expect(res.count).toBe(1)
    const rows = parseCsv(text)
    expect(rows[0]).toEqual(['card_id', 'name', 'art', 'loud', 'card_name', 'quantity'])
    expect(rows[1]).toEqual(['BASE-0001', 'orc, big', asset.filename, 'ORC, BIG', 'a', '1'])
  })

  it('excludes soft-deleted cards and keeps card order', async () => {
    const { set, cards } = await seedSet({ fields: [{ name: 'N', type: 'text' }], cards: [{ fields: { n: '1' } }, { fields: { n: '2' } }, { fields: { n: '3' } }] })
    await invoke('cards:delete', [cards[1].id])
    const { text } = await exportTo([set.id], 'csv')
    expect(parseCsv(text).slice(1).map(r => r[1])).toEqual(['1', '3'])
  })

  it('exports JSON with optional metadata', async () => {
    const { set } = await seedSet({ name: 'Base', fields: [{ name: 'N', type: 'text' }], cards: [{ fields: { n: 'x' } }], template: { svg: '<svg xmlns="http://www.w3.org/2000/svg"/>', name: 'Frame' } })
    const { text } = await exportTo([set.id], 'json', { includeMeta: true })
    const [rec] = JSON.parse(text)
    expect(rec).toMatchObject({ n: 'x', _set: 'Base', _template: 'Frame' })
    expect(rec._id).toBeTruthy()
  })

  it('returns null when the save dialog is cancelled', async () => {
    const { set } = await seedSet({ fields: [] })
    expect(await invoke('dataio:export', { setIds: [set.id], format: 'csv' })).toBe(null)
  })

  it('round-trips: exporting then re-importing reproduces the data', async () => {
    const a = await seedSet({ name: 'Src', fields: [{ name: 'Name', type: 'text' }, { name: 'Cost', type: 'number' }, { name: 'Text', type: 'text' }], cards: [{ name: 'A', fields: { name: 'A, the "Great"', cost: '3', text: 'line1\nline2' } }, { name: 'B', fields: { name: 'Ünï', cost: '0', text: '' } }] })
    const { text } = await exportTo([a.set.id], 'csv')
    const b = await seedSet({ name: 'Dst', fields: [{ name: 'Name', type: 'text' }, { name: 'Cost', type: 'number' }, { name: 'Text', type: 'text' }] })
    const file = await readFile('csv', text, b.set.id)
    await invoke('dataio:import', { setId: b.set.id, rows: file.rows, mapping: file.mapping, mode: 'append' })
    const orig = (await invoke('cards:list', a.set.id)).map(c => { const { card_name, ...rest } = c.fields; return rest })   // the names are a column of their own: this set has no such field
    const copy = (await invoke('cards:list', b.set.id)).map(c => c.fields)
    expect(copy).toEqual(orig)
  })
})
