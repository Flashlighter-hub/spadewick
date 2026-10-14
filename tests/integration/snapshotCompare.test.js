import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readdirSync, readFileSync, existsSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createTestProject, seedSet, invoke, makePng } from '../helpers/project.js'

let ctx
beforeEach(async () => { ctx = await createTestProject() })
afterEach(async () => { await ctx.cleanup() })

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="700"><rect width="500" height="700" fill="#fff"/><text x="20" y="60" font-size="40">{{title}}</text></svg>'
const compareFolders = () => readdirSync(tmpdir()).filter(n => n.startsWith('spadewick-compare-'))

async function build() {
  const seeded = await seedSet({
    name: 'Base',
    fields: [{ name: 'Title', type: 'text' }, { name: 'Cost', type: 'number' }],
    template: { svg: SVG },
    cards: [
      { name: 'Fire', fields: { title: 'Fire bolt deals damage', cost: 3 } },
      { name: 'Ice', fields: { title: 'Ice', cost: 2 } },
      { name: 'Wind', fields: { title: 'Wind', cost: 1 } }
    ]
  })
  return seeded
}
const cardRow = async (setId, name) => (await invoke('cards:list', setId)).find(c => c.display_name === name)

describe('snapshot compare (PRD §20)', () => {
  it('says nothing changed when nothing did, and ignores bookkeeping', async () => {
    const { set, cards } = await build()
    const snap = await invoke('snapshots:create', { name: 'v1' })
    await invoke('cards:reorder', { setId: set.id, orderedIds: [cards[2].id, cards[1].id, cards[0].id] })
    const r = await invoke('snapshots:compare-open', { from: snap.id })
    expect(r.cards).toEqual([])
    expect(r.fields).toEqual([])
    expect(r.other).toEqual([])
    expect(r.summary).toMatchObject({ cardsChanged: 0, cardsAdded: 0, cardsRemoved: 0 })
    await invoke('snapshots:compare-close', r.handle)
  })

  it('reports edits, additions, removals, renames and field changes in words', async () => {
    const { set, cards, fields } = await build()
    const snap = await invoke('snapshots:create', { name: 'before balance' })
    await invoke('cards:update', { id: cards[0].id, fields: { cost: 4, title: 'Fire bolt deals great damage' } })
    await invoke('cards:update', { id: cards[1].id, displayName: 'Frost', quantity: 3 })
    await invoke('cards:delete', [cards[2].id])
    const added = await invoke('cards:create', { setId: set.id, displayName: 'Earth', fields: { title: 'Earth' } })
    await invoke('fields:create', { setId: set.id, name: 'Rarity', type: 'text' })
    await invoke('fields:update', { id: fields[1].id, name: 'Mana' })

    const r = await invoke('snapshots:compare-open', { from: snap.id })
    expect(r.summary).toMatchObject({ cardsChanged: 2, cardsAdded: 1, cardsRemoved: 1 })
    const fire = r.cards.find(c => c.id === cards[0].id)
    expect(fire.changes.map(c => [c.kind, c.label, String(c.from), String(c.to)]).sort()).toEqual([
      ['field', 'Mana', '3', '4'], ['field', 'Title', 'Fire bolt deals damage', 'Fire bolt deals great damage']
    ])
    expect(fire.changes.find(c => c.label === 'Title').words.some(w => w.op === 'add' && w.text.includes('great'))).toBe(true)
    const ice = r.cards.find(c => c.id === cards[1].id)
    expect(ice.changes.map(c => c.kind).sort()).toEqual(['field', 'quantity'])   // the name is the value of a field
    expect(ice.changes.find(c => c.kind === 'field')).toMatchObject({ label: 'Card name', from: 'Ice', to: 'Frost' })
    expect(r.cards.find(c => c.id === added.id).kind).toBe('added')
    expect(r.cards.find(c => c.id === cards[2].id)).toMatchObject({ kind: 'removed', restorable: true })
    // A renamed field is one rename, not a removal plus an addition; the new field is listed as added
    expect(r.fields.map(f => f.kind).sort()).toEqual(['added', 'changed'])
    expect(r.fields.find(f => f.kind === 'changed').what[0]).toMatchObject({ aspect: 'name', from: 'Cost', to: 'Mana' })
    await invoke('snapshots:compare-close', r.handle)
  })

  it('draws the card as it was from the snapshot, and cleans up its temporary copy', async () => {
    const { cards } = await build()
    const snap = await invoke('snapshots:create', { name: 'v1' })
    await invoke('cards:update', { id: cards[0].id, fields: { title: 'Changed' } })
    const before = new Set(compareFolders())
    const r = await invoke('snapshots:compare-open', { from: snap.id })
    const mine = compareFolders().filter(f => !before.has(f))        // other test files may be comparing at the same time
    expect(mine).toHaveLength(1)
    const old = await invoke('snapshots:compare-render', { handle: r.handle, side: 'from', cardId: cards[0].id, width: 200 })
    const now = await invoke('snapshots:compare-render', { handle: r.handle, side: 'to', cardId: cards[0].id, width: 200 })
    expect(Buffer.from(old, 'base64').subarray(1, 4).toString()).toBe('PNG')
    expect(old).not.toBe(now)
    await invoke('snapshots:compare-close', r.handle)
    expect(compareFolders()).not.toContain(mine[0])
  })

  it('takes back selected changes only, as one undo step', async () => {
    const { cards } = await build()
    const snap = await invoke('snapshots:create', { name: 'v1' })
    await invoke('cards:update', { id: cards[0].id, displayName: 'Fire 2', fields: { cost: 9, title: 'X' } })
    await invoke('cards:update', { id: cards[1].id, fields: { cost: 8 } })
    const r = await invoke('snapshots:compare-open', { from: snap.id })
    const fire = r.cards.find(c => c.id === cards[0].id)
    const keys = fire.changes.filter(c => c.label === 'Cost' || c.label === 'Card name').map(c => c.key)
    const out = await invoke('snapshots:compare-restore', { handle: r.handle, keys })
    expect(out).toEqual({ restored: 2, skipped: 0 })
    const fireNow = (await invoke('cards:list', cards[0].set_id)).find(c => c.id === cards[0].id)
    expect(fireNow.display_name).toBe('Fire')
    expect(fireNow.fields.cost).toBe(3)            // the original number, not text
    expect(fireNow.fields.title).toBe('X')         // not selected: untouched
    expect((await invoke('cards:list', cards[0].set_id)).find(c => c.id === cards[1].id).fields.cost).toBe(8)
    await invoke('history:undo')
    const undone = (await invoke('cards:list', cards[0].set_id)).find(c => c.id === cards[0].id)
    expect(undone.display_name).toBe('Fire 2')
    expect(undone.fields.cost).toBe(9)
    const again = await invoke('snapshots:compare-refresh', r.handle)
    expect(again.cards.find(c => c.id === cards[0].id).changes.length).toBe(3)
    await invoke('snapshots:compare-close', r.handle)
  })

  it('brings a deleted card back and removes an added one', async () => {
    const { set, cards } = await build()
    const snap = await invoke('snapshots:create', { name: 'v1' })
    await invoke('cards:delete', [cards[2].id])
    const extra = await invoke('cards:create', { setId: set.id, displayName: 'Extra' })
    const r = await invoke('snapshots:compare-open', { from: snap.id })
    const out = await invoke('snapshots:compare-restore', { handle: r.handle, keys: [`card:${cards[2].id}:removed`, `card:${extra.id}:added`] })
    expect(out.restored).toBe(2)
    const names = (await invoke('cards:list', set.id)).map(c => c.display_name).sort()
    expect(names).toEqual(['Fire', 'Ice', 'Wind'])
    expect((await cardRow(set.id, 'Wind')).fields).toMatchObject({ title: 'Wind', cost: 1 })
    const after = await invoke('snapshots:compare-refresh', r.handle)
    expect(after.cards).toEqual([])
    await invoke('snapshots:compare-close', r.handle)
  })

  it('compares two snapshots and refuses to restore from that view', async () => {
    const { cards } = await build()
    const a = await invoke('snapshots:create', { name: 'a' })
    await invoke('cards:update', { id: cards[0].id, fields: { cost: 5 } })
    const b = await invoke('snapshots:create', { name: 'b' })
    await invoke('cards:update', { id: cards[0].id, fields: { cost: 6 } })
    const r = await invoke('snapshots:compare-open', { from: a.id, to: b.id })
    expect(r.live).toBe(false)
    expect(r.cards[0].changes[0]).toMatchObject({ label: 'Cost', from: '3', to: '5' })
    expect(r.cards[0].restorable).toBe(false)
    await expect(invoke('snapshots:compare-restore', { handle: r.handle, keys: [r.cards[0].changes[0].key] })).rejects.toThrow()
    await invoke('snapshots:compare-close', r.handle)
  })

  it('reports templates, images and fonts that changed', async () => {
    await build()
    const snap = await invoke('snapshots:create', { name: 'v1' })
    await invoke('templates:create', { name: 'Second', svgSource: SVG })
    const r = await invoke('snapshots:compare-open', { from: snap.id })
    expect(r.other).toEqual([expect.objectContaining({ area: 'template', kind: 'added', name: 'Second' })])
    await invoke('snapshots:compare-close', r.handle)
  })

  it('reports a set whose card size or name changed', async () => {
    const { set } = await build()
    const snap = await invoke('snapshots:create', { name: 'v1' })
    await invoke('sets:update', { id: set.id, name: 'Renamed' })
    const r = await invoke('snapshots:compare-open', { from: snap.id })
    expect(r.other).toEqual([expect.objectContaining({ area: 'set', kind: 'changed', what: [expect.objectContaining({ aspect: 'name', from: 'Base', to: 'Renamed' })] })])
    await invoke('snapshots:compare-close', r.handle)
  })

  it('draws a changed template before and after, shows its source differences and restores the old version in one undo step', async () => {
    const { template } = await build()
    const snap = await invoke('snapshots:create', { name: 'v1' })
    const edited = SVG.replace('font-size="40"', 'font-size="60"')
    await invoke('templates:update', { id: template.id, svgSource: edited })
    const r = await invoke('snapshots:compare-open', { from: snap.id })
    const item = r.other.find(o => o.area === 'template')
    expect(item).toMatchObject({ kind: 'changed', design: true })
    const old = await invoke('snapshots:compare-render-template', { handle: r.handle, side: 'from', templateId: template.id, width: 150 })
    const now = await invoke('snapshots:compare-render-template', { handle: r.handle, side: 'to', templateId: template.id, width: 150 })
    expect(old).toBeTruthy(); expect(now).toBeTruthy(); expect(old).not.toBe(now)
    const lines = await invoke('snapshots:compare-template-source', { handle: r.handle, templateId: template.id })
    expect(lines.some(l => l.op === 'del' && l.text.includes('font-size="40"'))).toBe(true)
    expect(lines.some(l => l.op === 'add' && l.text.includes('font-size="60"'))).toBe(true)

    const out = await invoke('snapshots:compare-restore', { handle: r.handle, keys: [item.key] })
    expect(out.restored).toBe(1)
    expect((await invoke('templates:get', template.id)).svg_source).toBe(SVG)
    await invoke('history:undo')
    expect((await invoke('templates:get', template.id)).svg_source).toBe(edited)
    await invoke('snapshots:compare-close', r.handle)
  })

  it('brings a deleted image back with its file, and undo takes it away again', async () => {
    await build()
    const [asset] = await invoke('assets:import', [await makePng(join(ctx.root, 'pic.png'))])
    const snap = await invoke('snapshots:create', { name: 'v1' })
    await invoke('assets:delete', asset.id)
    expect(existsSync(join(ctx.dir, 'assets', asset.filename))).toBe(false)
    const r = await invoke('snapshots:compare-open', { from: snap.id })
    const item = r.other.find(o => o.area === 'asset')
    expect(item).toMatchObject({ kind: 'removed' })
    expect(item.thumb).toBeTruthy()
    expect((await invoke('snapshots:compare-restore', { handle: r.handle, keys: [item.key] })).restored).toBe(1)
    expect(existsSync(join(ctx.dir, 'assets', asset.filename))).toBe(true)
    expect((await invoke('assets:list', {})).map(a => a.id)).toContain(asset.id)
    await invoke('history:undo')
    expect(existsSync(join(ctx.dir, 'assets', asset.filename))).toBe(false)
    await invoke('snapshots:compare-close', r.handle)
  })

  it('writes the change list as Markdown, CSV and HTML', async () => {
    const { cards } = await build()
    const snap = await invoke('snapshots:create', { name: 'before' })
    await invoke('cards:update', { id: cards[0].id, fields: { cost: 4 } })
    const r = await invoke('snapshots:compare-open', { from: snap.id })
    const write = async (format, name) => { const path = join(ctx.root, name); await invoke('snapshots:compare-export', { handle: r.handle, format, path }); return readFileSync(path, 'utf8') }
    expect(await write('markdown', 'c.md')).toMatch(/^# Since “before”[\s\S]*Cost: 3 → 4/)
    expect(await write('csv', 'c.csv')).toMatch(/^area,change,set,name,card_id,what,from,to\s+card,changed,Base,Fire,[^,]*,Cost,3,4/)
    expect(await write('html', 'c.html')).toMatch(/<h1>[\s\S]*Cost: 3 → 4/)
    await expect(invoke('snapshots:compare-export', { handle: r.handle, format: 'docx', path: join(ctx.root, 'x') })).rejects.toThrow()
    await invoke('snapshots:compare-close', r.handle)
  })
})
