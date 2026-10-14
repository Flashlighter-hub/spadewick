/**
 * Manufacturer presets (PRD §18): listing, the person's own presets (duplicate, edit, import, export, remove), applying one to the
 * export settings, per-card images at the preset's pixel size, and the preset's rules in the preflight.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import sharp from 'sharp'
import { createTestProject, seedSet, invoke } from '../helpers/project.js'

let proj, out
beforeEach(async () => { proj = await createTestProject('Pre'); out = mkdtempSync(join(tmpdir(), 'presets-')) })
afterEach(async () => { await proj.cleanup() })

const SOLID = fill => `<svg xmlns="http://www.w3.org/2000/svg" width="250" height="350" viewBox="0 0 250 350"><rect width="250" height="350" fill="${fill}"/></svg>`
async function seed(count = 2, cardSize = 'poker') {
  const s = await seedSet({ name: 'Deck', cardSize, fields: [{ name: 'Name', type: 'text' }], template: { svg: SOLID('#cc3333') }, cards: Array.from({ length: count }, (_, i) => ({ name: `Card ${i + 1}`, fields: { name: `C${i}` } })) })
  await invoke('sets:update', { id: s.set.id, defaultTemplateId: s.template.id })
  return s
}
const ids = res => res.presets.map(p => p.id)

describe('the list', () => {
  it('has the nine shipped presets, read only, with their age', async () => {
    const res = await invoke('presets:list')
    expect(res.presets).toHaveLength(9)
    expect(res.presets.every(p => p.shipped === true && p.proofTested === false)).toBe(true)
    expect(res.presets[0]).toMatchObject({ id: 'tgc-poker', stale: false })
    expect(res.presets[0].ageDays).toBeGreaterThanOrEqual(0)
    expect(res.problems).toEqual([])
  })

  it('can be limited to the presets that apply to one kind of output', async () => {
    expect(ids(await invoke('presets:list', { kind: 'images' }))).toEqual(['tgc-poker', 'mpc-poker', 'dtc-poker', 'generic-print-us'])
    expect(ids(await invoke('presets:list', { kind: 'pdf' }))).toEqual(['dtc-poker', 'printninja', 'panda-cards', 'longpack-cards', 'wingo-cards', 'generic-offset-metric', 'generic-print-us'])
  })
})

describe('the person\'s own presets', () => {
  it('duplicates, edits, and removes; a shipped preset stays read only', async () => {
    const copy = await invoke('presets:duplicate', { id: 'generic-offset-metric', name: 'My printer' })
    expect(copy).toMatchObject({ id: 'my-printer', name: 'My printer', shipped: false, basedOn: 'generic-offset-metric', proofTested: false })
    expect(existsSync(join(proj.root, 'library', 'presets', 'my-printer.json'))).toBe(true)
    expect(ids(await invoke('presets:list'))).toContain('my-printer')
    const saved = await invoke('presets:save', { ...copy, bleedMm: 4, deck: { multiple: 9 } })
    expect(saved).toMatchObject({ bleedMm: 4, deck: { multiple: 9 } })
    expect((await invoke('presets:get', 'my-printer')).bleedMm).toBe(4)
    await expect(invoke('presets:save', { ...copy, bleedMm: 99 })).rejects.toThrow(/not valid: bleedMm/)
    await expect(invoke('presets:save', { ...(await invoke('presets:get', 'tgc-poker')), bleedMm: 1 })).rejects.toThrow(/ships with Spadewick/)
    await expect(invoke('presets:remove', 'tgc-poker')).rejects.toThrow(/ships with Spadewick/)
    await invoke('presets:remove', 'my-printer')
    expect(ids(await invoke('presets:list'))).not.toContain('my-printer')
    expect((await invoke('presets:duplicate', { id: 'generic-offset-metric', name: 'My printer' })).id).toBe('my-printer')
    expect((await invoke('presets:duplicate', { id: 'generic-offset-metric', name: 'My printer' })).id).toBe('my-printer-2')   // never overwrites
    expect((await invoke('presets:duplicate', { id: 'tgc-poker' })).name).toBe('Copy of The Game Crafter, poker')
  })

  it('exports to a file and imports it again, with a new id when its own is taken and never "tested"', async () => {
    const file = join(out, 'tgc.json')
    expect(await invoke('presets:export', { id: 'tgc-poker', path: file })).toEqual({ path: file })
    const written = JSON.parse(readFileSync(file, 'utf8'))
    expect(written.shipped).toBeUndefined()
    const a = await invoke('presets:import', { path: file })
    expect(a).toMatchObject({ id: 'tgc-poker-2', shipped: false, proofTested: false })
    const b = await invoke('presets:import', { path: file })
    expect(b.id).toBe('tgc-poker-3')
    writeFileSync(file, JSON.stringify({ ...written, proofTested: true }))
    expect((await invoke('presets:import', { path: file })).proofTested).toBe(false)                    // a proof is never claimed for someone else
  })

  it('refuses a file that is not a preset, and skips a broken one in the folder', async () => {
    const bad = join(out, 'bad.json')
    writeFileSync(bad, 'not json')
    await expect(invoke('presets:import', { path: bad })).rejects.toThrow(/cannot be read as a preset/)
    writeFileSync(bad, JSON.stringify({ format: 1, id: 'x' }))
    await expect(invoke('presets:import', { path: bad })).rejects.toThrow(/not valid/)
    await invoke('presets:list')                                                                             // makes the folder
    const dir = join(proj.root, 'library', 'presets')
    writeFileSync(join(dir, 'broken.json'), '{ nope')
    writeFileSync(join(dir, 'clash.json'), JSON.stringify({ ...JSON.parse(readFileSync(join(out, 'bad.json'), 'utf8')) }))
    const res = await invoke('presets:list')
    expect(res.problems.map(p => p.file).sort()).toEqual(['broken.json', 'clash.json'])
    expect(res.presets).toHaveLength(9)
  })
})

describe('applying a preset', () => {
  it('turns it into the settings of the export', async () => {
    const s = await seed()
    const a = await invoke('presets:apply', { id: 'tgc-poker', setId: s.set.id })
    expect(a.options).toMatchObject({ presetId: 'tgc-poker', standard: 'plain', colour: 'cmyk', bleedMm: 3.175, safeMm: 3.175, dpi: 300, dieLine: 'none' })
    expect(a.image).toMatchObject({ format: 'png', pixels: { width: 825, height: 1125 } })
    expect(a.notes).toMatchObject({ sizeOk: true, verify: ['colour'], proofTested: false, manufacturer: 'The Game Crafter' })
    const rgb = await invoke('presets:apply', { id: 'mpc-poker', setId: s.set.id })
    expect(rgb.options.colour).toBe('rgb')
    const generic = await invoke('presets:apply', { id: 'generic-offset-metric', setId: s.set.id })
    expect(generic.options).toMatchObject({ standard: 'x4', dieLine: 'spot', dieSpotName: 'DieCut', inkLimit: 300, backLayout: 'separate' })
  })

  it('says when the card size is not one the manufacturer offers', async () => {
    const tarot = await seed(1, 'tarot')
    expect((await invoke('presets:apply', { id: 'tgc-poker', setId: tarot.set.id })).notes).toMatchObject({ sizeOk: false, sizes: ['poker'], size: 'tarot' })
    expect((await invoke('presets:apply', { id: 'printninja', setId: tarot.set.id })).notes.sizeOk).toBe(true)         // any size
  })

  it('finds the profile a preset expects among the imported ones, or says it must be imported; and lists what needs vector output', async () => {
    const s = await seed()
    const panda = await invoke('presets:apply', { id: 'panda-cards', setId: s.set.id })
    expect(panda.notes.profile).toEqual({ hint: 'U.S. Sheetfed Uncoated v2', found: false })
    expect(panda.options.profileId).toBeUndefined()
    expect(panda.notes.needsVector).toEqual(['pureBlackText', 'overprintBlack'])
    expect((await invoke('presets:apply', { id: 'longpack-cards', setId: s.set.id })).notes.needsVector).toEqual(['richBlack'])
    const mine = await invoke('presets:duplicate', { id: 'panda-cards', name: 'Panda here' })
    await invoke('presets:save', { ...mine, profileHint: 'CGATS21' })
    const src = join(out, 'p.icc'); writeFileSync(src, readFileSync(join(process.cwd(), 'resources/profiles/CGATS21_CRPC1.icc')))
    const imported = await invoke('profiles:import', { paths: [src] })
    const found = await invoke('presets:apply', { id: 'panda-here', setId: s.set.id })
    expect(found.notes.profile.found).toBe(true)
    expect(found.options.profileId).toBe(imported.imported[0].id)
  })

  it('a preset drives the production export end to end', async () => {
    const s = await seed()
    const a = await invoke('presets:apply', { id: 'generic-print-us', setId: s.set.id })
    const r = await invoke('production:run', { setIds: [s.set.id], outputDir: out, ...a.options, dpi: 100, cardBack: 'none' })
    const { PDFDocument } = await import('pdf-lib')
    const doc = await PDFDocument.load(readFileSync(join(out, r.files[0])))
    const page = doc.getPages()[0]
    expect(page.getWidth() / (72 / 25.4)).toBeCloseTo(63.5 + 2 * 3.175, 1)
    expect(page.getHeight() / (72 / 25.4)).toBeCloseTo(88.9 + 2 * 3.175, 1)
  })
})

describe('per-card images', () => {
  const imageRun = async (s, preset, extra = {}) => {
    const a = await invoke('presets:apply', { id: preset, setId: s.set.id })
    return invoke('production:run-images', { setIds: [s.set.id], outputDir: out, ...a.options, imageFormat: a.image.format, cardBack: 'color', cardBackColor: '#223355', ...extra })
  }

  it('writes every card at the pixel size of the preset, with the card IDs as names and one shared back', async () => {
    const s = await seed(3)
    const r = await imageRun(s, 'tgc-poker')
    expect(r).toMatchObject({ cardCount: 3, pixels: { width: 825, height: 1125 }, format: 'png', backWritten: true })
    const names = readdirSync(out).sort()
    expect(names).toHaveLength(4)
    expect(names.filter(n => /_back\.png$/.test(n))).toHaveLength(1)
    for (const n of names) { const m = await sharp(join(out, n)).metadata(); expect([m.width, m.height, m.density]).toEqual([825, 1125, 300]) }
    expect(names.filter(n => !/_back/.test(n)).every(n => /^[A-Za-z0-9_-]+\.png$/.test(n))).toBe(true)
  })

  it('uses the preset\'s own pixel size for MakePlayingCards and a JPEG when asked', async () => {
    const s = await seed(1)
    const r = await imageRun(s, 'mpc-poker', { imageFormat: 'jpeg', jpegQuality: 85, cardBack: 'none' })
    expect(r.pixels).toEqual({ width: 822, height: 1122 })
    expect(r.backWritten).toBe(false)
    const files = readdirSync(out)
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(/\.jpg$/)
    expect((await sharp(join(out, files[0])).metadata()).format).toBe('jpeg')
  })

  it('carries the bleed: the edge of a red card runs to the edge of the picture, and a card back is covered to the trim and bled', async () => {
    const s = await seed(1)
    await imageRun(s, 'tgc-poker')
    const front = readdirSync(out).find(n => !/_back/.test(n))
    const { data, info } = await sharp(join(out, front)).raw().toBuffer({ resolveWithObject: true })
    expect([...data.subarray(0, 3)]).toEqual([0xcc, 0x33, 0x33])                                           // the bleed corner
    expect([...data.subarray((50 * info.width + 50) * 3, (50 * info.width + 50) * 3 + 3)]).toEqual([0xcc, 0x33, 0x33])
    const back = readdirSync(out).find(n => /_back/.test(n))
    const b = await sharp(join(out, back)).raw().toBuffer()
    expect([...b.subarray(0, 3)]).toEqual([0x22, 0x33, 0x55])
  })

  it('names files by the pattern given, never overwrites two cards with one name, and cleans up when it is cancelled', async () => {
    const s = await seed(2)
    const r = await imageRun(s, 'tgc-poker', { fileNameTemplate: 'same' })
    const fronts = r.files.filter(f => !/_back/.test(f))
    expect(new Set(fronts).size).toBe(2)
    for (const f of readdirSync(out)) writeFileSync(join(out, f), '')
    const big = await seed(30)
    const done = imageRun(big, 'generic-print-us', { outputDir: mkdtempSync(join(tmpdir(), 'cancel-')), dpi: 150 }).then(() => 'finished', e => e.message)
    for (let i = 0; i < 200; i++) { if ((await invoke('production:status')).running) break; await new Promise(r => setTimeout(r, 5)) }
    expect(await invoke('production:cancel')).toBe(true)
    expect(await done).toMatch(/cancelled/)
  })

  it('refuses an empty selection and an invalid setting', async () => {
    const s = await seed(1)
    await expect(invoke('production:run-images', { setIds: [], outputDir: out })).rejects.toThrow()
    await expect(invoke('production:run-images', { setIds: [s.set.id], outputDir: out, dpi: 5 })).rejects.toThrow(/dpi/)
  })
})

describe('the preset in the preflight', () => {
  const check = (s, preset, extra = {}) => invoke('preflight:run', { setIds: [s.set.id], cardBack: 'color', preset, ...extra })
  const find = (res, type) => res.groups.find(g => g.type === type)

  it('a deck that breaks the manufacturer\'s multiple is a warning that says what would fix it', async () => {
    const s = await seed(10)
    const g = find(await check(s, { name: 'Printer', deck: { multiple: 9 } }), 'deckSize')
    expect(g).toMatchObject({ severity: 'warning', detail: { problem: 'multiple', count: 10, multiple: 9, add: 8, remove: 1 } })
    expect(find(await check(s, { name: 'Printer', deck: { multiple: 5 } }), 'deckSize')).toBeUndefined()
    expect(find(await check(s, { name: 'Printer', deck: { min: 12 } }), 'deckSize').detail).toMatchObject({ problem: 'min', add: 2 })
    expect(find(await check(s, { name: 'Printer', deck: { max: 8 } }), 'deckSize').detail).toMatchObject({ problem: 'max', remove: 2 })
  })

  it('counts every copy when "repeat copies" is on', async () => {
    const s = await seed(3)
    await invoke('cards:update', { id: s.cards[0].id, quantity: 7 })
    expect(find(await check(s, { name: 'P', deck: { multiple: 9 } }), 'deckSize')).toBeDefined()                   // 3 cards
    expect(find(await check(s, { name: 'P', deck: { multiple: 9 } }, { repeatCopies: true }), 'deckSize')).toBeUndefined()   // 7 + 1 + 1 = 9
  })

  it('notes a card size the manufacturer does not offer, a profile to import, unconfirmed values and vector-only rules', async () => {
    const s = await seed(1)
    const res = await check(s, { name: 'Panda', sizeOk: false, sizes: ['poker'], size: 'tarot', profile: { hint: 'U.S. Sheetfed Uncoated v2', found: false }, verify: ['die', 'deck'], needsVector: ['pureBlackText'] })
    expect(find(res, 'presetSize')).toMatchObject({ severity: 'warning', detail: { sizes: ['poker'], size: 'tarot' } })
    expect(find(res, 'presetProfile')).toMatchObject({ severity: 'warning', detail: { hint: 'U.S. Sheetfed Uncoated v2' } })
    expect(find(res, 'presetUnverified')).toMatchObject({ severity: 'info', detail: { fields: ['die', 'deck'] } })
    expect(find(res, 'presetVector')).toMatchObject({ severity: 'info', detail: { rules: ['pureBlackText'] } })
    const clean = await check(s, { name: 'Fine', sizeOk: true, profile: { hint: 'x', found: true }, verify: [], needsVector: [] })
    expect(clean.groups.filter(g => g.type.startsWith('preset'))).toEqual([])
  })

  it('applies the minimums of a preset to the checks', async () => {
    const s = await seedSet({ name: 'S', cardSize: 'poker', fields: [], template: { svg: '<svg xmlns="http://www.w3.org/2000/svg" width="250" height="350" viewBox="0 0 250 350"><rect width="250" height="350" fill="#f4ebd0"/><text data-spadewick-id="t" x="40" y="60" font-size="10" fill="#222">hello</text></svg>' }, cards: [{ name: 'A', fields: {} }] })
    await invoke('sets:update', { id: s.set.id, defaultTemplateId: s.template.id })
    expect(find(await check(s, null), 'textSmall')).toBeUndefined()                       // 7.2 pt is over 6 pt
    expect(find(await check(s, null, { minimums: { textPt: 9 } }), 'textSmall')).toMatchObject({ detail: { pt: 7.2, min: 9 } })
  })
})
