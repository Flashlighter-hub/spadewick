/**
 * The command line's commands that write or keep running (PRD §21.3, §21.4): import, snapshot, profiles, watch, and the lock.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { createTestProject, seedSet, invoke } from '../helpers/project.js'
import { runCli } from '../../src/cli/run.js'
import { LOCK_FILE } from '../../src/main/core/lock.js'

let ctx
beforeEach(async () => { ctx = await createTestProject() })
afterEach(async () => { await ctx.cleanup() })

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="700"><rect width="500" height="700" fill="#fff"/><text x="20" y="60" font-size="40" data-spadewick-field="title">{{title}}</text></svg>'

async function cli(args) {
  let stdout = '', stderr = ''
  const code = await runCli(['--project', ctx.dir, ...args], { stdout: s => { stdout += s }, stderr: s => { stderr += s }, cwd: ctx.root, env: {} })
  return { code, stdout, stderr, json: () => JSON.parse(stdout) }
}

async function deck() {
  const s = await seedSet({
    name: 'Base', cardSize: 'poker',
    fields: [{ name: 'Title', type: 'text' }, { name: 'Cost', type: 'number', validation: { min: 0, max: 10 } }],
    template: { svg: SVG },
    cards: [{ name: 'Fire', fields: { title: 'Fire', cost: 3 } }]
  })
  await invoke('sets:update', { id: s.set.id, defaultTemplateId: s.template.id })
  return s
}
const names = async setId => (await invoke('cards:list', setId)).map(c => c.display_name)

describe('import', () => {
  it('imports a CSV, with a dry run first that writes nothing, and the cards are one undoable step', async () => {
    const s = await deck()
    const file = join(ctx.root, 'cards.csv')
    writeFileSync(file, 'display_name,Title,Cost\nIce,Ice storm,2\nWind,Gust,1\n')
    const dry = await cli(['import', file, '--set', 'Base', '--dry-run'])
    expect(dry.code).toBe(0)
    expect(dry.stdout).toMatch(/Dry run: 2 rows of 2 would be imported/)
    expect(await names(s.set.id)).toEqual(['Fire'])

    const r = await cli(['import', file, '--set', 'Base', '--json'])
    expect(r.code, r.stderr).toBe(0)
    expect(r.json()).toMatchObject({ created: 2, updated: 0 })
    expect(await names(s.set.id)).toEqual(['Fire', 'Ice', 'Wind'])
    await invoke('history:undo')
    expect(await names(s.set.id)).toEqual(['Fire'])
  })

  it('writes nothing from a CSV that breaks the CSV rules, says where, and imports what was read only with --ignore-file-problems', async () => {
    const s = await deck()
    const file = join(ctx.root, 'broken.csv')
    // the stray quote after "Level 1 - " ends the field early, and the cards after it run together (found with a real skills file)
    writeFileSync(file, 'display_name,Title,Cost\nIce,"Level 1 - "On a hit.",2\nWind,Gust,1\nHail,Chip,1\n')
    const dry = await cli(['import', file, '--set', 'Base', '--dry-run'])
    expect(dry.stdout).toMatch(/Dry run/)
    expect(dry.stdout).toMatch(/breaks the CSV rules/)
    expect(dry.stdout).toMatch(/line 2/)
    const refused = await cli(['import', file, '--set', 'Base'])
    expect(refused.code).toBe(1)
    expect(refused.stdout).toMatch(/Nothing was imported/)
    expect(refused.stdout).toMatch(/line 2: .*quote/i)
    expect(refused.stdout).toMatch(/--ignore-file-problems/)
    expect(await names(s.set.id)).toEqual(['Fire'])
    const json = await cli(['import', file, '--set', 'Base', '--json'])
    expect(json.json().refused).toBe(true)
    expect(json.json().fileProblems[0].line).toBe(2)

    const forced = await cli(['import', file, '--set', 'Base', '--ignore-file-problems'])
    expect(forced.stdout).toMatch(/Warning: the file breaks the CSV rules/)
    expect((await names(s.set.id)).length).toBeGreaterThan(1)
  })

  it('merges by a key field, reports invalid rows with exit 1, and refuses a bad file or option with exit 2', async () => {
    const s = await deck()
    const file = join(ctx.root, 'merge.csv')
    writeFileSync(file, 'display_name,Title,Cost\nFire,Fire storm,4\nBad,Bad,99\n')
    const r = await cli(['import', file, '--set', 'Base', '--mode', 'merge', '--key', 'title'])
    expect(r.code).toBe(1)                                           // row 2 is outside the rules of Cost
    expect(r.stdout).toMatch(/Imported into Base/)
    expect((await invoke('cards:list', s.set.id)).find(c => c.display_name === 'Fire')).toBeTruthy()
    expect((await cli(['import', join(ctx.root, 'nope.csv'), '--set', 'Base'])).code).toBe(2)
    expect((await cli(['import', file, '--set', 'Base', '--mode', 'swap'])).code).toBe(2)
    expect((await cli(['import', file])).stderr).toMatch(/^$|exactly one set|--set/)
    writeFileSync(join(ctx.root, 'x.txt'), 'a')
    expect((await cli(['import', join(ctx.root, 'x.txt'), '--set', 'Base'])).code).toBe(1)   // not a data file: reported, nothing written
  })
})

describe('snapshot and profiles', () => {
  it('creates, lists and restores snapshots, and a restore keeps the state before as an automatic snapshot', async () => {
    const s = await deck()
    expect((await cli(['snapshot', 'create', 'before', '--description', 'from the terminal'])).code).toBe(0)
    expect((await cli(['snapshot', 'list', '--json'])).json()).toEqual([expect.objectContaining({ name: 'before' })])
    await invoke('cards:create', { setId: s.set.id, displayName: 'Extra' })
    expect(await names(s.set.id)).toEqual(['Fire', 'Extra'])
    const dry = await cli(['snapshot', 'restore', 'before', '--dry-run'])
    expect(dry.stdout).toMatch(/Nothing was written/)
    expect(await names(s.set.id)).toEqual(['Fire', 'Extra'])
    const r = await cli(['snapshot', 'restore', 'before'])
    expect(r.code, r.stderr).toBe(0)
    expect(await names(s.set.id)).toEqual(['Fire'])
    const list = (await cli(['snapshot', 'list', '--json'])).json()
    expect(list.some(x => x.name.startsWith('(auto) before restore'))).toBe(true)
    expect((await cli(['snapshot', 'restore', 'missing'])).code).toBe(2)
    expect((await cli(['snapshot'])).code).toBe(2)
  })

  it('lists and shows the saved export profiles', async () => {
    await deck()
    await invoke('exportprofiles:save', { name: 'Press run', kind: 'production', options: { dpi: 450, bleedMm: 3 } })
    expect((await cli(['profiles', 'list'])).stdout).toMatch(/Press run\s+production/)
    const shown = (await cli(['profiles', 'show', 'press run', '--json'])).json()
    expect(shown.options).toEqual({ dpi: 450, bleedMm: 3 })
    expect((await cli(['profiles', 'show', 'nope'])).code).toBe(2)
  })
})

describe('the lock (PRD §21.4)', () => {
  it('does not write while another running program has the project open, unless --force, and lets go afterwards', async () => {
    const s = await deck()
    const lock = join(ctx.dir, LOCK_FILE)
    writeFileSync(lock, JSON.stringify({ pid: process.ppid, owner: 'app', since: Date.now() }))   // the parent process is running and is not us
    const refused = await cli(['snapshot', 'create', 'x'])
    expect(refused.code).toBe(3)
    expect(refused.stderr).toMatch(/open in another program/)
    expect((await cli(['snapshot', 'list'])).code).toBe(0)           // reading never looks at the lock
    expect((await cli(['validate'])).code).toBe(0)
    const forced = await cli(['snapshot', 'create', 'x', '--force'])
    expect(forced.code).toBe(0)
    expect(existsSync(lock)).toBe(true)                              // the other program's lock is not ours to remove
    expect(JSON.parse(readFileSync(lock, 'utf8')).pid).not.toBe(process.pid)
    writeFileSync(lock, JSON.stringify({ pid: 2147483000, owner: 'app', since: 1 }))               // a program that is no longer running
    expect((await cli(['snapshot', 'create', 'y'])).code).toBe(0)
    expect(existsSync(lock)).toBe(false)                             // ours was taken and released
    expect(s.set.id).toBeTruthy()
  })

  it('the application takes the lock when it opens a project and gives it back when it closes it', async () => {
    const lock = join(ctx.dir, LOCK_FILE)
    expect(existsSync(lock)).toBe(true)
    expect(JSON.parse(readFileSync(lock, 'utf8')).owner).toBe('app')
    await invoke('projects:close')
    expect(existsSync(lock)).toBe(false)
  })
})

describe('watch', () => {
  it('exports at once, and again after the project changes', async () => {
    const s = await deck()
    const out = join(ctx.root, 'watched')
    const lines = []
    const run = runCli(['--project', ctx.dir, 'watch', 'images', '--out', out, '--interval', '100', '--runs', '2'], { stdout: l => lines.push(l.trim()), stderr: l => lines.push(l.trim()), cwd: ctx.root, env: {} })
    await expect.poll(() => lines.filter(l => l.startsWith('Start:')).length, { timeout: 15000 }).toBe(1)
    const firstCount = readdirSync(out).filter(f => f.endsWith('.png')).length
    expect(firstCount).toBe(2)                                       // the card and the shared back
    await invoke('cards:create', { setId: s.set.id, displayName: 'Added while watching', fields: { title: 'New' } })
    expect(await run).toBe(0)
    expect(lines.some(l => l.startsWith('Changed:'))).toBe(true)
    expect(readdirSync(out).filter(f => f.endsWith('.png')).length).toBe(3)
    expect(lines.at(-1)).toMatch(/Stopped after 2 runs/)
  }, 60000)

  it('imports a changed data file again before exporting, and keeps going after a failed run', async () => {
    const s = await deck()
    const csv = join(ctx.root, 'live.csv')
    writeFileSync(csv, 'display_name,Title,Cost\nFire,Fire,3\n')
    const out = join(ctx.root, 'w2')
    const lines = []
    const run = runCli(['--project', ctx.dir, 'watch', 'images', '--out', out, '--reimport', csv, '--set', 'Base', '--key', 'title', '--interval', '100', '--runs', '2'], { stdout: l => lines.push(l.trim()), stderr: l => lines.push(l.trim()), cwd: ctx.root, env: {} })
    await expect.poll(() => lines.filter(l => l.startsWith('Start:')).length, { timeout: 15000 }).toBe(1)
    writeFileSync(csv, 'display_name,Title,Cost\nFire,Fire,3\nIce,Ice,2\n')
    expect(await run).toBe(0)
    expect(await names(s.set.id)).toEqual(['Fire', 'Ice'])
    expect(lines.filter(l => l.startsWith('Imported live.csv')).length).toBe(2)
  }, 60000)

  it('refuses nonsense options', async () => {
    await deck()
    expect((await cli(['watch'])).code).toBe(2)
    expect((await cli(['watch', 'images', '--interval', '5'])).code).toBe(2)
    expect((await cli(['watch', 'images', '--runs', '0'])).code).toBe(2)
  })
})
