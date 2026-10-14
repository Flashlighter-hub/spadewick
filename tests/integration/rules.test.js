/**
 * The Rules (PRD §7.11): pages of Markdown in a tree, kept in the project, with import and export.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs'
import { createTestProject, seedSet, invoke, mockDialog, makePng } from '../helpers/project.js'
import { openProjectDb } from '../../src/main/db.js'
import { opened } from '../helpers/electron-mock.js'

let ctx
beforeEach(async () => { ctx = await createTestProject() })
afterEach(async () => { mockDialog.reset(); await ctx.cleanup() })

const titles = async () => (await invoke('rules:list')).map(p => p.title)
const tree = async () => {
  const rows = await invoke('rules:list')
  const walk = parent => rows.filter(r => (r.parent_id ?? null) === parent).sort((a, b) => a.sort_order - b.sort_order).map(r => ({ title: r.title, children: walk(r.id) }))
  return walk(null)
}

describe('pages', () => {
  it('creates pages at the end of their parent, and reads them back', async () => {
    const a = await invoke('rules:create', { title: 'Overview', body: '# hi' })
    const b = await invoke('rules:create', { title: 'Turns' })
    const c = await invoke('rules:create', { parentId: b.id, title: 'Phases' })
    expect([a.sort_order, b.sort_order, c.sort_order]).toEqual([0, 1, 0])
    expect(await tree()).toEqual([{ title: 'Overview', children: [] }, { title: 'Turns', children: [{ title: 'Phases', children: [] }] }])
    expect(await invoke('rules:get', a.id)).toMatchObject({ title: 'Overview', body: '# hi' })
    expect(await invoke('rules:get', 'nope')).toBeNull()
    expect((await invoke('rules:list'))[0]).toMatchObject({ size: 4 })
    expect((await invoke('rules:create', {})).title).toBe('Untitled page')
    await expect(invoke('rules:create', { parentId: 'nope', title: 'x' })).rejects.toThrow(/not found/)
  })

  it('changes the title and the text; only a new title is a step of undo', async () => {
    const p = await invoke('rules:create', { title: 'Old', body: 'one' })
    await invoke('rules:update', { id: p.id, body: 'two' })
    await invoke('rules:update', { id: p.id, body: 'three' })
    await invoke('rules:update', { id: p.id, title: '  New   title ' })
    expect(await invoke('rules:get', p.id)).toMatchObject({ title: 'New title', body: 'three' })
    await invoke('history:undo')
    expect(await invoke('rules:get', p.id)).toMatchObject({ title: 'Old' })
    await invoke('history:undo')                                                        // the creation
    expect(await invoke('rules:get', p.id)).toBeNull()
    await expect(invoke('rules:update', { id: 'nope', body: 'x' })).rejects.toThrow(/not found/)
    const q = await invoke('rules:create', { title: 'Q' })
    await expect(invoke('rules:update', { id: q.id, title: '   ' })).rejects.toThrow(/title/)
    await expect(invoke('rules:update', { id: q.id, body: 'x'.repeat(1_000_001) })).rejects.toThrow(/too long/)
    expect((await invoke('rules:get', q.id)).title).toBe('Q')
  })

  it('moves a page: among its pages, under another, and back to the top; one step of undo each', async () => {
    const [a, b, c] = [await invoke('rules:create', { title: 'A' }), await invoke('rules:create', { title: 'B' }), await invoke('rules:create', { title: 'C' })]
    await invoke('rules:move', { id: c.id, parentId: null, index: 0 })
    expect(await titles()).toEqual(['C', 'A', 'B'])
    await invoke('rules:move', { id: a.id, parentId: b.id })
    expect(await tree()).toEqual([{ title: 'C', children: [] }, { title: 'B', children: [{ title: 'A', children: [] }] }])
    await invoke('rules:move', { id: a.id, parentId: null, index: 1 })
    expect(await tree()).toEqual([{ title: 'C', children: [] }, { title: 'A', children: [] }, { title: 'B', children: [] }])
    await invoke('history:undo')
    expect(await tree()).toEqual([{ title: 'C', children: [] }, { title: 'B', children: [{ title: 'A', children: [] }] }])
    await invoke('history:undo')
    expect(await titles()).toEqual(['C', 'A', 'B'])
    // the order is kept without gaps
    expect((await invoke('rules:list')).filter(p => !p.parent_id).map(p => p.sort_order).sort()).toEqual([0, 1, 2])
    void b
  })

  it('refuses to put a page into itself or into a page below it', async () => {
    const a = await invoke('rules:create', { title: 'A' })
    const b = await invoke('rules:create', { parentId: a.id, title: 'B' })
    const c = await invoke('rules:create', { parentId: b.id, title: 'C' })
    await expect(invoke('rules:move', { id: a.id, parentId: a.id })).rejects.toThrow(/cannot go into/)
    await expect(invoke('rules:move', { id: a.id, parentId: c.id })).rejects.toThrow(/cannot go into/)
    await expect(invoke('rules:move', { id: a.id, parentId: 'nope' })).rejects.toThrow(/cannot go into/)
    await expect(invoke('rules:move', { id: 'nope', parentId: null })).rejects.toThrow(/not found/)
    expect(await tree()).toEqual([{ title: 'A', children: [{ title: 'B', children: [{ title: 'C', children: [] }] }] }])
  })

  it('deletes a page with the pages below it, and undo brings them all back', async () => {
    const a = await invoke('rules:create', { title: 'A', body: 'text a' })
    const b = await invoke('rules:create', { parentId: a.id, title: 'B', body: 'text b' })
    await invoke('rules:create', { parentId: b.id, title: 'C' })
    await invoke('rules:create', { title: 'D' })
    await invoke('rules:delete', a.id)
    expect(await tree()).toEqual([{ title: 'D', children: [] }])
    expect((await invoke('rules:list')).map(p => p.sort_order)).toEqual([0])
    await invoke('history:undo')
    expect(await tree()).toEqual([{ title: 'A', children: [{ title: 'B', children: [{ title: 'C', children: [] }] }] }, { title: 'D', children: [] }])
    expect(await invoke('rules:get', b.id)).toMatchObject({ body: 'text b' })
    await invoke('rules:delete', 'nope')                                                // nothing there: not an error
  })

  it('limits the number of pages', async () => {
    const d = openProjectDb(ctx.dir)
    const ins = d.prepare("INSERT INTO rules_pages (id, parent_id, title, body, sort_order, created_at, updated_at) VALUES (?, NULL, 'x', '', ?, 0, 0)")
    d.transaction(() => { for (let i = 0; i < 1000; i++) ins.run(`p${i}`, i) })()
    await expect(invoke('rules:create', { title: 'one more' })).rejects.toThrow(/1000 pages/)
  })

  it('lists the cards of the project so a page can point to them', async () => {
    await seedSet({ name: 'Base', fields: [{ name: 'T', type: 'text' }], cards: [{ name: 'Fire' }, { name: 'Ice' }] })
    await seedSet({ name: 'Other', cards: [{ name: 'Moss' }] })
    const cards = await invoke('rules:cards')
    expect(cards.map(c => [c.name, c.set])).toEqual([['Fire', 'Base'], ['Ice', 'Base'], ['Moss', 'Other']])
    expect(cards[0].code).toMatch(/-0001$/)
  })

  it('opens only links to the web and to a mail address', async () => {
    opened.length = 0
    await invoke('rules:open-link', 'https://example.com')
    await invoke('rules:open-link', 'mailto:a@b.c')
    expect(opened).toEqual(['https://example.com', 'mailto:a@b.c'])
    for (const bad of ['javascript:alert(1)', 'file:///c:/x', 'ftp://x', 'notaurl', '']) await expect(invoke('rules:open-link', bad)).rejects.toThrow(/Only links/)
    expect(opened).toHaveLength(2)
  })
})

describe('snapshots', () => {
  it('a snapshot keeps the rules, and restoring one brings back a deleted page', async () => {
    const a = await invoke('rules:create', { title: 'A', body: 'important' })
    const snap = await invoke('snapshots:create', { name: 'before' })
    await invoke('rules:delete', a.id)
    expect(await titles()).toEqual([])
    await invoke('snapshots:restore', snap.id)
    expect(await invoke('rules:get', a.id)).toMatchObject({ title: 'A', body: 'important' })
  })

  it('compare lists pages that were added, removed or changed, and "use the old version" puts one back', async () => {
    const a = await invoke('rules:create', { title: 'A', body: 'one' })
    const b = await invoke('rules:create', { title: 'B', body: 'bee' })
    const snap = await invoke('snapshots:create', { name: 'v1' })
    await invoke('rules:update', { id: a.id, title: 'A2', body: 'two' })
    await invoke('rules:delete', b.id)
    await invoke('rules:create', { title: 'C' })
    const r = await invoke('snapshots:compare-open', { from: snap.id })
    const rules = r.other.filter(o => o.area === 'rules')
    expect(rules.map(o => [o.kind, o.name]).sort()).toEqual([['added', 'C'], ['changed', 'A2'], ['removed', 'B']])
    expect(rules.find(o => o.kind === 'changed')).toMatchObject({ title: true, words: true, oldName: 'A' })
    const out = await invoke('snapshots:compare-restore', { handle: r.handle, keys: rules.filter(o => o.kind !== 'added').map(o => o.key) })
    expect(out.restored).toBe(2)
    expect(await invoke('rules:get', a.id)).toMatchObject({ title: 'A', body: 'one' })
    expect(await invoke('rules:get', b.id)).toMatchObject({ title: 'B', body: 'bee' })
    await invoke('snapshots:compare-close', r.handle)
  })
})

describe('export and import', () => {
  async function sample() {
    const png = await makePng(join(ctx.root, 'board.png'), 30, 20, '#336699')
    await invoke('assets:import', [png])
    const a = await invoke('rules:create', { title: 'Overview', body: 'Welcome to **the game**.\n\n![The board](asset:board.png)\n\nSee [[Fire]].' })
    const t = await invoke('rules:create', { title: 'Turn order', body: 'Draw, play, discard.' })
    await invoke('rules:create', { parentId: t.id, title: 'Draw phase', body: '1. Draw two cards.' })
    await invoke('rules:create', { parentId: t.id, title: 'Play phase', body: '- Play one card.' })
    await invoke('rules:create', { title: 'Glossary' })
    return { a, t }
  }

  it('writes one page as a Markdown file with its title, and its pictures beside it', async () => {
    const { a } = await sample()
    const file = join(ctx.root, 'out', 'overview.md')
    mkdirSync(join(ctx.root, 'out'))
    mockDialog.save(file)
    expect(await invoke('rules:export-page', { id: a.id })).toEqual({ canceled: false, path: file })
    const text = readFileSync(file, 'utf8')
    expect(text.startsWith('# Overview\n\nWelcome to **the game**.')).toBe(true)
    expect(text).toContain('![The board](images/board.png)')
    expect(text).not.toContain('asset:')
    expect(existsSync(join(ctx.root, 'out', 'images', 'board.png'))).toBe(true)
    mockDialog.save(null)
    expect(await invoke('rules:export-page', { id: a.id })).toEqual({ canceled: true })
  })

  it('writes every page into a folder, in order, a page\'s pages in a folder of their own', async () => {
    await sample()
    mockDialog.open(ctx.root)
    const r = await invoke('rules:export-all')
    expect(r).toMatchObject({ canceled: false, files: 5 })
    const root = join(ctx.root, 'rules')
    expect(readdirSync(root).sort()).toEqual(['01-overview.md', '02-turn-order', '02-turn-order.md', '03-glossary.md', 'images'])
    expect(readdirSync(join(root, '02-turn-order')).sort()).toEqual(['01-draw-phase.md', '02-play-phase.md'])
    expect(readFileSync(join(root, '01-overview.md'), 'utf8')).toContain('![The board](images/board.png)')
    expect(existsSync(join(root, 'images', 'board.png'))).toBe(true)
    expect(readFileSync(join(root, '02-turn-order', '01-draw-phase.md'), 'utf8')).toBe('# Draw phase\n\n1. Draw two cards.\n')
  })

  it('what is exported can be imported into another project, as the same tree with the same words and pictures', async () => {
    await sample()
    mockDialog.open(ctx.root)
    await invoke('rules:export-all')
    await invoke('projects:close')
    await invoke('projects:create', { name: 'Elsewhere', parentDir: ctx.root })
    expect(await invoke('rules:list')).toEqual([])
    mockDialog.open(join(ctx.root, 'rules'))
    const r = await invoke('rules:import-folder', {})
    expect(r).toMatchObject({ canceled: false, pages: 5, pictures: 1 })
    expect(await tree()).toEqual([
      { title: 'Overview', children: [] },
      { title: 'Turn order', children: [{ title: 'Draw phase', children: [] }, { title: 'Play phase', children: [] }] },
      { title: 'Glossary', children: [] }
    ])
    const overview = (await invoke('rules:list')).find(p => p.title === 'Overview')
    const body = (await invoke('rules:get', overview.id)).body
    expect(body).toContain('Welcome to **the game**.')
    expect(body).toContain('![The board](asset:board.png)')                          // the picture is in this project's library now
    expect((await invoke('assets:list', {})).map(a => a.original_name)).toEqual(['board.png'])
    await invoke('history:undo')                                                       // the whole import is one step
    expect(await invoke('rules:list')).toEqual([])
  })

  it('imports Markdown files as pages under a page: the title is the first heading, else the file name', async () => {
    const dir = join(ctx.root, 'md'); mkdirSync(dir)
    writeFileSync(join(dir, '01-setup.md'), '# Setting up\n\nPut out the board.\n')
    writeFileSync(join(dir, 'scoring_rules.markdown'), 'No heading here.\n')
    writeFileSync(join(dir, 'notes.pdf'), 'not markdown')
    const parent = await invoke('rules:create', { title: 'Rules' })
    mockDialog.open(join(dir, '01-setup.md'), join(dir, 'scoring_rules.markdown'), join(dir, 'notes.pdf'))
    const r = await invoke('rules:import-files', { parentId: parent.id })
    expect(r).toMatchObject({ canceled: false, pages: 2 })
    expect(await tree()).toEqual([{ title: 'Rules', children: [{ title: 'Setting up', children: [] }, { title: 'scoring rules', children: [] }] }])
    const setup = (await invoke('rules:list')).find(p => p.title === 'Setting up')
    expect((await invoke('rules:get', setup.id)).body).toBe('Put out the board.\n')
    mockDialog.open(join(dir, 'notes.pdf'))
    await expect(invoke('rules:import-files', {})).rejects.toThrow(/no Markdown/)
    mockDialog.open()
    expect(await invoke('rules:import-files', {})).toEqual({ canceled: true })
    await expect(invoke('rules:import-files', { parentId: 'nope' })).rejects.toThrow(/not found/)
  })

  it('imports a folder whose pages sit in folders with no file of their own as pages with no text', async () => {
    const dir = join(ctx.root, 'book'); mkdirSync(join(dir, 'part-one'), { recursive: true })
    writeFileSync(join(dir, 'part-one', 'a.md'), '# Chapter A\n\ntext')
    writeFileSync(join(dir, 'part-one', 'b.md'), '# Chapter B\n\ntext')
    mockDialog.open(dir)
    await invoke('rules:import-folder', {})
    expect(await tree()).toEqual([{ title: 'part one', children: [{ title: 'Chapter A', children: [] }, { title: 'Chapter B', children: [] }] }])
    mockDialog.open(join(ctx.root, 'md-nothing')); mkdirSync(join(ctx.root, 'md-nothing'))
    await expect(invoke('rules:import-folder', {})).rejects.toThrow(/no Markdown/)
  })

  it('leaves a picture it cannot find as it is, and a link to the web alone', async () => {
    const dir = join(ctx.root, 'md2'); mkdirSync(dir)
    writeFileSync(join(dir, 'a.md'), '# A\n\n![x](missing.png) ![y](https://example.com/y.png) ![z](../outside.txt)\n')
    mockDialog.open(join(dir, 'a.md'))
    const r = await invoke('rules:import-files', {})
    expect(r.pictures).toBe(0)
    const page = (await invoke('rules:get', r.ids[0]))
    expect(page.body).toContain('![x](missing.png)')
    expect(page.body).toContain('![y](https://example.com/y.png)')
  })

  it('writes everything as one web page that needs nothing else: contents, pictures, cards and links between pages', async () => {
    const s = await seedSet({ name: 'Base', fields: [{ name: 'Title', type: 'text' }], template: { svg: '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="700" viewBox="0 0 500 700"><rect width="500" height="700" fill="#336699"/></svg>' }, cards: [{ name: 'Fire' }] })
    await invoke('sets:update', { id: s.set.id, defaultTemplateId: s.template.id })
    const png = await makePng(join(ctx.root, 'board.png'), 30, 20, '#336699')
    await invoke('assets:import', [png])
    const t = await invoke('rules:create', { title: 'Turn order', body: '## Draw\n\nDraw cards.' })
    await invoke('rules:create', { title: 'Overview', body: 'Go to [turns](page:Turn order) or [the draw](#draw). ![b](asset:board.png)\n\n![[Fire]] and [[Fire]]\n\n[web](https://example.com/?a=1&b=2) <script>x</script>' })
    await invoke('rules:move', { id: t.id, parentId: null, index: 1 })
    const file = join(ctx.root, 'rules.html')
    mockDialog.save(file)
    expect(await invoke('rules:export-html')).toMatchObject({ canceled: false, pages: 2 })
    const html = readFileSync(file, 'utf8')
    expect(html).toContain('<!doctype html>')
    expect(html).toContain('<nav aria-label="Contents">')
    expect(html).toMatch(/<li[^>]*><a href="#page-0">Overview<\/a><\/li>/)
    expect(html).toContain('<a href="#page-1">turns</a>')                           // a link to another page
    expect(html).toContain('id="p1-draw"')
    expect(html).toMatch(/<img src="data:image\/webp;base64,[A-Za-z0-9+/=]+" alt="b" \/>/)       // the project's picture is inside
    expect(html).toMatch(/<figure class="card-embed"><img src="data:image\/png;base64,[A-Za-z0-9+/=]+" alt="Fire" \/>/)   // the picture of a card
    expect(html).toContain('<span class="card-ref">Fire</span>')
    expect(html).toContain('href="https://example.com/?a=1&amp;b=2"')
    expect(html).not.toContain('<script>x')
    expect(html).not.toMatch(/data-rules-/)
    mockDialog.save(null)
    expect(await invoke('rules:export-html')).toEqual({ canceled: true })
  })

  it('has nothing to write when there are no pages', async () => {
    mockDialog.open(ctx.root)
    await expect(invoke('rules:export-all')).rejects.toThrow(/no pages/)
    mockDialog.save(join(ctx.root, 'x.html'))
    await expect(invoke('rules:export-html')).rejects.toThrow(/no pages/)
  })
})
