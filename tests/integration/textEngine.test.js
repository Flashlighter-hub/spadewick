/**
 * The text engine in the render pipeline (PRD §10.5, §16.2): the default for new projects, the per-project switch,
 * the move of an older project (snapshot and report), project fonts, and the speed target.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { copyFileSync } from 'fs'
import { join } from 'path'
import { createTestProject, seedSet, invoke } from '../helpers/project.js'
import { openProjectDb } from '../../src/main/db.js'
import { buildCardSvg, renderCard, textEngineOf } from '../../src/main/render.js'
import { loadHarfBuzz } from '../../src/main/text/hb.js'
import { createFontSet } from '../../src/main/text/fonts.js'

let proj
beforeEach(async () => { proj = await createTestProject('Engine') })
afterEach(async () => { await proj.cleanup() })

const CJK = '中'
const AR = 'مرحبا'
const boxed = (extra = '') => `<svg xmlns="http://www.w3.org/2000/svg" width="250" height="350" viewBox="0 0 250 350"><rect width="250" height="350" fill="#fff"/>` +
  `<text x="20" y="30" width="210" height="150" font-size="20" data-spadewick-field="body" data-spadewick-text-fit="shrink" data-spadewick-text-max-size="30" fill="#123">{{body}}</text>` +
  `<text x="20" y="300" font-size="24" font-weight="bold" fill="#900">Plain {{body}}</text>${extra}</svg>`
const LONG = 'AVATAR Tower of the Wave, with a long text that needs wrapping over several lines and then some more words to fill it up nicely.'

const seed = (body = LONG, svg = boxed()) => seedSet({
  cardSize: 'poker', fields: [{ name: 'Body', type: 'text' }], template: { name: 'T', svg },
  cards: [{ name: 'A', fields: { body } }]
}).then(async s => { await invoke('sets:update', { id: s.set.id, defaultTemplateId: s.template.id }); return s })

const db = () => openProjectDb(proj.dir)
const meta = key => db().prepare('SELECT value FROM project_meta WHERE key = ?').get(key)?.value ?? null

describe('which engine a project uses', () => {
  it('draws text as outlines in a new project, with no <text> left for the rasterizer', async () => {
    const { cards } = await seed()
    expect(meta('text_engine')).toBe('outlines')
    const { svg } = await buildCardSvg(proj.dir, cards[0].id)
    expect(svg).not.toContain('<text')
    expect(svg).toContain('<path')
    const png = Buffer.from(await invoke('templates:render', { cardId: cards[0].id, width: 250 }), 'base64')
    expect(png.subarray(1, 4).toString('latin1')).toBe('PNG')
  })

  it('goes back to the earlier estimate for one project, and refuses anything else', async () => {
    const { cards } = await seed()
    expect(await invoke('projects:set-text-engine', 'estimate')).toBe('estimate')
    expect(meta('text_engine')).toBe('estimate')
    expect(textEngineOf(db())).toBe('estimate')
    const { svg } = await buildCardSvg(proj.dir, cards[0].id)
    expect(svg).toContain('<text')
    expect(await invoke('projects:set-text-engine', 'outlines')).toBe('outlines')
    await expect(invoke('projects:set-text-engine', 'something')).rejects.toThrow(/outlines/)
  })

  it('lets a card be drawn both ways, so the two can be compared', async () => {
    const { cards } = await seed()
    const a = await buildCardSvg(proj.dir, cards[0].id, { textEngine: 'estimate' })
    const b = await buildCardSvg(proj.dir, cards[0].id, { textEngine: 'outlines' })
    expect(a.svg).toContain('<text')
    expect(b.svg).not.toContain('<text')
  })
})

describe('text the engine hands on or reports', () => {
  it('lays an element it does not read out the old way, for the rasterizer', async () => {
    const { cards } = await seed('hello', boxed('<text x="20" y="200" width="100" height="40" font-size="14" rotate="5" data-spadewick-field="body">x</text>'))
    const { svg } = await buildCardSvg(proj.dir, cards[0].id)
    expect(svg).toContain('<text')
    expect(svg).toContain('<tspan')
  })

  it('reports characters that no font has', async () => {
    const { cards } = await seed(`a${CJK}b`)
    const report = {}
    await buildCardSvg(proj.dir, cards[0].id, { report })
    expect([...report.missing]).toEqual([CJK])
  })

  it('draws Arabic from the bundled fallback with nothing missing', async () => {
    const { cards } = await seed(AR)
    const report = {}
    await buildCardSvg(proj.dir, cards[0].id, { report })
    expect(report.missing).toBeUndefined()
  })

  it('uses a project font before a bundled one of the same family', async () => {
    const src = join(proj.root, 'LiberationMono-copy.ttf')
    copyFileSync(join(process.cwd(), 'resources/fonts/LiberationMono-Regular.ttf'), src)
    const [imported] = await invoke('fonts:import', [src])
    expect(imported.family_name).toBe('Liberation Mono')
    const set = createFontSet(await loadHarfBuzz(), { projectDir: proj.dir, db: db() })
    expect(set.chain(['Liberation Mono'], { weight: 400, italic: false })[0].file.replace(/\\/g, '/')).toContain(`${proj.dir.replace(/\\/g, '/')}/fonts/`)
  })
})

describe('moving a project made before the text engine (PRD §16.2)', () => {
  /** Make the project look as it did before the engine: no setting, then open it again. */
  async function reopenAsOld() {
    db().prepare("DELETE FROM project_meta WHERE key = 'text_engine'").run()
    await invoke('projects:close')
    return invoke('projects:open', proj.dir)
  }

  it('keeps drawing the earlier way until the project is opened', async () => {
    const { cards } = await seed()
    db().prepare("DELETE FROM project_meta WHERE key = 'text_engine'").run()
    expect(textEngineOf(db())).toBe('estimate')
    expect((await buildCardSvg(proj.dir, cards[0].id)).svg).toContain('<text')
  })

  it('takes a snapshot and reports the templates whose text changes size or line breaks', async () => {
    await seed()
    const state = await reopenAsOld()
    expect(state.textEngine.changedCards).toBe(1)
    expect(state.textEngine.templates).toEqual(['T'])
    expect(state.textEngine.notices).toHaveLength(1)
    expect(state.textEngine.notices[0]).toMatch(/1 cards.*T/)
    expect(state.textEngine.snapshot).toBeTruthy()
    const snapshots = await invoke('snapshots:list')
    expect(snapshots.map(s => s.id)).toContain(state.textEngine.snapshot)
    expect(snapshots.find(s => s.id === state.textEngine.snapshot).name).toMatch(/text engine/)
    expect(meta('text_engine')).toBe('outlines')
    expect(state.meta.text_engine).toBe('outlines')
  })

  it('says so, and takes no snapshot, when no card changes', async () => {
    await seed('Hi')
    const state = await reopenAsOld()
    expect(state.textEngine.changedCards).toBe(0)
    expect(state.textEngine.snapshot).toBeNull()
    expect(state.textEngine.notices[0]).toMatch(/No card changed/)
    expect((await invoke('snapshots:list')).filter(s => /text engine/.test(s.name))).toHaveLength(0)
  })

  it('does it once: the next open says nothing', async () => {
    await seed()
    await reopenAsOld()
    await invoke('projects:close')
    const again = await invoke('projects:open', proj.dir)
    expect(again.textEngine).toBeUndefined()
  })

  it('leaves a project with no cards alone but still moves it', async () => {
    const state = await reopenAsOld()
    expect(state.textEngine.changedCards).toBe(0)
    expect(meta('text_engine')).toBe('outlines')
  })

  it('does not touch a project the user switched back to the estimate', async () => {
    await seed()
    await invoke('projects:set-text-engine', 'estimate')
    await invoke('projects:close')
    const state = await invoke('projects:open', proj.dir)
    expect(state.textEngine).toBeUndefined()
    expect(meta('text_engine')).toBe('estimate')
  })
})

describe('speed (PRD §14.1: a single card re-render under 200 ms)', () => {
  it('renders a card with several texts, Arabic and shrink-to-fit well inside the target', async () => {
    const extra = `<text x="20" y="250" font-size="18" font-family="Liberation Serif" fill="#036">Centered ${AR} text</text><text x="230" y="270" font-size="14" text-anchor="end" fill="#000">right <tspan font-weight="bold">bold</tspan></text>`
    const { cards } = await seed(LONG, boxed(extra))
    await renderCard(proj.dir, cards[0].id, { width: 500 }) // the first render loads the shaper and the fonts
    const times = []
    for (let i = 0; i < 20; i++) {
      await invoke('cards:update', { id: cards[0].id, fields: { body: `${LONG} ${i}` } })
      const t = performance.now()
      await renderCard(proj.dir, cards[0].id, { width: 500 })
      times.push(performance.now() - t)
    }
    times.sort((a, b) => a - b)
    expect(times[Math.floor(times.length * 0.95) - 1]).toBeLessThan(200)
  })
})
