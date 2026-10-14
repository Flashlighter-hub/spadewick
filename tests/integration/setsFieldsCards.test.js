import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestProject, seedSet, invoke } from '../helpers/project.js'

let ctx
beforeEach(async () => { ctx = await createTestProject() })
afterEach(async () => { await ctx.cleanup() })

describe('sets', () => {
  it('creates, renames, orders, sets a size override and deletes', async () => {
    const a = await invoke('sets:create', { name: 'A' })
    const b = await invoke('sets:create', { name: 'B', description: 'second' })
    expect((await invoke('sets:list')).map(s => s.name)).toEqual(['A', 'B'])
    await invoke('sets:reorder', [b.id, a.id])
    expect((await invoke('sets:list')).map(s => s.name)).toEqual(['B', 'A'])
    const upd = await invoke('sets:update', { id: a.id, name: 'A2', cardSize: 'tarot' })
    expect(upd).toMatchObject({ name: 'A2', card_size: 'tarot' })
    expect((await invoke('cardsize:get', a.id)).id).toBe('tarot')
    await invoke('sets:update', { id: a.id, cardSize: null })
    expect((await invoke('cardsize:get', a.id)).id).toBe('poker')
    await invoke('sets:delete', b.id)
    expect((await invoke('sets:list')).map(s => s.id)).toEqual([a.id])
  })

  it('deleting a set removes its fields and cards (cascade)', async () => {
    const { set } = await seedSet({ fields: [{ name: 'N', type: 'text' }], cards: [{ name: 'x' }] })
    await invoke('sets:delete', set.id)
    expect(await invoke('cards:list', set.id)).toEqual([])
    expect(await invoke('fields:list', set.id)).toEqual([])
  })

  it('has no project default card size any more', async () => {
    await expect(invoke('cardsize:set-project', { cardSize: 'mini_us' })).rejects.toThrow(/No IPC handler/)
  })

  it('resolves any card size to its pixel size', async () => {
    expect(await invoke('cardsize:resolve', { cardSize: 'mini_us' })).toMatchObject({ id: 'mini_us', mmW: 41, mmH: 63, widthPx: 500 })
    expect(await invoke('cardsize:resolve', { cardSize: 'custom', cardMmW: 50, cardMmH: 100 })).toMatchObject({ id: 'custom', heightPx: 1000 })
    expect(await invoke('cardsize:resolve', {})).toMatchObject({ id: 'poker' })   // Poker is the preselected size
  })
})

