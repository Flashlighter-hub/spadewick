/**
 * A render that fails leaves, in the log, what it was drawing (a failure that cannot be repeated can then be understood from the log).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createTestProject, seedSet, invoke } from '../helpers/project.js'
import { setLogsDir } from '../../src/main/log.js'

let ctx, logs
beforeEach(async () => { ctx = await createTestProject(); logs = mkdtempSync(join(tmpdir(), 'spadewick-logs-')); setLogsDir(logs) })
afterEach(async () => { setLogsDir(null); rmSync(logs, { recursive: true, force: true }); await ctx.cleanup() })

describe('the log of a failed render', () => {
  it('names the card, the template, the text elements and the fonts, and still gives the error to the caller', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="700"><text x="10" y="50" font-size="30" font-family="Georgia" data-spadewick-text-fit="shrink" width="200" height="80">{{title}}</text></svg>'
    const s = await seedSet({ fields: [{ name: 'Title', type: 'text' }], cards: [{ fields: { title: 'Hello' } }], template: { svg } })
    await expect(invoke('templates:render', { cardId: s.cards[0].id, width: 100, svgSource: '<svg' })).rejects.toThrow()
    const text = readFileSync(join(logs, 'spadewick.log'), 'utf8')
    const line = text.split('\n').find(l => l.includes('[templates:render:context]'))
    expect(line).toBeTruthy()
    const info = JSON.parse(line.slice(line.indexOf('] ') + 2))
    expect(info).toMatchObject({ bundledFontsPresent: true, projectFonts: [], svgLength: 4 })
    expect(info.card.fields.title).toBe('Hello')
    await expect(invoke('templates:text-report', { cardId: 'no-such-card', svgSource: '<svg' })).rejects.toThrow()
    expect(readFileSync(join(logs, 'spadewick.log'), 'utf8').split('[templates:render:context]').length).toBeGreaterThan(2)
  })
})
