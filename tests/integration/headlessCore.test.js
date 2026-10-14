/**
 * The headless core (PRD §24.2, phase 0.3): the services in src/main/core run with no window system, no
 * IPC and no global "open project". These tests call the services directly, never through ipcMain.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { readdirSync, readFileSync, mkdtempSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { createContext, createMemorySettings, headlessUi } from '../../src/main/core/session.js'
import { dirOf } from '../../src/main/core/context.js'
import * as projects from '../../src/main/core/projects.js'
import * as sets from '../../src/main/core/sets.js'
import * as fields from '../../src/main/core/fields.js'
import * as cards from '../../src/main/core/cards.js'
import * as templates from '../../src/main/core/templates.js'
import * as history from '../../src/main/core/history.js'
import * as snapshots from '../../src/main/core/snapshots.js'
import * as exporter from '../../src/main/core/export.js'

const CORE = fileURLToPath(new URL('../../src/main/core/', import.meta.url))
const roots = []
const contexts = []

function newContext(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'spadewick-core-'))
  roots.push(root)
  const settings = createMemorySettings({ projects_root: root, library_dir: join(root, 'library'), default_export_dpi: 300, undo_limit: 1000, recent_projects: [] })
  const ctx = createContext({ settings, ...overrides })
  contexts.push(ctx)
  return { root, settings, ctx }
}

afterEach(async () => {
  while (contexts.length) projects.close(contexts.pop()) // an open database would keep its folder locked on Windows
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true, maxRetries: 3 })
})

describe('the core has no window-system dependency', () => {
  const files = readdirSync(CORE).filter(f => f.endsWith('.js'))

  it('has services for every handler family', () => {
    for (const f of ['assets', 'cardids', 'cards', 'dataio', 'export', 'fields', 'fonts', 'history', 'projects', 'sets', 'snapshots', 'templatelib', 'templates', 'context', 'session'])
      expect(files).toContain(`${f}.js`)
  })

  it.each(files)('%s imports nothing from Electron or the IPC layer', file => {
    const src = readFileSync(join(CORE, file), 'utf8')
    expect(src).not.toMatch(/from\s+['"]electron['"]/)
    expect(src).not.toMatch(/require\(\s*['"]electron['"]/)
    expect(src).not.toMatch(/\bipcMain\b/)
    expect(src).not.toMatch(/from\s+['"]\.\.\/ipc\//)
    expect(src).not.toMatch(/getActiveProjectDir/)
  })
})

describe('a service call needs an explicit project', () => {
  it('refuses with a clear message when the context has no project', () => {
    const { ctx } = newContext()
    expect(() => sets.list(ctx)).toThrow(/No project open/)
    expect(() => dirOf(ctx)).toThrow(/No project open/)
    expect(projects.getMeta(ctx)).toBeNull()
    expect(history.undo(ctx)).toBe(false)
    expect(history.getStack(ctx)).toEqual({ undo: [], redo: [] })
  })

  it('builds a project, edits it, undoes and redoes it, with no IPC involved', async () => {
    const { ctx, root } = newContext()
    const made = await projects.create(ctx, { name: 'Headless Game' })
    expect(made.path).toBe(join(root, 'Headless Game'))
    expect(ctx.project.dir).toBe(made.path)

    const set = sets.create(ctx, { name: 'Base' })
    fields.create(ctx, { setId: set.id, name: 'Title', type: 'text' })
    const card = cards.create(ctx, { setId: set.id, displayName: 'One', fields: { title: 'Hello' } })
    cards.update(ctx, { id: card.id, fields: { title: 'Changed' } })
    expect(cards.list(ctx, set.id)[0].fields.title).toBe('Changed')

    expect(history.undo(ctx)).toBe(true)
    expect(cards.list(ctx, set.id)[0].fields.title).toBe('Hello')
    expect(history.redo(ctx)).toBe(true)
    expect(cards.list(ctx, set.id)[0].fields.title).toBe('Changed')

    expect(projects.listRecent(ctx)).toEqual([made.path])
    projects.close(ctx)
    expect(ctx.project).toBeNull()
  })

  it('works on two projects at once, each through its own context', async () => {
    const a = newContext(), b = newContext()
    await projects.create(a.ctx, { name: 'Alpha' })
    await projects.create(b.ctx, { name: 'Beta' })
    const setA = sets.create(a.ctx, { name: 'Only in alpha' })
    sets.create(b.ctx, { name: 'First in beta' })
    sets.create(b.ctx, { name: 'Second in beta' })
    cards.create(a.ctx, { setId: setA.id, displayName: 'card' })

    expect(sets.list(a.ctx).map(s => s.name)).toEqual(['Only in alpha'])
    expect(sets.list(b.ctx).map(s => s.name)).toEqual(['First in beta', 'Second in beta'])
    // undo is per project: the other project's history is untouched
    expect(history.getStack(a.ctx).undo.length).toBe(1)
    expect(history.getStack(b.ctx).undo.length).toBe(0)
    expect(history.undo(b.ctx)).toBe(false)
    expect(history.undo(a.ctx)).toBe(true)
    expect(cards.list(a.ctx, setA.id)).toHaveLength(0)
  })

  it('opens an existing project by path, replacing the context\'s project', async () => {
    const { ctx } = newContext()
    const first = await projects.create(ctx, { name: 'One' })
    sets.create(ctx, { name: 'In one' })
    const second = await projects.create(ctx, { name: 'Two' })
    expect(ctx.project.dir).toBe(second.path)
    const opened = await projects.openProject(ctx, first.path)
    expect(opened.sets.map(s => s.name)).toEqual(['In one'])
    expect(ctx.project.dir).toBe(first.path)
  })
})

describe('dialogs and settings come from the caller', () => {
  it('asks the supplied ui, and a headless context treats every dialog as cancelled', async () => {
    const asked = []
    const ui = { async showOpenDialog(o) { asked.push(o.title); return { canceled: true, filePaths: [] } }, async showSaveDialog() { return { canceled: true } }, openPath(p) { asked.push(`open ${p}`) } }
    const { ctx } = newContext({ ui })
    expect(await projects.open(ctx)).toBeNull()
    expect(asked).toHaveLength(1)
    await projects.create(ctx, { name: 'Dlg' })
    projects.reveal(ctx)
    expect(asked.at(-1)).toBe(`open ${ctx.project.dir}`)

    const quiet = newContext()
    expect(await projects.open(quiet.ctx)).toBeNull()
    expect(await projects.openFile(quiet.ctx)).toBeNull()
    expect(await headlessUi.showSaveDialog()).toEqual({ canceled: true })
  })

  it('reads and writes the settings it was given', () => {
    const { ctx, settings } = newContext()
    projects.settingsSet(ctx, 'theme', 'dark')
    expect(projects.settingsGet(ctx, 'theme')).toBe('dark')
    expect(settings.get('theme')).toBe('dark')
    expect(projects.settingsGetAll(ctx).theme).toBe('dark')
  })
})

describe('services that touch the disk and the renderer', () => {
  it('renders a card, takes a snapshot and exports a PNG sheet without a window', async () => {
    const { ctx } = newContext()
    await projects.create(ctx, { name: 'Render' })
    const set = sets.create(ctx, { name: 'Base' })
    fields.create(ctx, { setId: set.id, name: 'Title', type: 'text' })
    const tpl = templates.create(ctx, { name: 'T', svgSource: '<svg xmlns="http://www.w3.org/2000/svg" width="250" height="350" viewBox="0 0 250 350"><rect width="250" height="350" fill="#fff"/><text x="20" y="60" font-size="30" fill="#000">{{title}}</text></svg>', cardSize: 'poker' })
    sets.update(ctx, { id: set.id, cardSize: 'poker', defaultTemplateId: tpl.id })
    const card = cards.create(ctx, { setId: set.id, displayName: 'C', fields: { title: 'Hi' } })

    const png = Buffer.from(await templates.render(ctx, { cardId: card.id, width: 250 }), 'base64')
    expect(png.subarray(1, 4).toString('latin1')).toBe('PNG')

    const snap = snapshots.create(ctx, { name: 'Before', description: '' })
    expect(snapshots.list(ctx).map(s => s.id)).toContain(snap.id)

    const out = join(dirOf(ctx), 'exports')
    const result = await exporter.exportPngSheet(ctx, { setIds: [set.id], outputDir: out, columns: 1, rows: 1 })
    expect(result).toBeTruthy()
    expect(existsSync(out)).toBe(true)
  })
})
