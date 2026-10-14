/**
 * The example designs that ship with the program (PRD §7.7.1): each one can be used to start a set,
 * and every sample card it brings draws something. Set SPADEWICK_STARTER_PNG_DIR to also save the pictures.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { mkdirSync, writeFileSync } from 'fs'
import sharp from 'sharp'
import { createTestProject, invoke } from '../helpers/project.js'

let ctx
beforeEach(async () => { ctx = await createTestProject() })
afterEach(async () => { await ctx.cleanup() })

const DESIGNS = [
  { id: 'example-quest', size: 'poker' },
  { id: 'example-action-card', size: 'poker' },
  { id: 'example-tarot-arch', size: 'tarot' },
  { id: 'example-tarot-oracle', size: 'tarot' }
]

describe('the example designs', () => {
  it('are in the library with a picture each', async () => {
    const { starters } = await invoke('templatelib:list')
    for (const d of DESIGNS) {
      const s = starters.find(x => x.id === d.id)
      expect(s, d.id).toBeTruthy()
      expect(s.cardSize.id).toBe(d.size)
    }
  })

  for (const d of DESIGNS) {
    it(`${d.id} makes a set whose sample cards all draw`, async () => {
      const out = await invoke('templatelib:use', { kind: 'starter', id: d.id, newSetName: 'Try', includeSampleCards: true })
      expect(out.newSet.card_size).toBe(d.size)
      const cards = await invoke('cards:list', out.setId)
      expect(cards.length).toBeGreaterThan(0)
      for (const card of cards) {
        const buf = Buffer.from(await invoke('templates:render', { cardId: card.id, width: 500 }), 'base64')
        const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true })
        expect(info.width).toBe(500)
        let distinct = new Set()
        for (let i = 0; i < data.length; i += info.channels * 997) distinct.add(data[i] + ',' + data[i + 1] + ',' + data[i + 2])
        expect(distinct.size, card.name).toBeGreaterThan(5)
        const dir = process.env.SPADEWICK_STARTER_PNG_DIR
        if (dir) { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, `${d.id}-${card.id}.png`), buf) }
      }
    })
  }
})