describe('fields (PRD §5.3)', () => {
  it('derives a slug from the name when none is given', async () => {
    const set = await invoke('sets:create', { name: 'S' })
    const f = await invoke('fields:create', { setId: set.id, name: 'Mana Cost!', type: 'number' })
    expect(f.slug).toBe('mana_cost')
  })

  it('enforces unique slugs within a set but not across sets', async () => {
    const s1 = await invoke('sets:create', { name: 'S1' }), s2 = await invoke('sets:create', { name: 'S2' })
    await invoke('fields:create', { setId: s1.id, name: 'Cost', type: 'number' })
    await expect(invoke('fields:create', { setId: s1.id, name: 'cost', type: 'number' })).rejects.toThrow()
    await expect(invoke('fields:create', { setId: s2.id, name: 'Cost', type: 'number' })).resolves.toBeTruthy()
  })

  it('assigns increasing display order and supports reordering and hiding', async () => {
    const { set, fields } = await seedSet({ fields: [{ name: 'A', type: 'text' }, { name: 'B', type: 'text' }, { name: 'C', type: 'text' }] })
    expect(fields.map(f => f.display_order)).toEqual([0, 1, 2])
    await invoke('fields:reorder', { setId: set.id, orderedIds: [fields[2].id, fields[0].id, fields[1].id] })
    expect((await invoke('fields:list', set.id)).map(f => f.name)).toEqual(['C', 'A', 'B'])
    await invoke('fields:update', { id: fields[0].id, hidden: true })
    expect((await invoke('fields:list', set.id)).find(f => f.name === 'A').hidden).toBe(1)
  })

  it('renaming the display name never touches card data', async () => {
    const { set, fields, cards } = await seedSet({ fields: [{ name: 'Attack', type: 'number' }], cards: [{ name: 'c', fields: { attack: '5' } }] })
    await invoke('fields:update', { id: fields[0].id, name: 'Power' })
    const [card] = await invoke('cards:list', set.id)
    expect(card.fields).toMatchObject({ attack: '5' })
    expect((await invoke('fields:list', set.id))[0]).toMatchObject({ name: 'Power', slug: 'attack' })
    expect(cards.length).toBe(1)
  })

  it('changing a slug moves card data and rewrites template tokens', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>{{attack}}</text><text>{{ attack }}</text><text>{{attack2}}</text></svg>'
    const { set, fields } = await seedSet({
      fields: [{ name: 'Attack', type: 'number' }],
      cards: [{ name: 'c1', fields: { attack: '5' } }, { name: 'c2', fields: {} }],
      template: { svg }
    })
    await invoke('fields:update', { id: fields[0].id, slug: 'power' })
    const cards = await invoke('cards:list', set.id)
    expect(cards[0].fields).toMatchObject({ power: '5' })
    expect(cards[0].fields.attack).toBeUndefined()
    expect(cards[1].fields.power).toBeUndefined()
    const t = (await invoke('templates:list'))[0]
    const full = await invoke('templates:get', t.id)
    expect(full.svg_source).toContain('<text>{{power}}</text><text>{{power}}</text>')
    expect(full.svg_source).toContain('{{attack2}}') // a different slug sharing a prefix is untouched
  })

  it('does not treat regex characters in a slug as a pattern', async () => {
    const { fields } = await seedSet({ fields: [{ name: 'X', slug: 'a.b', type: 'text' }], template: { svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>{{a.b}}{{axb}}</text></svg>' } })
    await invoke('fields:update', { id: fields[0].id, slug: 'c' })
    const full = await invoke('templates:get', (await invoke('templates:list'))[0].id)
    expect(full.svg_source).toContain('{{c}}{{axb}}')
  })

  it('evaluates formulas and detects circular references', async () => {
    expect(await invoke('fields:evaluate-formula', { formula: 'concat(a, "-", b)', fields: { a: 'x', b: 'y' } })).toBe('x-y')
    expect(await invoke('fields:check-circular', [{ slug: 'a', type: 'formula', formula: 'upper(b)' }, { slug: 'b', type: 'formula', formula: 'upper(a)' }])).toBe(true)
  })
})

describe('cards (PRD §5.2, §6.1)', () => {
  it('creates cards with increasing sort order and stable string ids', async () => {
    const { cards } = await seedSet({ cards: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] })
    expect(cards.map(c => c.sort_order)).toEqual([0, 1, 2])
    expect(new Set(cards.map(c => c.id)).size).toBe(3)
  })

  it('merges partial field updates instead of replacing', async () => {
    const { set, cards } = await seedSet({ cards: [{ name: 'a', fields: { x: '1', y: '2' } }] })
    await invoke('cards:update', { id: cards[0].id, fields: { y: '3' } })
    expect((await invoke('cards:list', set.id))[0].fields).toMatchObject({ x: '1', y: '3' })
  })

  it('soft-deletes: hidden from lists but retained in the database', async () => {
    const { set, cards } = await seedSet({ cards: [{ name: 'a' }, { name: 'b' }] })
    await invoke('cards:delete', [cards[0].id])
    expect((await invoke('cards:list', set.id)).map(c => c.display_name)).toEqual(['b'])
  })

  it('duplicates cards at the end of the set', async () => {
    const { set, cards } = await seedSet({ cards: [{ name: 'a', fields: { k: 'v' } }, { name: 'b' }] })
    const [copy] = await invoke('cards:duplicate', [cards[0].id])
    expect(copy.display_name).toBe('a (copy)')
    const list = await invoke('cards:list', set.id)
    expect(list.at(-1).id).toBe(copy.id)
    expect(list.at(-1).fields).toMatchObject({ k: 'v' })
  })

  it('reorders cards', async () => {
    const { set, cards } = await seedSet({ cards: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] })
    await invoke('cards:reorder', { setId: set.id, orderedIds: [cards[2].id, cards[0].id, cards[1].id] })
    expect((await invoke('cards:list', set.id)).map(c => c.display_name)).toEqual(['c', 'a', 'b'])
  })

  it('bulk-updates a field on many cards', async () => {
    const { set, cards } = await seedSet({ cards: [{ name: 'a', fields: { f: '1' } }, { name: 'b', fields: { f: '2' } }] })
    await invoke('cards:batch-update', { cardIds: cards.map(c => c.id), fields: { f: 'X' } })
    expect((await invoke('cards:list', set.id)).map(c => c.fields.f)).toEqual(['X', 'X'])
  })

  it('handles 1,000 cards quickly (PRD §14.1 project open)', async () => {
    const set = await invoke('sets:create', { name: 'Big' })
    for (let i = 0; i < 1000; i++) await invoke('cards:create', { setId: set.id, displayName: `c${i}`, fields: { n: String(i) } })
    const t = Date.now()
    const list = await invoke('cards:list', set.id)
    expect(list.length).toBe(1000)
    expect(Date.now() - t).toBeLessThan(500)
  })
})
