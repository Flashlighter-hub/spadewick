/**
 * The command line as the program it is (PRD §21.6): the built `out/main/cli.js` run as a subprocess, with exit codes, output and
 * start-up time checked. The build is made here when it is not there yet.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { join } from 'path'
import { existsSync, readdirSync } from 'fs'
import { spawnSync } from 'child_process'
import { createTestProject, seedSet, invoke } from '../helpers/project.js'

const CLI = join(process.cwd(), 'out', 'main', 'cli.js')
let ctx

beforeAll(async () => {
  if (!existsSync(CLI)) {
    const r = spawnSync('npx', ['electron-vite', 'build'], { cwd: process.cwd(), shell: true, encoding: 'utf8' })
    if (r.status !== 0) throw new Error(`build failed: ${r.stdout}${r.stderr}`)
  }
  ctx = await createTestProject()
  const s = await seedSet({
    name: 'Base', cardSize: 'poker', fields: [{ name: 'Title', type: 'text' }],
    template: { svg: '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="700"><rect width="500" height="700" fill="#fff"/><text x="20" y="60" font-size="40" data-spadewick-field="title">{{title}}</text></svg>' },
    cards: [{ name: 'Fire', fields: { title: 'Fire' } }]
  })
  await invoke('sets:update', { id: s.set.id, defaultTemplateId: s.template.id })
  await invoke('projects:close')   // the subprocess opens the project file itself
}, 120000)
afterAll(async () => { await ctx.cleanup() })

const run = (args, env = {}) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...process.env, ...env } })

describe('spadewick cli (built program)', () => {
  it('answers version and help quickly, with exit 0', () => {
    const t = Date.now()
    const v = run(['version'])
    expect(v.status).toBe(0)
    expect(v.stdout).toMatch(/^\d+\.\d+\.\d+/)
    expect(Date.now() - t).toBeLessThan(3000)
    expect(run(['help']).stdout).toMatch(/Exit codes/)
  })

  it('uses the exit codes of the documentation', () => {
    expect(run(['nonsense']).status).toBe(2)
    expect(run(['info', '--project', join(ctx.root, 'nowhere')]).status).toBe(3)
    expect(run(['info', '--project', ctx.dir]).status).toBe(0)
  })

  it('prints JSON that can be parsed and exports files', () => {
    const info = run(['info', '--json', '--project', ctx.dir])
    expect(JSON.parse(info.stdout).sets[0].name).toBe('Base')
    const out = join(ctx.root, 'cli-out')
    const r = run(['export', 'images', '--project', ctx.dir, '--out', out])
    expect(r.status, r.stderr).toBe(0)
    expect(readdirSync(out).some(f => f.endsWith('.png'))).toBe(true)
  })

  it('takes the folder of its own presets from SPADEWICK_LIBRARY and never prints a stack trace for a usage error', () => {
    const r = run(['export', 'pdf', '--project', ctx.dir, '--preset', 'nothing'], { SPADEWICK_LIBRARY: join(ctx.root, 'lib') })
    expect(r.status).toBe(2)
    expect(r.stderr).not.toMatch(/\n\s+at /)
  })
})
