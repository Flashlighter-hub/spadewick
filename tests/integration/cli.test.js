/**
 * The command line (PRD §21): commands run in-process through runCli; a separate file runs the built program as a subprocess.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { existsSync, readdirSync, readFileSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { createTestProject, seedSet, invoke, makePng } from '../helpers/project.js'
import { openProjectDb, closeProjectDb } from '../../src/main/db.js'
import { runCli } from '../../src/cli/run.js'

let ctx
beforeEach(async () => { ctx = await createTestProject() })
afterEach(async () => { await ctx.cleanup() })

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="700"><rect width="500" height="700" fill="#fff"/><text x="20" y="60" font-size="40" data-spadewick-field="title">{{title}}</text></svg>'

async function cli(args, { project = true } = {}) {
  let stdout = '', stderr = ''
  const code = await runCli([...(project ? ['--project', ctx.dir] : []), ...args], { stdout: s => { stdout += s }, stderr: s => { stderr += s }, cwd: ctx.root, env: {} })
  return { code, stdout, stderr, json: () => JSON.parse(stdout) }
}

async function deck() {
  const s = await seedSet({
    name: 'Base', cardSize: 'poker',
    fields: [{ name: 'Title', type: 'text' }, { name: 'Cost', type: 'number', validation: { min: 0, max: 10 } }],
    template: { svg: SVG },
    cards: [{ name: 'Fire', fields: { title: 'Fire', cost: 3 } }, { name: 'Ice', fields: { title: 'Ice', cost: 2 } }]
  })
  await invoke('sets:update', { id: s.set.id, defaultTemplateId: s.template.id })
  return s
}

describe('the command line: basics', () => {
  it('prints help, the version and refuses unknown commands and options with exit 2', async () => {
    expect((await cli(['help'], { project: false })).stdout).toMatch(/Usage: spadewick/)
    expect((await cli(['--version'], { project: false })).stdout).toMatch(/^\d+\.\d+\.\d+/)
    const bad = await cli(['frobnicate'])
    expect(bad.code).toBe(2)
    expect(bad.stderr).toMatch(/Unknown command/)
    expect((await cli(['info', '--nope'])).code).toBe(2)
    const later = await cli(['cloud'])
    expect(later.code).toBe(2)
    expect(later.stderr).toMatch(/not available in this version/)
  })

  it('exits 3 for a folder that is not a project, and for a project made by a newer version', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'spadewick-cli-'))
    try {
      expect(await runCli(['info', '--project', empty], { stdout() {}, stderr() {}, cwd: empty, env: {} })).toBe(3)
    } finally { rmSync(empty, { recursive: true, force: true }) }
    openProjectDb(ctx.dir).prepare("UPDATE project_meta SET value = '999' WHERE key = 'schema_version'").run()
    closeProjectDb(ctx.dir)
    const r = await cli(['info'])
    expect(r.code).toBe(3)
    expect(r.stderr).toMatch(/999/)
  })

  it('info and list describe the project, as text and as JSON', async () => {
    await deck()
    const info = (await cli(['info', '--json'])).json()
    expect(info.sets).toEqual([expect.objectContaining({ name: 'Base', cards: 2 })])
    expect((await cli(['info'])).stdout).toMatch(/Base/)
    const cards = (await cli(['list', 'cards', '--json'])).json()
    expect(cards.map(c => c.name)).toEqual(['Fire', 'Ice'])
    expect((await cli(['list', 'sets'])).stdout).toMatch(/Base/)
    expect((await cli(['list', 'nothing'])).code).toBe(2)
    expect((await cli(['list', 'presets', '--json'])).json().length).toBeGreaterThan(5)
  })
})

describe('validate', () => {
  it('passes a clean project and fails (exit 1) on a value outside its rules', async () => {
    const s = await deck()
    const clean = await cli(['validate'])
    expect(clean.code, clean.stdout).toBe(0)
    expect(clean.stdout).toMatch(/2 cards checked: 0 errors/)

    await invoke('cards:update', { id: s.cards[0].id, fields: { cost: 99 } })
    const out = await cli(['validate', '--json'])
    expect(out.code).toBe(1)
    expect(out.json().problems.some(p => p.kind === 'value' && p.card === 'Fire' && p.field === 'Cost')).toBe(true)
  })

  it('reports a card that points at a picture which is gone', async () => {
    const s = await deck()
    await invoke('fields:create', { setId: s.set.id, name: 'Art', type: 'image_ref' })
    const [asset] = await invoke('assets:import', [await makePng(join(ctx.root, 'a.png'))])
    await invoke('cards:update', { id: s.cards[0].id, fields: { art: `asset:${asset.id}` } })
    expect((await cli(['validate'])).code).toBe(0)
    rmSync(join(ctx.dir, 'assets', asset.filename))
    const r = await cli(['validate', '--json'])
    expect(r.code).toBe(1)
    expect(r.json().problems.some(p => p.kind === 'image')).toBe(true)
  })

  it('only looks at the sets asked for, and says which set does not exist', async () => {
    await deck()
    expect((await cli(['validate', '--set', 'Base'])).code).toBe(0)
    const r = await cli(['validate', '--set', 'Nope'])
    expect(r.code).toBe(2)
    expect(r.stderr).toMatch(/No set named "Nope"/)
  })
})

describe('export and render', () => {
  it('exports per-card images to --out, identical to what the interface export writes', async () => {
    const s = await deck()
    const out = join(ctx.root, 'out')
    const r = await cli(['export', 'images', '--out', out, '--json'])
    expect(r.code, r.stderr).toBe(0)
    expect(r.json().exported).toBe(true)
    expect(readdirSync(out).filter(f => f.endsWith('.png')).length).toBe(3)   // two cards and the shared back
    const viaApp = join(ctx.root, 'app')
    await invoke('production:run-images', { setIds: [s.set.id], outputDir: viaApp })
    for (const f of readdirSync(viaApp).filter(f => f.endsWith('.png')))
      expect(readFileSync(join(out, f)).equals(readFileSync(join(viaApp, f)))).toBe(true)
  })

  it('--dry-run writes nothing, and --opt changes a setting', async () => {
    await deck()
    const out = join(ctx.root, 'dry')
    const r = await cli(['export', 'pdf', '--out', out, '--dry-run', '--opt', 'dpi=150'])
    expect(r.code).toBe(0)
    expect(r.stdout).toMatch(/Nothing was written/)
    expect(existsSync(out)).toBe(false)
    expect((await cli(['export', 'pdf', '--out', out, '--dry-run', '--opt', 'dpi=150', '--json'])).json().options.dpi).toBe(150)
  })

  it('exports the Tabletop Simulator deck, the PNG sheet and the print-and-play PDF', async () => {
    await deck()
    for (const [kind, ext] of [['tts', '.png'], ['png', '.png'], ['pdf', '.pdf']]) {
      const out = join(ctx.root, `x-${kind}`)
      const r = await cli(['export', kind, '--out', out])
      expect(r.code, r.stderr + r.stdout).toBe(0)
      expect(readdirSync(out).some(f => f.endsWith(ext))).toBe(true)
    }
  })

  it('production-pdf is held back by preflight errors unless --export-anyway', async () => {
    await deck()
    const out = join(ctx.root, 'prod')
    const blocked = await cli(['export', 'production-pdf', '--out', out, '--opt', 'bleedMm=0'])
    expect(blocked.code).toBe(1)
    expect(blocked.stdout).toMatch(/Nothing was exported/)
    expect(existsSync(out) ? readdirSync(out) : []).toEqual([])
    const forced = await cli(['export', 'production-pdf', '--out', out, '--opt', 'bleedMm=0', '--opt', 'dpi=100', '--export-anyway'])
    expect(forced.code, forced.stderr + forced.stdout).toBe(0)
    expect(readdirSync(out).some(f => f.endsWith('.pdf'))).toBe(true)
  })

  it('renders one card by name and by card ID, and refuses an unknown card or no card', async () => {
    const s = await deck()
    const file = join(ctx.root, 'fire.png')
    expect((await cli(['render', '--card', 'fire', '--out', file, '--width', '200'])).code).toBe(0)
    expect(readFileSync(file).subarray(1, 4).toString()).toBe('PNG')
    const code = (await invoke('cards:list', s.set.id))[1].card_code
    expect((await cli(['render', '--card', code, '--out', join(ctx.root, 'b.png')])).code).toBe(0)
    expect((await cli(['render', '--card', 'nobody'])).code).toBe(2)
    expect((await cli(['render'])).code).toBe(2)
  })
})

describe('preflight and compare', () => {
  it('runs the print readiness check, with a preset, and exits 1 when it has errors', async () => {
    await deck()
    const r = await cli(['preflight', '--preset', 'printninja', '--json'])
    expect(r.stderr).toBe('')
    const data = r.json()
    expect(r.code).toBe(data.counts.error ? 1 : 0)
    expect((await cli(['preflight', '--preset', 'No such preset'])).code).toBe(2)
    const bleedless = await cli(['preflight', '--opt', 'bleedMm=0', '--only-errors'])
    expect(bleedless.code).toBe(1)
    expect(bleedless.stdout).toMatch(/noBleed/)
  })

  it('compares a snapshot with now, in text, markdown and JSON', async () => {
    const s = await deck()
    const a = await invoke('snapshots:create', { name: 'before' })
    await invoke('cards:update', { id: s.cards[0].id, fields: { cost: 5 } })
    const text = await cli(['compare', 'before'])
    expect(text.code).toBe(0)
    expect(text.stdout).toMatch(/Cost: 3 → 5/)
    expect((await cli(['compare', 'before', '--format', 'markdown'])).stdout).toMatch(/^# Since/)
    expect((await cli(['compare', a.id, '--json'])).json().summary.cardsChanged).toBe(1)
    expect((await cli(['compare', 'missing'])).code).toBe(2)
    expect((await cli(['compare', 'before', '--format', 'xml'])).code).toBe(2)
    expect((await cli(['compare', 'before', '--format', 'csv'])).stdout).toMatch(/card,changed,Base,Fire/)
    expect((await cli(['compare', 'before', '--format', 'html'])).stdout).toMatch(/<h1>/)
  })

  it('does not change the project when it only reads', async () => {
    await deck()
    const setId = (await invoke('sets:list'))[0].id
    const before = JSON.stringify(await invoke('cards:list', setId))
    const stackBefore = (await invoke('history:get-stack')).undo.length
    await cli(['validate']); await cli(['info']); await cli(['preflight'])
    expect(JSON.stringify(await invoke('cards:list', setId))).toBe(before)
    expect((await invoke('history:get-stack')).undo.length).toBe(stackBefore)
  })
})
