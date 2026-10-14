import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import sharp from 'sharp'
import { createTestProject, seedSet, invoke, makePng } from '../helpers/project.js'

let ctx
beforeEach(async () => { ctx = await createTestProject() })
afterEach(async () => { await ctx.cleanup() })

const svg = inner => `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="280" viewBox="0 0 200 280"><rect width="200" height="280" fill="#ffffff"/>${inner}</svg>`
const render = async (cardId, opts = {}) => Buffer.from(await invoke('templates:render', { cardId, ...opts }), 'base64')
const pixel = async (buf, x, y) => {
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true })
  const i = (y * info.width + x) * info.channels
  return [data[i], data[i + 1], data[i + 2]]
}
const near = (rgb, [r, g, b], tol = 6) => rgb.every((v, i) => Math.abs(v - [r, g, b][i]) <= tol)

describe('render pipeline (PRD §10.5)', () => {
  it('renders a PNG at the requested width, keeping the card aspect ratio', async () => {
    const { cards } = await seedSet({ cards: [{ name: 'a' }], template: { svg: svg('') } })
    const buf = await render(cards[0].id, { width: 400 })
    const meta = await sharp(buf).metadata()
    expect(meta).toMatchObject({ format: 'png', width: 400, height: 560 })
  })

  it('uses the set\'s card size when no width is given', async () => {
    const { cards } = await seedSet({ cards: [{ name: 'a' }], template: { svg: svg('') }, cardSize: 'tarot' })
    const meta = await sharp(await render(cards[0].id)).metadata()
    expect(meta.width).toBe(500)
  })

  it('substitutes text tokens with XML escaping', async () => {
    const { cards } = await seedSet({
      fields: [{ name: 'Name', type: 'text' }], cards: [{ name: 'a', fields: { name: 'A & B <script>' } }],
      template: { svg: svg('<text x="10" y="40" font-size="20">{{name}}</text>') }
    })
    await expect(render(cards[0].id)).resolves.toBeInstanceOf(Buffer) // malformed XML would throw
  })

  it('substitutes color fields', async () => {
    const { cards } = await seedSet({
      fields: [{ name: 'Tint', type: 'color' }], cards: [{ name: 'a', fields: { tint: '#ff0000' } }],
      template: { svg: svg('<rect x="0" y="0" width="100" height="100" fill="{{tint}}"/><rect x="100" y="0" width="100" height="100" fill="#00ff00"/>') }
    })
    const buf = await render(cards[0].id, { width: 200 })
    expect(near(await pixel(buf, 50, 50), [255, 0, 0])).toBe(true)
    expect(near(await pixel(buf, 150, 50), [0, 255, 0])).toBe(true)
  })

  it('has no project palette: a leftover palette token draws nothing instead of failing', async () => {
    const { cards } = await seedSet({ cards: [{ name: 'a' }], template: { svg: svg('<rect x="0" y="0" width="100" height="100" fill="#ff0000"/><rect x="100" y="0" width="100" height="100" fill="{{@palette.brand}}"/>') } })
    const buf = await render(cards[0].id, { width: 200 })
    expect(near(await pixel(buf, 50, 50), [255, 0, 0])).toBe(true)
  })

  it('hides groups whose conditions fail, using the PRD syntax', async () => {
    const t = svg(`<g data-spadewick-show-if="type == 'Creature'"><rect x="0" y="0" width="100" height="100" fill="#ff0000"/></g>
                   <g data-spadewick-hide-if="legendary == 'true'"><rect x="100" y="0" width="100" height="100" fill="#0000ff"/></g>`)
    const { cards } = await seedSet({
      fields: [{ name: 'Type', type: 'text' }, { name: 'Legendary', type: 'text' }],
      cards: [{ name: 'creature', fields: { type: 'Creature', legendary: 'false' } }, { name: 'spell', fields: { type: 'Spell', legendary: 'true' } }],
      template: { svg: t }
    })
    const a = await render(cards[0].id, { width: 200 }), b = await render(cards[1].id, { width: 200 })
    expect(near(await pixel(a, 50, 50), [255, 0, 0])).toBe(true)
    expect(near(await pixel(a, 150, 50), [0, 0, 255])).toBe(true)
    expect(near(await pixel(b, 50, 50), [255, 255, 255])).toBe(true)  // show-if false
    expect(near(await pixel(b, 150, 50), [255, 255, 255])).toBe(true) // hide-if true
  })

  it('evaluates formula fields at render time', async () => {
    const { cards } = await seedSet({
      fields: [{ name: 'Attack', type: 'number' }, { name: 'Colour', type: 'formula', formula: 'if(gt(attack, 5), "#ff0000", "#0000ff")' }],
      cards: [{ fields: { attack: '9' } }, { fields: { attack: '1' } }],
      template: { svg: svg('<rect width="200" height="280" fill="{{colour}}"/>') }
    })
    expect(near(await pixel(await render(cards[0].id, { width: 200 }), 10, 10), [255, 0, 0])).toBe(true)
    expect(near(await pixel(await render(cards[1].id, { width: 200 }), 10, 10), [0, 0, 255])).toBe(true)
  })

  it('embeds image assets referenced by image_ref fields', async () => {
    const png = await makePng(join(ctx.root, 'blue.png'), 20, 20, '#0000ff')
    const [asset] = await invoke('assets:import', [png])
    const { cards } = await seedSet({
      fields: [{ name: 'Art', type: 'image_ref' }], cards: [{ fields: { art: `asset:${asset.id}` } }],
      template: { svg: svg('<image x="0" y="0" width="200" height="280" preserveAspectRatio="none" href="{{art}}"/>') }
    })
    expect(near(await pixel(await render(cards[0].id, { width: 200 }), 100, 140), [0, 0, 255])).toBe(true)
  })

  it('replacing an asset updates every card that uses it, with no field edits', async () => {
    const [asset] = await invoke('assets:import', [await makePng(join(ctx.root, 'a.png'), 20, 20, '#0000ff')])
    const { cards } = await seedSet({
      fields: [{ name: 'Art', type: 'image_ref' }], cards: [{ fields: { art: `asset:${asset.id}` } }],
      template: { svg: svg('<image x="0" y="0" width="200" height="280" preserveAspectRatio="none" href="{{art}}"/>') }
    })
    await invoke('assets:replace', { id: asset.id, newFilePath: await makePng(join(ctx.root, 'b.png'), 20, 20, '#ff0000') })
    expect(near(await pixel(await render(cards[0].id, { width: 200 }), 100, 140), [255, 0, 0])).toBe(true)
  })

  it('merges a child template into its parent slots', async () => {
    const parent = await invoke('templates:create', { name: 'base', svgSource: svg('<g id="slot_body"><!-- spadewick:slot="body" --></g>') })
    const child = await invoke('templates:create', {
      name: 'creature', parentId: parent.id,
      svgSource: '<!-- spadewick:parent="base" -->\n<!-- spadewick:fills="body" -->\n<rect x="0" y="0" width="100" height="100" fill="#ff0000"/>'
    })
    const set = await invoke('sets:create', { name: 'S' })
    const card = await invoke('cards:create', { setId: set.id, displayName: 'c', templateId: child.id })
    const buf = await render(card.id, { width: 200 })
    expect(near(await pixel(buf, 50, 50), [255, 0, 0])).toBe(true)
    expect(near(await pixel(buf, 150, 200), [255, 255, 255])).toBe(true) // parent frame still there
  })

  it('previews an unsaved template source against any card (canvas editor)', async () => {
    const { cards, template } = await seedSet({ cards: [{ name: 'a' }], template: { svg: svg('') } })
    const buf = await render(cards[0].id, { width: 200, templateId: template.id, svgSource: svg('<rect width="200" height="280" fill="#ff0000"/>') })
    expect(near(await pixel(buf, 10, 10), [255, 0, 0])).toBe(true)
    // the stored template is untouched
    expect((await invoke('templates:get', template.id)).svg_source).not.toContain('#ff0000')
  })

  it('wraps bound text across several lines', async () => {
    const t = svg('<text data-spadewick-field="body" data-spadewick-text-fit="wrap" x="10" y="10" width="60" height="200" font-size="16" fill="#000000"/>')
    const { cards } = await seedSet({ fields: [{ name: 'Body', type: 'text' }], cards: [{ fields: { body: 'the quick brown fox jumps over the lazy dog' } }], template: { svg: t } })
    const buf = await render(cards[0].id, { width: 200 })
    // ink must appear well below the first line (wrapped), and never to the right of the box
    const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true })
    let maxY = 0
    for (let y = 0; y < info.height; y++) for (let x = 0; x < 200; x++) if (data[(y * info.width + x) * info.channels] < 100) maxY = Math.max(maxY, y)
    expect(maxY).toBeGreaterThan(60)
  })

  it('errors clearly for a card with no template', async () => {
    const { cards } = await seedSet({ cards: [{ name: 'a' }] })
    await expect(render(cards[0].id)).rejects.toThrow(/no template/i)
  })

  it('renders a single card well inside the 200 ms budget (PRD §14.1)', async () => {
    const { cards } = await seedSet({ fields: [{ name: 'Name', type: 'text' }], cards: [{ fields: { name: 'x' } }], template: { svg: svg('<text x="10" y="30" font-size="20">{{name}}</text>') } })
    await render(cards[0].id, { width: 220 }) // warm-up
    const t = Date.now(); await render(cards[0].id, { width: 440 })
    expect(Date.now() - t).toBeLessThan(200)
  })
})

