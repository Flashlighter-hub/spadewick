/**
 * The component library (PRD §7.10): components kept with the template library, shared by every project.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'fs'
import sharp from 'sharp'
import { createTestProject, invoke, mockDialog, makePng } from '../helpers/project.js'

let ctx
beforeEach(async () => { ctx = await createTestProject() })
afterEach(async () => { mockDialog.reset(); await ctx.cleanup() })

const NS = 'xmlns="http://www.w3.org/2000/svg"'
const BADGE = {
  name: 'Cost badge', description: 'A round cost badge',
  bounds: { x: 0, y: 0, w: 60, h: 60 }, refWidth: 500,
  xml: [`<circle ${NS} data-spadewick-id="badge" cx="30" cy="30" r="30" fill="#cc0000" stroke="#ffffff"/>`, `<text ${NS} data-spadewick-id="cost" x="30" y="40" text-anchor="middle" fill="#ffffff" font-size="28">{{cost}}</text>`],
  defs: []
}
const mine = async () => (await invoke('components:list')).filter(c => !c.builtIn)           // the built-in ones are always there
const libraryDir = () => join(ctx.root, 'library', 'components')

describe('saving and reading', () => {
  it('keeps a component in the library folder, and lists it with a picture', async () => {
    const saved = await invoke('components:save', BADGE)
    expect(saved.version).toBe(1)
    expect(existsSync(join(libraryDir(), `${saved.id}.json`))).toBe(true)
    const [item] = await mine()
    expect(item).toMatchObject({ id: saved.id, name: 'Cost badge', description: 'A round cost badge', version: 1, fields: ['cost'], parts: 2 })
    const meta = await sharp(Buffer.from(item.thumbnail, 'base64')).metadata()
    expect(meta).toMatchObject({ format: 'png', width: 180 })
    const full = await invoke('components:get', saved.id)
    expect(full).toMatchObject({ id: saved.id, name: 'Cost badge', refWidth: 500, bounds: { x: 0, y: 0, w: 60, h: 60 } })
    expect(full.xml).toHaveLength(2)
  })

  it('is there for every project: the library is not part of one', async () => {
    const saved = await invoke('components:save', BADGE)
    await invoke('projects:close')
    await invoke('projects:create', { name: 'Another', parentDir: ctx.root })
    expect((await mine()).map(c => c.id)).toEqual([saved.id])
  })

  it('saving again with the id is a new version of the same component', async () => {
    const first = await invoke('components:save', BADGE)
    const second = await invoke('components:save', { ...BADGE, id: first.id, xml: [BADGE.xml[0]], description: 'Smaller' })
    expect(second).toEqual({ id: first.id, version: 2 })
    expect((await mine()).map(c => [c.version, c.parts, c.description])).toEqual([[2, 1, 'Smaller']])
    await expect(invoke('components:save', { ...BADGE, id: '22222222-2222-2222-2222-222222222222' })).rejects.toThrow(/not in the library/)
  })

  it('renames, and deletes; deleting what is not there is not an error', async () => {
    const { id } = await invoke('components:save', BADGE)
    await invoke('components:rename', { id, name: 'Mana badge', description: 'x' })
    expect((await mine())[0]).toMatchObject({ name: 'Mana badge', description: 'x', version: 1 })
    await expect(invoke('components:rename', { id, name: '  ' })).rejects.toThrow(/name/i)
    await invoke('components:delete', id)
    expect(await mine()).toEqual([])
    await invoke('components:delete', id)
    await invoke('components:delete', '../../etc')
    expect(await invoke('components:get', id)).toBeNull()
    expect(await invoke('components:get', '../x')).toBeNull()
  })

  it('sorts by name and leaves out a file that is not a component', async () => {
    await invoke('components:save', { ...BADGE, name: 'Zed' })
    await invoke('components:save', { ...BADGE, name: 'Alpha' })
    writeFileSync(join(libraryDir(), '33333333-3333-3333-3333-333333333333.json'), '{ not json')
    writeFileSync(join(libraryDir(), 'notes.txt'), 'hello')
    expect((await mine()).map(c => c.name)).toEqual(['Alpha', 'Zed'])
  })
})

describe('what a component may hold', () => {
  it('refuses what cannot be one: no name, no parts, no box, too many parts', async () => {
    await expect(invoke('components:save', { ...BADGE, name: '' })).rejects.toThrow(/name/i)
    await expect(invoke('components:save', { ...BADGE, xml: [] })).rejects.toThrow(/not a component/)
    await expect(invoke('components:save', { ...BADGE, bounds: { x: 0, y: 0, w: 0, h: 10 } })).rejects.toThrow(/not a component/)
    await expect(invoke('components:save', { ...BADGE, bounds: null })).rejects.toThrow(/not a component/)
    await expect(invoke('components:save', { ...BADGE, xml: Array.from({ length: 401 }, () => BADGE.xml[0]) })).rejects.toThrow(/not a component/)
    await expect(invoke('components:save', { ...BADGE, xml: [42] })).rejects.toThrow(/not a component/)
  })

  it('takes scripts, event handlers and references to the outside out of it', async () => {
    const { id } = await invoke('components:save', {
      ...BADGE,
      xml: [`<g ${NS}><script>alert(1)</script><rect data-spadewick-id="r" width="5" height="5" onclick="evil()" fill="url(https://evil.example/x.svg#a)"/><image href="https://evil.example/p.png" width="5" height="5"/></g>`]
    })
    const c = await invoke('components:get', id)
    expect(c.xml[0]).not.toMatch(/script|onclick|evil\.example/)
  })

  it('puts the project\'s pictures inside as data, so the component works in any project', async () => {
    const png = await makePng(join(ctx.root, 'logo.png'), 20, 20, '#00ff00')
    const [asset] = await invoke('assets:import', [png])
    const { id } = await invoke('components:save', { ...BADGE, xml: [`<image ${NS} data-spadewick-id="logo" x="0" y="0" width="20" height="20" href="{{@asset.${asset.id}}}"/>`, `<image ${NS} data-spadewick-id="gone" x="0" y="0" width="20" height="20" href="{{@asset.nope}}"/>`] })
    const c = await invoke('components:get', id)
    expect(c.xml[0]).toMatch(/href="data:image\/png;base64,[A-Za-z0-9+/=]+"/)
    expect(c.xml[0]).not.toContain('@asset')
    expect(c.xml[1]).toContain('href=""')                                            // a picture that is gone is not a broken reference
    expect(c.fields).toEqual([])
  })

  it('names the fields it shows or binds', async () => {
    const { id } = await invoke('components:save', { ...BADGE, xml: [`<text ${NS} data-spadewick-id="a" data-spadewick-field="rules" width="100" height="50">{{rules}} {{ cost }}</text>`, `<text ${NS}>{{@card.id}} {{@asset.x}}</text>`] })
    expect((await invoke('components:get', id)).fields).toEqual(['cost', 'rules'])
  })
})

describe('sharing a component as a file', () => {
  it('exports to a file and imports it as a component of its own, never replacing one that is there', async () => {
    const { id } = await invoke('components:save', BADGE)
    const file = join(ctx.root, 'badge.spadecomponent.json')
    mockDialog.save(file)
    expect(await invoke('components:export', { id })).toEqual({ canceled: false, path: file })
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ format: 1, id, name: 'Cost badge' })
    mockDialog.open(file)
    const back = await invoke('components:import')
    expect(back).toMatchObject({ canceled: false, name: 'Cost badge' })
    const items = await mine()
    expect(items).toHaveLength(2)                                                  // the import is a second component
    expect(new Set(items.map(i => i.id)).size).toBe(2)
    expect(readdirSync(libraryDir()).filter(f => f.endsWith('.json'))).toHaveLength(2)
  })

  it('refuses a file that is not a component', async () => {
    const bad = join(ctx.root, 'bad.json')
    writeFileSync(bad, JSON.stringify({ hello: 'world' }))
    mockDialog.open(bad)
    await expect(invoke('components:import')).rejects.toThrow(/not a component/)
    writeFileSync(bad, 'nonsense')
    mockDialog.open(bad)
    await expect(invoke('components:import')).rejects.toThrow(/not a component/)
    expect(await mine()).toEqual([])
  })

  it('cancelling does nothing', async () => {
    const { id } = await invoke('components:save', BADGE)
    mockDialog.save(null)
    expect(await invoke('components:export', { id })).toEqual({ canceled: true })
    mockDialog.open()
    expect(await invoke('components:import')).toEqual({ canceled: true })
  })
})

describe('the built-in components', () => {
  it('are listed from the first start, three of each kind, with a picture, and are for every project', async () => {
    const all = await invoke('components:list')
    const builtIn = all.filter(c => c.builtIn)
    expect(builtIn).toHaveLength(42)                                    // twelve digit slots, banners and text blocks, and thirty icons
    expect(builtIn.filter(c => !/ icon$/.test(c.name)).map(c => c.name).sort()).toEqual([
      'Dark text panel', 'Framed text block', 'Parchment text block', 'Plate name banner', 'Ribbon name banner', 'Round gem digit', 'Round glow digit',
      'Round ring digit', 'Scroll name banner', 'Square cut-corner digit', 'Square outline digit', 'Square plate digit'
    ])
    for (const c of builtIn) expect((await sharp(Buffer.from(c.thumbnail, 'base64')).metadata()).format).toBe('png')
    expect(builtIn.find(c => c.name === 'Round gem digit').fields).toEqual(['cost'])
    expect(builtIn.find(c => c.name === 'Ribbon name banner').fields).toEqual(['name'])
    expect(builtIn.find(c => c.name === 'Dark text panel').fields).toEqual(['rules'])
    const full = await invoke('components:get', builtIn[0].id)
    expect(full).toMatchObject({ id: builtIn[0].id, version: 1 })
    expect(full.xml.length).toBeGreaterThan(0)
  })

  it('cannot be renamed or deleted; saving over one makes a component of their own', async () => {
    const gem = (await invoke('components:list')).find(c => c.name === 'Round gem digit')
    await expect(invoke('components:rename', { id: gem.id, name: 'Mine' })).rejects.toThrow(/built-in/)
    await invoke('components:delete', gem.id)
    expect(await invoke('components:get', gem.id)).toBeTruthy()
    const full = await invoke('components:get', gem.id)
    const saved = await invoke('components:save', { id: gem.id, name: 'My gem', xml: full.xml, defs: full.defs, bounds: full.bounds, refWidth: full.refWidth })
    expect(saved.id).not.toBe(gem.id)
    expect((await mine()).map(c => c.name)).toEqual(['My gem'])
    expect((await invoke('components:get', gem.id)).name).toBe('Round gem digit')
  })
})

describe('the built-in icon components', () => {
  const ICON_NAMES = [
    // fantasy
    'Sword', 'Shield', 'Potion', 'Crown', 'Skull', 'Spellbook', 'Key', 'Magic wand', 'Rune stone', 'Flame',
    // science fiction
    'Rocket', 'Planet', 'Atom', 'Robot head', 'Energy cell', 'Blaster', 'Targeting reticle', 'Cog', 'Circuit chip', 'DNA helix',
    // markers
    'Heart', 'Lightning bolt', 'Hourglass', 'Flag', 'Coin', 'Eye', 'Padlock', 'Star badge', 'Warning', 'Location pin'
  ].map(n => `${n} icon`)

  it('are thirty, ten fantasy, ten science fiction and ten markers, each with a picture and no field of its own', async () => {
    const icons = (await invoke('components:list')).filter(c => c.builtIn && / icon$/.test(c.name))
    expect(icons.map(c => c.name).sort()).toEqual([...ICON_NAMES].sort())
    const kind = c => /^(Fantasy|Science fiction|Marker):/.exec(c.description)?.[1]
    expect(icons.filter(c => kind(c) === 'Fantasy')).toHaveLength(10)
    expect(icons.filter(c => kind(c) === 'Science fiction')).toHaveLength(10)
    expect(icons.filter(c => kind(c) === 'Marker')).toHaveLength(10)
    for (const c of icons) {
      expect(c.fields, c.name).toEqual([])                              // artwork: no card data to bind
      const meta = await sharp(Buffer.from(c.thumbnail, 'base64')).metadata()
      expect(meta.format, c.name).toBe('png')
    }
  })

  it('are made of named parts that each have an id of their own, so each can be recoloured and is a layer of its own', async () => {
    for (const listed of (await invoke('components:list')).filter(c => c.builtIn && / icon$/.test(c.name))) {
      const full = await invoke('components:get', listed.id)
      expect(full.bounds).toEqual({ x: 0, y: 0, w: 64, h: 64 })
      expect(full.xml.length, full.name).toBeGreaterThanOrEqual(2)
      const ids = full.xml.map(x => /data-spadewick-id="([^"]+)"/.exec(x)?.[1])
      expect(ids.every(Boolean), full.name).toBe(true)
      expect(new Set(ids).size, `${full.name}: every part has its own name`).toBe(ids.length)
      // every gradient a part points at is defined with the icon
      const used = [...full.xml.join('').matchAll(/url\(#([\w-]+)\)/g)].map(m => m[1])
      const defined = [...full.defs.join('').matchAll(/id="([\w-]+)"/g)].map(m => m[1])
      for (const u of used) expect(defined, `${full.name} uses ${u}`).toContain(u)
    }
  })

  it('cannot be renamed or deleted: the library of built-in components is read only', async () => {
    const sword = (await invoke('components:list')).find(c => c.name === 'Sword icon')
    await expect(invoke('components:rename', { id: sword.id, name: 'Mine' })).rejects.toThrow(/built-in/)
    await invoke('components:delete', sword.id)
    expect((await invoke('components:get', sword.id)).name).toBe('Sword icon')
  })
})
