import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import Database from 'better-sqlite3'
import { createTestProject, invoke } from '../helpers/project.js'
import { openProjectDb, closeProjectDb } from '../../src/main/db.js'
import { renderCard } from '../../src/main/render.js'

/**
 * UPDATES U10 (no built-in Name column: a set says which field names its cards, or none) and U9 (a unique identifier
 * column, and edits that spread to the other rows that share it).
 */

let ctx
beforeEach(async () => { ctx = await createTestProject() })
afterEach(async () => { await ctx.cleanup() })

const setOf = async id => (await invoke('sets:list')).find(s => s.id === id)
const names = async setId => (await invoke('cards:list', setId)).map(c => c.display_name)

describe('the display name of a set (UPDATES U10)', () => {
  it('a new set can start with a Name field that is its display name; without it the set has none', async () => {
    const withName = await invoke('sets:create', { name: 'With', nameField: true })
    expect(withName.display_field).toBe('name')
    expect((await invoke('fields:list', withName.id)).map(f => [f.slug, f.type])).toEqual([['name', 'text']])
    const bare = await invoke('sets:create', { name: 'Bare' })
    expect(bare.display_field).toBe(null)
    expect(await invoke('fields:list', bare.id)).toEqual([])
  })

  it('the name of a card is the value of the display field, however the card is written', async () => {
    const set = await invoke('sets:create', { name: 'S', nameField: true })
    const a = await invoke('cards:create', { setId: set.id, fields: { name: 'Orc' } })
    expect(a.display_name).toBe('Orc')
    await invoke('cards:update', { id: a.id, fields: { name: 'Orc chief' } })
    expect(await names(set.id)).toEqual(['Orc chief'])
    await invoke('cards:batch-update', { cardIds: [a.id], fields: { name: 'Orc king' } })
    expect(await names(set.id)).toEqual(['Orc king'])
    await invoke('cards:update', { id: a.id, displayName: 'Shortcut' })   // the old name for "set the display field"
    expect((await invoke('cards:list', set.id))[0].fields.name).toBe('Shortcut')
    await invoke('history:undo')
    expect(await names(set.id)).toEqual(['Orc king'])
    await invoke('history:redo')
    expect(await names(set.id)).toEqual(['Shortcut'])
  })

  it('choosing another field, or none, renames every card at once; and it can be undone', async () => {
    const set = await invoke('sets:create', { name: 'S', nameField: true })
    await invoke('fields:create', { setId: set.id, name: 'Title', type: 'text' })
    await invoke('cards:create', { setId: set.id, fields: { name: 'Orc', title: 'Brute' } })
    await invoke('sets:update', { id: set.id, displayField: 'title' })
    expect(await names(set.id)).toEqual(['Brute'])
    await invoke('sets:update', { id: set.id, displayField: null })
    expect((await setOf(set.id)).display_field).toBe(null)
    expect(await names(set.id)).toEqual([''])
    await invoke('history:undo')
    expect(await names(set.id)).toEqual(['Brute'])
    await invoke('history:undo')
    expect(await names(set.id)).toEqual(['Orc'])
  })

  it('refuses a field that does not exist or whose value is only worked out', async () => {
    const set = await invoke('sets:create', { name: 'S' })
    await invoke('fields:create', { setId: set.id, name: 'Both', type: 'formula', formula: '1' })
    await expect(invoke('sets:update', { id: set.id, displayField: 'nope' })).rejects.toThrow(/not found/i)
    await expect(invoke('sets:update', { id: set.id, displayField: 'both' })).rejects.toThrow(/formula/i)
    await expect(invoke('sets:update', { id: set.id, identifierField: 'both' })).rejects.toThrow(/formula/i)
  })

  it('changing the slug of the display field keeps it the display field; deleting it leaves the set without one', async () => {
    const set = await invoke('sets:create', { name: 'S', nameField: true })
    await invoke('cards:create', { setId: set.id, fields: { name: 'Orc' } })
    const [field] = await invoke('fields:list', set.id)
    await invoke('fields:update', { id: field.id, slug: 'title' })
    expect((await setOf(set.id)).display_field).toBe('title')
    expect(await names(set.id)).toEqual(['Orc'])
    await invoke('history:undo')
    expect((await setOf(set.id)).display_field).toBe('name')
    expect(await names(set.id)).toEqual(['Orc'])
    await invoke('fields:delete', field.id)
    expect((await setOf(set.id)).display_field).toBe(null)
    expect(await names(set.id)).toEqual([''])
    await invoke('history:undo')
    expect((await setOf(set.id)).display_field).toBe('name')
    expect(await names(set.id)).toEqual(['Orc'])
  })

  it('duplicating a card marks its name as a copy', async () => {
    const set = await invoke('sets:create', { name: 'S', nameField: true })
    const a = await invoke('cards:create', { setId: set.id, fields: { name: 'Orc' } })
    await invoke('cards:duplicate', [a.id])
    expect(await names(set.id)).toEqual(['Orc', 'Orc (copy)'])
  })

  it('{{display_name}} in a template still works: it is the value of the display field', async () => {
    const set = await invoke('sets:create', { name: 'S', nameField: true })
    const a = await invoke('cards:create', { setId: set.id, fields: { name: 'Orc' } })
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="700"><text x="10" y="40" font-size="30">{{display_name}}</text></svg>'
    const t = await invoke('templates:create', { name: 'T', svgSource: svg })
    await invoke('cards:update', { id: a.id, templateId: t.id })
    const png = await renderCard(ctx.dir, a.id, { templateId: t.id, width: 100 })
    expect(png.subarray(1, 4).toString()).toBe('PNG')   // renders although there is no field called display_name
  })
})

