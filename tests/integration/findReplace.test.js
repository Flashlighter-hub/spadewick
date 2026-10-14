import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestProject, seedSet, invoke } from '../helpers/project.js'

let ctx
beforeEach(async () => { ctx = await createTestProject() })
afterEach(async () => { await ctx.cleanup() })

const base = () => seedSet({
  fields: [{ name: 'Faction', type: 'text' }, { name: 'Text', type: 'text' }, { name: 'Cost', type: 'number' }, { name: 'Tint', type: 'color' }],
  cards: [
    { name: 'a', fields: { faction: 'Red', text: 'Red dragon, Redder still', cost: '3', tint: '#ff0000' } },
    { name: 'b', fields: { faction: 'Blue', text: 'calm', cost: '3', tint: '#0000ff' } },
    { name: 'c', fields: { faction: 'Red', text: '', cost: '4', tint: '#ff0000' } }
  ]
})

describe('batch find & replace (PRD §5.7)', () => {
  it('replaces literal text across fields (UC-05)', async () => {
    const { set } = await base()
    const res = await invoke('cards:find-replace', { setIds: [set.id], find: 'Red', replace: 'Crimson' })
    expect(res).toHaveLength(2)
    const cards = await invoke('cards:list', set.id)
    expect(cards[0].fields.faction).toBe('Crimson')
    expect(cards[0].fields.text).toBe('Crimson dragon, Crimsonder still')
  })

  it('preview returns changes without applying them', async () => {
    const { set } = await base()
    const res = await invoke('cards:find-replace', { setIds: [set.id], find: 'Red', replace: 'X', previewOnly: true })
    expect(res[0].changes.faction).toEqual({ from: 'Red', to: 'X', rich: false })
    expect((await invoke('cards:list', set.id))[0].fields.faction).toBe('Red')
  })

  it('filters by field', async () => {
    const { set } = await base()
    await invoke('cards:find-replace', { setIds: [set.id], fieldSlugs: ['faction'], find: 'Red', replace: 'X' })
    const [a] = await invoke('cards:list', set.id)
    expect(a.fields.faction).toBe('X')
    expect(a.fields.text).toContain('Red dragon')
  })

  it('only touches text and number fields (not colors)', async () => {
    const { set } = await base()
    await invoke('cards:find-replace', { setIds: [set.id], find: 'ff', replace: 'aa' })
    expect((await invoke('cards:list', set.id))[0].fields.tint).toBe('#ff0000')
  })

  it('supports regex with back-references', async () => {
    const { set } = await base()
    await invoke('cards:find-replace', { setIds: [set.id], find: '(\\w+) dragon', replace: 'dragon of $1', isRegex: true })
    expect((await invoke('cards:list', set.id))[0].fields.text).toBe('dragon of Red, Redder still')
  })

  it('reports an invalid regex instead of corrupting data', async () => {
    const { set } = await base()
    await expect(invoke('cards:find-replace', { setIds: [set.id], find: '(unclosed', replace: 'x', isRegex: true })).rejects.toThrow()
    expect((await invoke('cards:list', set.id))[0].fields.faction).toBe('Red')
  })

  it('does nothing for an empty search string', async () => {
    const { set } = await base()
    expect(await invoke('cards:find-replace', { setIds: [set.id], find: '', replace: 'x' })).toEqual([])
  })

  it('spans multiple sets', async () => {
    const a = await base(), b = await base()
    const res = await invoke('cards:find-replace', { setIds: [a.set.id, b.set.id], find: 'Blue', replace: 'Azure' })
    expect(res).toHaveLength(2)
  })

  it('skips soft-deleted cards', async () => {
    const { set, cards } = await base()
    await invoke('cards:delete', [cards[0].id])
    const res = await invoke('cards:find-replace', { setIds: [set.id], find: 'Red', replace: 'X' })
    expect(res.map(r => r.cardId)).not.toContain(cards[0].id)
  })

  it('does not interpret $ in a literal replacement', async () => {
    const { set } = await base()
    await invoke('cards:find-replace', { setIds: [set.id], find: 'calm', replace: '$1 & $&' })
    expect((await invoke('cards:list', set.id))[1].fields.text).toBe('$1 & $&')
  })
})
