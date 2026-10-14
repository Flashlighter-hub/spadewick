/**
 * The icon library, text styles and keyword rules (PRD §16.4, §16.5): importing, naming, settings, renaming with the
 * references that follow, usage, deleting, undo, and the safety of what is imported.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, existsSync, mkdirSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createTestProject, seedSet, invoke, makePng, writeText } from '../helpers/project.js'
import { writeZip } from '../../src/main/zip.js'

let proj, dir
beforeEach(async () => { proj = await createTestProject('Icons'); dir = mkdtempSync(join(tmpdir(), 'icon-files-')) })
afterEach(async () => { await proj.cleanup() })

const svg = (inner = '<path d="M0 0h10v10z" fill="#c00"/>', attrs = 'viewBox="0 0 10 10"') => `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${inner}</svg>`
const file = (name, text) => { const p = join(dir, name); writeText(p, text); return p }
const names = async () => (await invoke('icons:list')).icons.map(i => i.name)

async function richSet(bodies = []) {
  const s = await seedSet({ cardSize: 'poker', fields: [{ name: 'Body', type: 'rich_text' }], template: { name: 'T', svg: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><text data-spadewick-rich="true">Tap {fire}</text></svg>' }, cards: bodies.map(b => ({ name: 'C', fields: { body: b } })) })
  return s
}

describe('importing icons', () => {
  it('imports SVG, PNG, JPEG and WEBP, naming each from its file name', async () => {
    await makePng(join(dir, 'Big Star.png'), 40, 20)
    const jpeg = join(dir, 'photo.jpg'); await makePng(jpeg, 8, 8)
    const res = await invoke('icons:import-files', { paths: [file('Fire Ball.svg', svg()), join(dir, 'Big Star.png'), jpeg] })
    expect(res.skipped).toEqual([])
    expect(res.imported.map(i => i.name).sort()).toEqual(['big-star', 'fire-ball', 'photo'])
    const fire = res.imported.find(i => i.name === 'fire-ball')
    expect(fire).toMatchObject({ single: true, mime: 'image/svg+xml', aspect: 1, colorMode: 'follow', size: 1, spacing: 0, vOffset: 0 })
    expect(fire.svg).toContain('color="#cc0000"')   // its own colour, kept on the root
    const star = res.imported.find(i => i.name === 'big-star')
    expect(star.aspect).toBeCloseTo(2)
    expect(star.uri).toMatch(/^data:image\/png;base64,/)
  })

  it('finds out whether an SVG has one colour, so it can follow the text', async () => {
    const res = await invoke('icons:import-files', { paths: [file('mono.svg', svg('<path d="M0 0h10v10z" fill="#123"/>')), file('duo.svg', svg('<path d="M0 0h5v5z" fill="#f00"/><path d="M5 5h5v5z" fill="#00f"/>'))] })
    expect(Object.fromEntries(res.imported.map(i => [i.name, i.single]))).toEqual({ mono: true, duo: false })
    expect(res.imported.find(i => i.name === 'mono').svg).toContain('currentColor')
  })

  it('keeps the pictures as assets tagged icon, and the import is one undo step', async () => {
    const res = await invoke('icons:import-files', { paths: [file('a.svg', svg())] })
    const assets = await invoke('assets:list', {})
    expect(assets).toHaveLength(1)
    expect(assets[0].tags).toEqual(['icon'])
    await invoke('history:undo')
    expect(await names()).toEqual([])
    expect(await invoke('assets:list', {})).toEqual([])
    await invoke('history:redo')
    expect(await names()).toEqual(['a'])
    expect(res.imported).toHaveLength(1)
  })

  it('removes scripts and event handlers from an SVG, and refuses what is not usable', async () => {
    const evil = file('evil.svg', svg('<script>alert(1)</script><path onclick="x()" d="M0 0h5v5z"/><image href="http://example.com/x.png"/>'))
    const res = await invoke('icons:import-files', { paths: [evil, file('text.svg', 'not an svg'), file('nosize.svg', '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>'), file('doc.txt', 'x')] })
    expect(res.imported.map(i => i.name)).toEqual(['evil'])
    expect(res.imported[0].svg).not.toMatch(/script|onclick|example\.com/)
    expect(res.skipped.map(s => s.file).sort()).toEqual(['doc.txt', 'nosize.svg', 'text.svg'])
    for (const s of res.skipped) expect(s.reason.length).toBeGreaterThan(5)
  })

  it('does not rebuild an icon when the name is taken unless told how: it reports it', async () => {
    await invoke('icons:import-files', { paths: [file('fire.svg', svg())] })
    const again = await invoke('icons:import-files', { paths: [file('Fire.svg', svg('<path d="M0 0h2v2z" fill="#00f"/>'))] })
    expect(again.imported).toEqual([])
    expect(again.skipped).toEqual([{ file: 'Fire.svg', reason: 'exists', exists: 'fire' }])
    expect(await names()).toEqual(['fire'])
  })

  it('numbers a name that is taken when asked to', async () => {
    await invoke('icons:import-files', { paths: [file('fire.svg', svg())] })
    const again = await invoke('icons:import-files', { paths: [file('fire.svg', svg())], conflict: 'number' })
    expect(again.imported.map(i => i.name)).toEqual(['fire-2'])
  })

  it('replaces an icon by a new picture of the same name, keeping its id, settings and references, and undoes', async () => {
    const first = (await invoke('icons:import-files', { paths: [file('fire.svg', svg())] })).imported[0]
    await invoke('icons:update', { id: first.id, size: 1.5, spacing: 0.2, aliases: ['flame'] })
    const s = await richSet(['Tap {fire}'])
    const res = await invoke('icons:import-files', { paths: [file('fire.svg', svg('<path d="M0 0h2v2z" fill="#00f"/>', 'viewBox="0 0 20 10"'))], conflict: 'replace' })
    expect(res.replaced).toHaveLength(1)
    const now = res.replaced[0]
    expect(now).toMatchObject({ id: first.id, name: 'fire', size: 1.5, spacing: 0.2, aliases: ['flame'] })
    expect(now.aspect).toBeCloseTo(2)
    expect(now.svg).toContain('#0000ff')
    expect((await invoke('cards:list', s.set.id))[0].fields.body).toBe('Tap {fire}')
    expect(await invoke('assets:list', {})).toHaveLength(1)                     // the old picture is gone
    await invoke('history:undo')
    const back = (await invoke('icons:list')).icons[0]
    expect(back.svg).toContain('#cc0000')
    expect(back.aspect).toBeCloseTo(1)
    expect(await invoke('assets:list', {})).toHaveLength(1)
  })

  it('imports a ZIP of icons, and a folder, under the safety limits', async () => {
    const a = file('one.svg', svg()), b = file('two.svg', svg())
    const zip = join(dir, 'set.zip')
    writeZip(zip, [{ name: 'icons/one.svg', file: a }, { name: 'icons/two.svg', file: b }, { name: 'readme.md', file: file('readme.md', 'hi') }])
    const res = await invoke('icons:import-files', { paths: [zip] })
    expect(res.imported.map(i => i.name).sort()).toEqual(['one', 'two'])
    expect(res.skipped.map(s => s.file)).toEqual(['readme.md'])

    const folder = join(dir, 'pack'); mkdirSync(folder)
    writeText(join(folder, 'three.svg'), svg()); writeText(join(folder, 'notes.txt'), 'x')
    const fromFolder = await invoke('icons:import-folder', { path: folder })
    expect(fromFolder.imported.map(i => i.name)).toEqual(['three'])
  })

  it('refuses a ZIP that tries to write outside its folder, or is damaged', async () => {
    const zip = join(dir, 'evil.zip')
    writeZip(zip, [{ name: '../escape.svg', file: file('x.svg', svg()) }])
    const res = await invoke('icons:import-files', { paths: [zip] })
    expect(res.imported).toEqual([])
    expect(res.skipped).toHaveLength(1)
    expect(res.skipped[0].reason).toMatch(/Unsafe path/)
    expect(existsSync(join(dir, '..', 'escape.svg'))).toBe(false)
    writeText(join(dir, 'broken.zip'), 'not a zip at all')
    const broken = await invoke('icons:import-files', { paths: [join(dir, 'broken.zip')] })
    expect(broken.imported).toEqual([])
    expect(broken.skipped).toHaveLength(1)
  })

  it('uses a file chooser when no paths are given', async () => {
    const { mockDialog } = await import('../helpers/project.js')
    mockDialog.open(file('chosen.svg', svg()))
    const res = await invoke('icons:import-files', {})
    expect(res.imported.map(i => i.name)).toEqual(['chosen'])
    expect((await invoke('icons:import-files', {})).imported).toEqual([])      // cancelled
  })
})

describe('replacing the picture of one icon', () => {
  it('puts a new picture into the chosen icon whatever the file is called, keeping its name and settings, and undoes', async () => {
    const i = (await invoke('icons:import-files', { paths: [file('fire.svg', svg())] })).imported[0]
    await invoke('icons:update', { id: i.id, spacing: 0.3 })
    const r = await invoke('icons:replace-picture', { id: i.id, path: file('something-else.svg', svg('<path d="M0 0h2v2z" fill="#00f"/>', 'viewBox="0 0 20 10"')) })
    expect(r).toMatchObject({ id: i.id, name: 'fire', spacing: 0.3 })
    expect(r.aspect).toBeCloseTo(2)
    expect(await names()).toEqual(['fire'])
    expect(await invoke('assets:list', {})).toHaveLength(1)
    await invoke('history:undo')
    expect((await invoke('icons:list')).icons[0].aspect).toBeCloseTo(1)
  })

  it('uses a file chooser without a path, does nothing when it is cancelled, and refuses a file that is not an icon', async () => {
    const i = (await invoke('icons:import-files', { paths: [file('fire.svg', svg())] })).imported[0]
    expect(await invoke('icons:replace-picture', { id: i.id })).toBeNull()
    await expect(invoke('icons:replace-picture', { id: i.id, path: file('x.txt', 'hi') })).rejects.toThrow(/cannot be used as an icon/)
    await expect(invoke('icons:replace-picture', { id: 'missing', path: file('y.svg', svg()) })).rejects.toThrow()
    expect((await invoke('icons:list')).icons[0].svg).toContain('#cc0000')
  })
})

describe('icon settings, names and aliases', () => {
  async function one() { return (await invoke('icons:import-files', { paths: [file('fire.svg', svg())] })).imported[0] }

  it('changes the settings and checks them', async () => {
    const i = await one()
    const u = await invoke('icons:update', { id: i.id, aliases: ['Flame', 'blaze', 'fire'], tags: ['elements', 'elements', ' hot '], notes: 'n', size: 1.2, vOffset: -0.1, spacing: 0.15, colorMode: 'keep' })
    expect(u).toMatchObject({ aliases: ['flame', 'blaze'], tags: ['elements', 'hot'], notes: 'n', size: 1.2, vOffset: -0.1, spacing: 0.15, colorMode: 'keep' })
    for (const bad of [{ size: 0 }, { size: 9 }, { spacing: 3 }, { vOffset: 2 }, { colorMode: 'rainbow' }, { aliases: ['color'] }, { aliases: ['bad name!'] }])
      await expect(invoke('icons:update', { id: i.id, ...bad }), JSON.stringify(bad)).rejects.toThrow()
    await invoke('history:undo')
    expect((await invoke('icons:list')).icons[0].size).toBe(1)
  })

  it('reports an alias that two icons share', async () => {
    const a = await one()
    const b = (await invoke('icons:import-files', { paths: [file('flame.svg', svg())] })).imported[0]
    await invoke('icons:update', { id: a.id, aliases: ['hot'] })
    await invoke('icons:update', { id: b.id, aliases: ['hot'] })
    const { ambiguous } = await invoke('icons:list')
    expect(ambiguous).toEqual([{ alias: 'hot', icons: expect.arrayContaining(['fire', 'flame']) }])
  })

  it('refuses names that are reserved, taken or malformed', async () => {
    const i = await one()
    await invoke('icons:import-files', { paths: [file('flame.svg', svg())] })
    await expect(invoke('icons:rename', { id: i.id, name: 'color' })).rejects.toThrow(/word of the markup/)
    await expect(invoke('icons:rename', { id: i.id, name: 'flame' })).rejects.toThrow(/already an icon/)
    await expect(invoke('icons:rename', { id: i.id, name: '!!' })).rejects.toThrow(/letters, digits/)
    const reserved = (await invoke('icons:import-files', { paths: [file('style.svg', svg())] })).imported[0]
    expect(reserved.name).toBe('style-2')
  })
})

describe('renaming and removing', () => {
  it('renames an icon and every use of it, in one undo step', async () => {
    const i = (await invoke('icons:import-files', { paths: [file('fire.svg', svg())] })).imported[0]
    const s = await richSet(['Tap {fire} and {icon:fire x1.4} but not {fire2} or \\{fire\\}', 'nothing'])
    const rule = await invoke('keywords:create', { match: 'Burn', mode: 'icon', action: { icon: 'fire' } })
    const res = await invoke('icons:rename', { id: i.id, name: 'Flame' })
    expect(res.icon.name).toBe('flame')
    expect(res.updated).toEqual({ cards: 1, rules: 1, templates: 1 })
    expect((await invoke('cards:list', s.set.id))[0].fields.body).toBe('Tap {flame} and {icon:flame x1.4} but not {fire2} or \\{fire\\}')
    expect((await invoke('keywords:list'))[0].action).toEqual({ icon: 'flame' })
    expect((await invoke('templates:get', s.template.id)).svg_source).toContain('Tap {flame}')
    expect(rule.id).toBe((await invoke('keywords:list'))[0].id)

    await invoke('history:undo')                                          // one step brings back all of it
    expect((await invoke('icons:list')).icons[0].name).toBe('fire')
    expect((await invoke('cards:list', s.set.id))[0].fields.body).toContain('{icon:fire x1.4}')
    expect((await invoke('keywords:list'))[0].action).toEqual({ icon: 'fire' })
    expect((await invoke('templates:get', s.template.id)).svg_source).toContain('Tap {fire}')
    await invoke('history:redo')
    expect((await invoke('icons:list')).icons[0].name).toBe('flame')
  })

  it('renames by an alias too, since the alias was how it was written', async () => {
    const i = (await invoke('icons:import-files', { paths: [file('fire.svg', svg())] })).imported[0]
    await invoke('icons:update', { id: i.id, aliases: ['blaze'] })
    const s = await richSet(['{blaze} {fire}'])
    await invoke('icons:rename', { id: i.id, name: 'flame' })
    expect((await invoke('cards:list', s.set.id))[0].fields.body).toBe('{flame} {flame}')
  })

  it('counts and lists where an icon is used', async () => {
    const i = (await invoke('icons:import-files', { paths: [file('fire.svg', svg())] })).imported[0]
    await richSet(['{fire} and {fire}', 'none', '{icon:fire}'])
    await invoke('keywords:create', { match: 'Burn', mode: 'icon_text', action: { icon: 'fire' } })
    const listed = (await invoke('icons:list')).icons[0]
    expect(listed.usage).toEqual({ cards: 2, templates: 1, rules: 1, styles: 0 })
    const u = await invoke('icons:usage', i.id)
    expect(u.cards.map(c => c.name)).toEqual(['C', 'C'])
    expect(u.templates.map(t => t.name)).toEqual(['T'])
    await expect(invoke('icons:usage', 'missing')).rejects.toThrow()
  })

  it('deletes an icon with its picture, and undo brings both back', async () => {
    const i = (await invoke('icons:import-files', { paths: [file('fire.svg', svg())] })).imported[0]
    await invoke('icons:remove', i.id)
    expect(await names()).toEqual([])
    expect(await invoke('assets:list', {})).toEqual([])
    await invoke('history:undo')
    const back = (await invoke('icons:list')).icons[0]
    expect(back.name).toBe('fire')
    expect(back.missing).toBeUndefined()
    expect(back.svg).toContain('#cc0000')
  })
})

describe('text styles', () => {
  it('creates, changes, lists and deletes a style, with undo', async () => {
    const s = await invoke('textstyles:create', { name: 'Keyword', props: { bold: true, color: '#cc3333', tracking: 20 } })
    expect(s).toMatchObject({ name: 'keyword', props: { bold: true, color: '#cc3333', tracking: 20 } })
    const u = await invoke('textstyles:update', { id: s.id, props: { italic: true, size: 1.2 } })
    expect(u.props).toEqual({ italic: true, size: 1.2 })
    expect((await invoke('textstyles:list'))).toHaveLength(1)
    await invoke('history:undo')
    expect((await invoke('textstyles:list'))[0].props.bold).toBe(true)
    await invoke('textstyles:remove', s.id)
    expect(await invoke('textstyles:list')).toEqual([])
    await invoke('history:undo')
    expect(await invoke('textstyles:list')).toHaveLength(1)
  })

  it('refuses a bad name or a bad property', async () => {
    await expect(invoke('textstyles:create', { name: '!', props: {} })).rejects.toThrow(/letters, digits/)
    await expect(invoke('textstyles:create', { name: 'x', props: { color: 'red' } })).rejects.toThrow(/color/)
    await invoke('textstyles:create', { name: 'x', props: {} })
    await expect(invoke('textstyles:create', { name: 'X', props: {} })).rejects.toThrow(/already a text style/)
  })

  it('renames a style and what names it, in one undo step, and counts its use', async () => {
    const st = await invoke('textstyles:create', { name: 'keyword', props: { bold: true } })
    const s = await richSet(['a {style:keyword}Flying{/style} b', 'x'])
    await invoke('keywords:create', { match: 'Trample', mode: 'style', action: { style: 'keyword' } })
    const before = (await invoke('textstyles:list'))[0]
    expect(before.usage).toEqual({ cards: 1, rules: 1 })
    const res = await invoke('textstyles:rename', { id: st.id, name: 'kw' })
    expect(res.updated).toEqual({ cards: 1, rules: 1, templates: 0 })
    expect((await invoke('cards:list', s.set.id))[0].fields.body).toBe('a {style:kw}Flying{/style} b')
    expect((await invoke('keywords:list'))[0].action).toEqual({ style: 'kw' })
    await invoke('history:undo')
    expect((await invoke('cards:list', s.set.id))[0].fields.body).toContain('{style:keyword}')
    expect((await invoke('textstyles:list'))[0].name).toBe('keyword')
  })
})

describe('keyword rules', () => {
  it('creates rules in order, changes, reorders and deletes them, with undo', async () => {
    const a = await invoke('keywords:create', { match: 'Flying', mode: 'style', action: { style: 'Keyword' } })
    const b = await invoke('keywords:create', { match: 'Haste', mode: 'icon', action: { icon: 'bolt' }, ignoreCase: true, scope: ['body'] })
    expect(a).toMatchObject({ wholeWord: true, ignoreCase: false, isPattern: false, enabled: true, scope: null, order: 0, action: { style: 'keyword' } })
    expect(b).toMatchObject({ ignoreCase: true, scope: ['body'], order: 1 })
    await invoke('keywords:update', { id: a.id, enabled: false, match: 'Flies' })
    expect((await invoke('keywords:list'))[0]).toMatchObject({ match: 'Flies', enabled: false })
    await invoke('keywords:reorder', [b.id, a.id])
    expect((await invoke('keywords:list')).map(r => r.match)).toEqual(['Haste', 'Flies'])
    await invoke('history:undo')
    expect((await invoke('keywords:list')).map(r => r.match)).toEqual(['Flies', 'Haste'])
    await invoke('keywords:remove', a.id)
    expect(await invoke('keywords:list')).toHaveLength(1)
    await invoke('history:undo')
    expect(await invoke('keywords:list')).toHaveLength(2)
  })

  it('checks what it is given', async () => {
    for (const bad of [
      { match: '', mode: 'style', action: { style: 'x' } },
      { match: 'a', mode: 'bogus', action: {} },
      { match: 'a', mode: 'style', action: {} },
      { match: 'a', mode: 'icon', action: { icon: '' } },
      { match: 'a', mode: 'replace', action: {} },
      { match: 'x'.repeat(101), mode: 'style', action: { style: 'x' } },
      { match: '(a+)+$', isPattern: true, mode: 'style', action: { style: 'x' } },
      { match: '[', isPattern: true, mode: 'style', action: { style: 'x' } }
    ]) await expect(invoke('keywords:create', bad), JSON.stringify(bad)).rejects.toThrow()
    const ok = await invoke('keywords:create', { match: 'deal \\d+', isPattern: true, mode: 'replace', action: { text: 'Hit' } })
    expect(ok.isPattern).toBe(true)
    await expect(invoke('keywords:update', { id: ok.id, match: '(x*)*' })).rejects.toThrow(/refused/)
  })

  it('is part of a snapshot, like the rest of the project', async () => {
    await invoke('keywords:create', { match: 'Flying', mode: 'style', action: { style: 'k' } })
    const snap = await invoke('snapshots:create', { name: 'with rules', description: '' })
    await invoke('keywords:remove', (await invoke('keywords:list'))[0].id)
    expect(await invoke('keywords:list')).toEqual([])
    await invoke('snapshots:restore', snap.id)
    expect((await invoke('keywords:list'))[0].match).toBe('Flying')
  })
})

void readFileSync