describe('upgrading a project that has a built-in Name column (UPDATES U10)', () => {
  /** A project the way version 12 left it: every card has its name in the column of its own, and the sets know no display field. */
  async function legacy(build) {
    const made = ctx
    const set = await invoke('sets:create', { name: 'Base' })
    await build(set)
    await invoke('projects:close')
    const raw = new Database(join(made.dir, 'project.db'))
    return { made, set, raw }
  }
  const dropTriggers = raw => raw.exec('DROP TRIGGER trg_cards_label_insert; DROP TRIGGER trg_cards_label_update; DROP TRIGGER trg_sets_label_update')   // version 12 had none
  const reopen = async made => { closeProjectDb(made.dir); return invoke('projects:open', made.dir) }

  it('moves the names into a text field called Name, chosen as the display name, and says so', async () => {
    const { made, set, raw } = await legacy(async s => {
      await invoke('fields:create', { setId: s.id, name: 'Cost', type: 'number' })
      await invoke('cards:create', { setId: s.id, fields: { cost: '3' } })
      await invoke('cards:create', { setId: s.id, fields: { cost: '4' } })
    })
    dropTriggers(raw)
    raw.prepare('UPDATE cards SET display_name = ? WHERE sort_order = 0').run('Ember Wolf')
    raw.prepare('UPDATE cards SET display_name = ? WHERE sort_order = 1').run('Moss Golem')
    raw.exec("UPDATE project_meta SET value = '12' WHERE key = 'schema_version'; UPDATE sets SET display_field = NULL")
    raw.close()
    const state = await reopen(made)
    expect(state.upgrade).toMatchObject({ from: 12 })
    expect(state.upgrade.notices.join(' ')).toMatch(/Name/)
    const fields = await invoke('fields:list', set.id)
    expect(fields.map(f => [f.slug, f.type])).toEqual([['name', 'text'], ['cost', 'number']])   // first, like the column it replaces
    expect((await setOf(set.id)).display_field).toBe('name')
    const cards = await invoke('cards:list', set.id)
    expect(cards.map(c => c.display_name)).toEqual(['Ember Wolf', 'Moss Golem'])
    expect(cards.map(c => c.fields.name)).toEqual(['Ember Wolf', 'Moss Golem'])
    expect(cards.map(c => c.fields.cost)).toEqual(['3', '4'])
  })

  it('uses an existing text field called name when it already holds the same words, and makes a new one when it does not', async () => {
    const { made, set, raw } = await legacy(async s => {
      await invoke('fields:create', { setId: s.id, name: 'Name', type: 'text' })
      await invoke('cards:create', { setId: s.id, fields: { name: 'Orc' } })
    })
    dropTriggers(raw)
    raw.prepare('UPDATE cards SET display_name = ?').run('Orc')
    raw.exec("UPDATE project_meta SET value = '12' WHERE key = 'schema_version'; UPDATE sets SET display_field = NULL")
    raw.close()
    await reopen(made)
    expect((await invoke('fields:list', set.id)).map(f => f.slug)).toEqual(['name'])   // nothing added
    expect((await setOf(set.id)).display_field).toBe('name')

    const other = await legacy(async s => {
      await invoke('fields:create', { setId: s.id, name: 'Name', type: 'text' })
      await invoke('cards:create', { setId: s.id, fields: { name: 'Orc' } })
    })
    dropTriggers(other.raw)
    other.raw.prepare('UPDATE cards SET display_name = ?').run('The Orc')   // the column said something else
    other.raw.exec("UPDATE project_meta SET value = '12' WHERE key = 'schema_version'; UPDATE sets SET display_field = NULL")
    other.raw.close()
    await reopen(other.made)
    const fields = await invoke('fields:list', other.set.id)
    expect(fields.map(f => f.slug)).toEqual(['display_name', 'name'])
    expect((await invoke('cards:list', other.set.id))[0]).toMatchObject({ display_name: 'The Orc', fields: { display_name: 'The Orc', name: 'Orc' } })
  })
})

