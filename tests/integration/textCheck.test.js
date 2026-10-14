/**
 * The text check (PRD §16.9): problems found by drawing every card through the text step, grouped with the cards they affect.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createTestProject, seedSet, invoke, writeText } from '../helpers/project.js'

let proj
beforeEach(async () => { proj = await createTestProject('Check') })
afterEach(async () => { await proj.cleanup() })

const CJK = '中'
const tpl = (attrs = '', font = 'Liberation Sans') => `<svg xmlns="http://www.w3.org/2000/svg" width="250" height="350" viewBox="0 0 250 350"><rect width="250" height="350" fill="#fff"/>` +
  `<text data-spadewick-id="rules" x="10" y="30" width="230" height="${attrs.includes('tiny') ? 20 : 200}" font-size="20" font-family="${font}" data-spadewick-field="body" ${attrs.replace('tiny', '')} fill="#000">{{body}}</text></svg>`

async function seed(bodies, svg = tpl(), name = 'Base') {
  const s = await seedSet({ name, cardSize: 'poker', fields: [{ name: 'Body', type: 'rich_text' }], template: { name: 'T', svg }, cards: bodies.map((b, i) => ({ name: `Card ${i + 1}`, fields: { body: b } })) })
  await invoke('sets:update', { id: s.set.id, defaultTemplateId: s.template.id })
  return s
}
const find = (res, type, pred = () => true) => res.groups.find(g => g.type === type && pred(g))

describe('what the check finds', () => {
  it('is quiet for a project with nothing wrong', async () => {
    await seed(['plain words', '**bold** and {star}'])
    const res = await invoke('textcheck:run')
    expect(res).toMatchObject({ checked: 2, groups: [], counts: { error: 0, warning: 0, info: 0 } })
  })

  it('reports a missing icon, a missing character, unmatched markup and an unknown style, each with its card', async () => {
    await seed(['fine', `a {nosuch} b`, `x${CJK}y`, '**oops', '{style:ghost}z{/style}'])
    const res = await invoke('textcheck:run')
    const icon = find(res, 'missingIcon')
    expect(icon).toMatchObject({ severity: 'error', detail: { name: 'nosuch' }, element: { id: 'rules', field: 'body' }, template: { name: 'T' } })
    expect(icon.cards.map(c => c.name)).toEqual(['Card 2'])
    expect(find(res, 'missingGlyph')).toMatchObject({ severity: 'error', detail: { char: CJK, code: 0x4e2d } })
    expect(find(res, 'markup', g => g.detail.problem === 'unmatched')).toMatchObject({ severity: 'warning', detail: { text: '**' } })
    expect(find(res, 'markup', g => g.detail.problem === 'unknownStyle').detail.text).toBe('ghost')
    expect(res.counts).toMatchObject({ error: 2, warning: 2 })
  })

  it('groups a problem that many cards share into one line, with the count and the cards', async () => {
    await seed(Array.from({ length: 30 }, (_, i) => `card {gone} ${i}`))
    const res = await invoke('textcheck:run')
    const g = find(res, 'missingIcon')
    expect(res.groups.filter(x => x.type === 'missingIcon')).toHaveLength(1)
    expect(g.count).toBe(30)
    expect(g.cards).toHaveLength(30)
  })

  it('reports text that does not fit even at the minimum size', async () => {
    await seed(['word '.repeat(80), 'ok'], tpl('tiny data-spadewick-text-fit="shrink" data-spadewick-text-max-size="20" data-spadewick-text-min-size="12"'))
    const res = await invoke('textcheck:run')
    const g = find(res, 'noFit')
    expect(g).toMatchObject({ severity: 'error', detail: { min: 12 } })
    expect(g.cards.map(c => c.name)).toEqual(['Card 1'])
  })

  it('reports a text the engine left to the rasterizer, as information', async () => {
    await seed(['x'], tpl('rotate="5"'))
    const res = await invoke('textcheck:run')
    expect(find(res, 'native')).toMatchObject({ severity: 'info', detail: { reason: 'rotate' } })
  })

  it('reports an alias that two icons share', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'check-icons-'))
    const mk = n => { const p = join(dir, `${n}.svg`); writeText(p, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h5v5z"/></svg>'); return p }
    const [a, b] = (await invoke('icons:import-files', { paths: [mk('fire'), mk('flame')] })).imported
    await invoke('icons:update', { id: a.id, aliases: ['hot'] })
    await invoke('icons:update', { id: b.id, aliases: ['hot'] })
    const g = find(await invoke('textcheck:run'), 'ambiguousAlias')
    expect(g).toMatchObject({ severity: 'warning', detail: { alias: 'hot' } })
    expect(g.detail.icons.sort()).toEqual(['fire', 'flame'])
  })

  it('reports a project font that forbids embedding, only when a template uses it', async () => {
    // A copy of a bundled font whose own flag (OS/2 fsType) says "restricted license embedding"
    const src = readFileSync(join(process.cwd(), 'resources/fonts/LiberationMono-Regular.ttf'))
    const numTables = src.readUInt16BE(4)
    for (let i = 0; i < numTables; i++) { const r = 12 + i * 16; if (src.toString('latin1', r, r + 4) === 'OS/2') src.writeUInt16BE(0x0002, src.readUInt32BE(r + 8) + 8) }
    const file = join(mkdtempSync(join(tmpdir(), 'check-font-')), 'Restricted.ttf')
    writeFileSync(file, src)
    await invoke('fonts:import', [file])
    await seed(['x'], tpl('', 'Liberation Sans'))
    expect(find(await invoke('textcheck:run'), 'fontForbids')).toBeUndefined()      // no template uses it
    await seed(['x'], tpl('', 'Liberation Mono'), 'Second')
    const g = find(await invoke('textcheck:run'), 'fontForbids')
    expect(g).toMatchObject({ severity: 'error', detail: { family: 'Liberation Mono', level: 'restricted' } })
  })

  it('can be limited to some sets, and skips cards that have no template', async () => {
    const a = await seed(['{gone}'])
    const b = await seed(['{other}'], tpl(), 'Second')
    const only = await invoke('textcheck:run', { setIds: [b.set.id] })
    expect(only.groups.map(g => g.detail.name)).toEqual(['other'])
    await invoke('sets:update', { id: a.set.id, defaultTemplateId: null })
    for (const c of a.cards) await invoke('cards:update', { id: c.id, templateId: null })   // the seeded cards carry their own template
    const all = await invoke('textcheck:run')
    expect(all.groups.map(g => g.detail.name)).toEqual(['other'])
  })

  it('reports for the canvas how each text element fitted, using the unsaved template source', async () => {
    const s = await seed(['word '.repeat(80)], tpl('tiny data-spadewick-text-fit="shrink" data-spadewick-text-max-size="20" data-spadewick-text-min-size="12"'))
    const saved = await invoke('templates:text-report', { cardId: s.cards[0].id })
    expect(saved.fits).toEqual([expect.objectContaining({ where: { id: 'rules', field: 'body' }, fit: 'shrink', size: 12, fits: false })])
    expect(saved.items.some(i => i.type === 'noFit')).toBe(true)
    const roomy = tpl('data-spadewick-text-fit="shrink" data-spadewick-text-max-size="20" data-spadewick-text-min-size="12"')
    const edited = await invoke('templates:text-report', { cardId: s.cards[0].id, templateId: s.template.id, svgSource: roomy })
    expect(edited.fits[0].fits).toBe(true)                      // a bigger box, in a source that is not saved
    expect((await invoke('templates:get', s.template.id)).svg_source).not.toBe(roomy)
  })

  it('finds the problems whatever text engine the project uses', async () => {
    await seed(['{nosuch}'])
    await invoke('projects:set-text-engine', 'estimate')
    expect(find(await invoke('textcheck:run'), 'missingIcon')).toBeTruthy()
  })
})