describe('default templates (PRD §5.2)', () => {
  it('cards without their own template render with the set default', async () => {
    const { set, cards, template } = await seedSet({ cards: [{ name: 'a' }], template: { svg: svg('<rect width="200" height="280" fill="#ff0000"/>') } })
    await invoke('cards:update', { id: cards[0].id, templateId: null })
    await expect(render(cards[0].id)).rejects.toThrow(/No template/)
    await invoke('sets:update', { id: set.id, defaultTemplateId: template.id })
    expect(near(await pixel(await render(cards[0].id, { width: 200 }), 10, 10), [255, 0, 0])).toBe(true)
  })

  it('a card\'s own template overrides the set default', async () => {
    const { set, cards, template } = await seedSet({ cards: [{ name: 'a' }], template: { svg: svg('<rect width="200" height="280" fill="#ff0000"/>') } })
    const other = await invoke('templates:create', { name: 'Other', svgSource: svg('<rect width="200" height="280" fill="#0000ff"/>') })
    await invoke('sets:update', { id: set.id, defaultTemplateId: template.id })
    await invoke('cards:update', { id: cards[0].id, templateId: other.id })
    expect(near(await pixel(await render(cards[0].id, { width: 200 }), 10, 10), [0, 0, 255])).toBe(true)
  })

  it('exports include cards that rely on the default template', async () => {
    const { set, template } = await seedSet({ cards: [{ name: 'a' }, { name: 'b' }], template: { svg: svg('') } })
    await invoke('sets:update', { id: set.id, defaultTemplateId: template.id })
    const cards = await invoke('cards:list', set.id)
    for (const c of cards) await invoke('cards:update', { id: c.id, templateId: null })
    const res = await invoke('export:png-sheet', { setIds: [set.id], outputDir: join(ctx.root, 'out'), cardWidth: 50, cardHeight: 70 })
    expect(res.cardCount).toBe(2)
  })

  it('upgrades older projects: the migration adds the column', async () => {
    const Database = (await import('better-sqlite3')).default
    const { mkdtempSync } = await import('fs'); const { tmpdir } = await import('os')
    const dir = mkdtempSync(join(tmpdir(), 'legacy-'))
    const raw = new Database(join(dir, 'project.db'))
    raw.exec("CREATE TABLE project_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO project_meta VALUES ('schema_version','1');" +
      "CREATE TABLE sets(id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, sort_order INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL); INSERT INTO sets VALUES ('s','Old',NULL,0,1,1);")
    raw.close()
    const { openProjectDb, closeProjectDb, CURRENT_SCHEMA_VERSION } = await import('../../src/main/db.js')
    const d = openProjectDb(dir)
    const cols = d.prepare('PRAGMA table_info(sets)').all().map(c => c.name)
    expect(cols).toEqual(expect.arrayContaining(['card_size', 'card_mm_w', 'card_mm_h', 'default_template_id']))
    expect(d.prepare("SELECT value FROM project_meta WHERE key='schema_version'").get().value).toBe(String(CURRENT_SCHEMA_VERSION))
    expect(d.prepare('SELECT name FROM sets').get().name).toBe('Old')
    closeProjectDb(dir)
  })
})

describe('templates written before the rename to Spadewick', () => {
  it('still render, and are rewritten to the new prefix when loaded or saved', async () => {
    const { openProjectDb } = await import('../../src/main/db.js')
    const { cards, template } = await seedSet({ cards: [{ name: 'a', fields: {} }], template: { svg: svg('') } })
    const legacy = svg(`<g data-cardexy-hide-if="1 == 1"><rect x="0" y="0" width="200" height="280" fill="#ff0000"/></g>`)
    openProjectDb(ctx.dir).prepare('UPDATE templates SET svg_source = ? WHERE id = ?').run(legacy, template.id)

    // hidden by the old attribute: the card stays white
    expect(near(await pixel(await render(cards[0].id, { width: 200 }), 50, 50), [255, 255, 255])).toBe(true)
    const loaded = await invoke('templates:get', template.id)
    expect(loaded.svg_source).toContain('data-spadewick-hide-if')
    expect(loaded.svg_source).not.toContain('cardexy')
    const saved = await invoke('templates:update', { id: template.id, svgSource: legacy })
    expect(saved.svg_source).toContain('data-spadewick-hide-if')
  })
})