describe('a unique identifier column and edits that spread (UPDATES U9)', () => {
  async function deck() {
    const set = await invoke('sets:create', { name: 'S', nameField: true })
    for (const [name, type] of [['Sku', 'text'], ['Price', 'number'], ['Note', 'text']]) await invoke('fields:create', { setId: set.id, name, type })
    const make = fields => invoke('cards:create', { setId: set.id, fields })
    const [a1, a2, b1] = [await make({ name: 'Orc', sku: 'A', price: '1' }), await make({ name: 'Orc foil', sku: 'A', price: '1' }), await make({ name: 'Elf', sku: 'B', price: '5' })]
    return { set, a1, a2, b1, fields: await invoke('fields:list', set.id) }
  }
  const field = (fields, slug) => fields.find(f => f.slug === slug)
  const prices = async setId => (await invoke('cards:list', setId)).map(c => c.fields.price)

  it('does nothing until a column is the identifier and a field is marked', async () => {
    const { set, a1, fields } = await deck()
    await invoke('cards:update', { id: a1.id, fields: { price: '9' } })
    expect(await prices(set.id)).toEqual(['9', '1', '5'])
    await invoke('sets:update', { id: set.id, identifierField: 'sku' })
    await invoke('cards:update', { id: a1.id, fields: { price: '8' } })
    expect(await prices(set.id)).toEqual(['8', '1', '5'])   // price is not marked
    expect(field(fields, 'price').propagate).toBe(0)
  })

  it('a marked column changes in every row with the same identifier, and only those, as one undo step', async () => {
    const { set, a1, a2, fields } = await deck()
    await invoke('sets:update', { id: set.id, identifierField: 'sku' })
    await invoke('fields:update', { id: field(fields, 'price').id, propagate: true })
    const preview = await invoke('cards:propagate-preview', { id: a1.id, fields: { price: '9' } })
    expect(preview).toEqual([{ id: a2.id, name: 'Orc foil', field: 'price', from: '1', to: '9' }])
    expect(await prices(set.id)).toEqual(['1', '1', '5'])   // a preview changes nothing
    await invoke('cards:update', { id: a1.id, fields: { price: '9', note: 'x' } })
    expect(await prices(set.id)).toEqual(['9', '9', '5'])
    expect((await invoke('cards:list', set.id)).map(c => c.fields.note)).toEqual(['x', undefined, undefined])   // only the marked column spreads
    await invoke('history:undo')
    expect(await prices(set.id)).toEqual(['1', '1', '5'])
    await invoke('history:redo')
    expect(await prices(set.id)).toEqual(['9', '9', '5'])
  })

  it('a bulk edit spreads too, and a card that is part of the edit is not changed twice', async () => {
    const { set, a1, a2, b1, fields } = await deck()
    await invoke('sets:update', { id: set.id, identifierField: 'sku' })
    await invoke('fields:update', { id: field(fields, 'price').id, propagate: true })
    await invoke('cards:batch-update', { cardIds: [a1.id, b1.id], fields: { price: '7' } })
    expect(await prices(set.id)).toEqual(['7', '7', '7'])
    await invoke('history:undo')
    expect(await prices(set.id)).toEqual(['1', '1', '5'])
    expect(a2.id).toBeTruthy()
  })

  it('a blank identifier matches nothing, and the identifier column itself never spreads', async () => {
    const { set, a1, fields } = await deck()
    await invoke('sets:update', { id: set.id, identifierField: 'sku' })
    await invoke('fields:update', { id: field(fields, 'price').id, propagate: true })
    await invoke('fields:update', { id: field(fields, 'sku').id, propagate: true })
    const x = await invoke('cards:create', { setId: set.id, fields: { price: '2' } })
    const y = await invoke('cards:create', { setId: set.id, fields: { price: '2' } })
    await invoke('cards:update', { id: x.id, fields: { price: '3' } })
    expect((await invoke('cards:list', set.id)).slice(3).map(c => c.fields.price)).toEqual(['3', '2'])
    expect(y.id).toBeTruthy()
    await invoke('cards:update', { id: a1.id, fields: { sku: 'Z' } })
    expect((await invoke('cards:list', set.id)).map(c => c.fields.sku).slice(0, 3)).toEqual(['Z', 'A', 'B'])
  })

  it('the identifier follows its field to a new slug and is cleared when the field is deleted', async () => {
    const { set, fields } = await deck()
    await invoke('sets:update', { id: set.id, identifierField: 'sku' })
    await invoke('fields:update', { id: field(fields, 'sku').id, slug: 'code' })
    expect((await setOf(set.id)).identifier_field).toBe('code')
    await invoke('fields:delete', field(fields, 'sku').id)
    expect((await setOf(set.id)).identifier_field).toBe(null)
  })

  it('the database of a project opened again keeps the triggers that maintain the names', async () => {
    const set = await invoke('sets:create', { name: 'S', nameField: true })
    await invoke('cards:create', { setId: set.id, fields: { name: 'Orc' } })
    const dir = ctx.dir
    closeProjectDb(dir)
    const d = openProjectDb(dir)
    d.prepare("UPDATE cards SET fields_json = '{\"name\":\"Elf\"}'").run()
    expect(d.prepare('SELECT display_name FROM cards').get().display_name).toBe('Elf')
  })
})
