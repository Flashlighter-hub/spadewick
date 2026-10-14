/**
 * What the canvas editor writes for gradients, shadows, blur, blend modes and stroke options (A80) really draws, in the card pipeline:
 * on shapes, and on text (which the text engine turns into paths).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import sharp from 'sharp'
import { createTestProject, seedSet, invoke } from '../helpers/project.js'

let ctx
beforeEach(async () => { ctx = await createTestProject() })
afterEach(async () => { await ctx.cleanup() })

const doc = (defs, inner) => `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="280" viewBox="0 0 200 280"><defs>${defs}</defs><rect width="200" height="280" fill="#ffffff"/>${inner}</svg>`
const render = async svg => {
  const { cards } = await seedSet({ fields: [{ name: 'Name', type: 'text' }], cards: [{ name: 'a', fields: { name: 'MMMM' } }], template: { svg } })
  return Buffer.from(await invoke('templates:render', { cardId: cards[0].id, width: 200 }), 'base64')
}
const pixelAt = async (buf, x, y) => {
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true })
  const i = (y * info.width + x) * info.channels
  return [data[i], data[i + 1], data[i + 2]]
}
const GRAD = '<linearGradient id="grad_a" x1="0" y1="0.5" x2="1" y2="0.5"><stop offset="0%" stop-color="#ff0000"/><stop offset="100%" stop-color="#0000ff"/></linearGradient>'

describe('gradients, shadows and blend modes in the card pipeline', () => {
  it('a gradient fills a shape from one colour to the other', async () => {
    const buf = await render(doc(GRAD, '<rect data-spadewick-id="a" x="20" y="20" width="160" height="100" fill="url(#grad_a)"/>'))
    const left = await pixelAt(buf, 24, 70), right = await pixelAt(buf, 176, 70)
    expect(left[0]).toBeGreaterThan(200); expect(left[2]).toBeLessThan(60)
    expect(right[2]).toBeGreaterThan(200); expect(right[0]).toBeLessThan(60)
  })

  it('a gradient fills text as one shape, across the whole word (the text engine keeps the fill)', async () => {
    const svg = doc(GRAD.replace('grad_a', 'grad_t'), '<text data-spadewick-id="t" data-spadewick-field="name" x="10" y="20" width="180" height="120" font-size="80" font-weight="bold" fill="url(#grad_t)">{{name}}</text>')
    const buf = await render(svg)
    const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true })
    // collect the non-white pixels in the left and right thirds of the text: the left is red-ish, the right blue-ish
    const avg = (x0, x1) => {
      let r = 0, b = 0, n = 0
      for (let y = 20; y < 140; y++) for (let x = x0; x < x1; x++) { const i = (y * info.width + x) * info.channels; if (data[i] + data[i + 1] + data[i + 2] < 600) { r += data[i]; b += data[i + 2]; n++ } }
      return { r: r / Math.max(n, 1), b: b / Math.max(n, 1), n }
    }
    const left = avg(10, 70), right = avg(130, 190)
    expect(left.n).toBeGreaterThan(50); expect(right.n).toBeGreaterThan(50)
    expect(left.r).toBeGreaterThan(left.b)
    expect(right.b).toBeGreaterThan(right.r)
  })

  it('a drop shadow darkens the card beside the shape, and a blur softens its edge', async () => {
    const shadow = '<filter id="fx_a" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="12" dy="12" stdDeviation="0" flood-color="#000000" flood-opacity="1"/></filter>'
    const withShadow = await render(doc(shadow, '<rect data-spadewick-id="a" x="40" y="40" width="60" height="60" fill="#ff0000" filter="url(#fx_a)"/>'))
    expect(await pixelAt(withShadow, 108, 108)).toEqual([0, 0, 0])            // inside the offset copy, outside the shape
    expect(await pixelAt(withShadow, 60, 60)).toEqual([255, 0, 0])
    const blur = '<filter id="fx_a" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur in="SourceGraphic" stdDeviation="6"/></filter>'
    const blurred = await render(doc(blur, '<rect data-spadewick-id="a" x="40" y="40" width="60" height="60" fill="#ff0000" filter="url(#fx_a)"/>'))
    const edge = await pixelAt(blurred, 40, 70)
    expect(edge[1]).toBeGreaterThan(60); expect(edge[1]).toBeLessThan(220)      // neither the full red nor the white
  })

  it('a blend mode in the style changes how the element mixes with what is under it', async () => {
    const svg = doc('', '<rect x="20" y="20" width="100" height="100" fill="#ffff00"/><rect data-spadewick-id="a" x="60" y="60" width="100" height="100" fill="#00ffff" style="mix-blend-mode:multiply"/>')
    expect(await pixelAt(await render(svg), 80, 80)).toEqual([0, 255, 0])      // yellow times cyan
  })

  it('stroke options draw: a dashed outline has gaps, a solid one has none', async () => {
    const dashed = await render(doc('', '<rect data-spadewick-id="a" x="20" y="20" width="160" height="100" fill="none" stroke="#000000" stroke-width="6" stroke-dasharray="18 12" stroke-linecap="butt"/>'))
    const solid = await render(doc('', '<rect data-spadewick-id="a" x="20" y="20" width="160" height="100" fill="none" stroke="#000000" stroke-width="6"/>'))
    const row = async buf => { const out = []; for (let x = 24; x < 170; x++) out.push((await pixelAt(buf, x, 20))[0] < 128); return out }
    const d = await row(dashed), s = await row(solid)
    expect(s.every(Boolean)).toBe(true)
    expect(d.some(v => !v)).toBe(true)
    expect(d.some(Boolean)).toBe(true)
  })
})
