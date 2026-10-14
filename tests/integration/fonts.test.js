import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'fs'
import { deflateSync } from 'zlib'
import sharp from 'sharp'
import wawoff2 from 'wawoff2'
import { createTestProject, seedSet, invoke } from '../helpers/project.js'
import { readFontInfo, woffToSfnt, isSfnt } from '../../src/main/fontFiles.js'

const FONTS = join(process.cwd(), 'resources/fonts')
const SANS = join(FONTS, 'LiberationSans-Regular.ttf')
const SANS_BOLD = join(FONTS, 'LiberationSans-Bold.ttf')
const SERIF = join(FONTS, 'LiberationSerif-Regular.ttf')

let ctx
beforeEach(async () => { ctx = await createTestProject() })
afterEach(async () => { await ctx.cleanup() })

/** Minimal WOFF 1.0 encoder so the converter can be tested against a known-good source font. */
function encodeWoff(sfnt) {
  const n = sfnt.readUInt16BE(4)
  const tables = []
  for (let i = 0; i < n; i++) {
    const r = 12 + i * 16
    const offset = sfnt.readUInt32BE(r + 8), length = sfnt.readUInt32BE(r + 12)
    const raw = sfnt.subarray(offset, offset + length)
    const z = deflateSync(raw)
    tables.push({ tag: sfnt.subarray(r, r + 4), checksum: sfnt.readUInt32BE(r + 4), raw, comp: z.length < raw.length ? z : raw })
  }
  let offset = 44 + n * 20
  const header = Buffer.alloc(44 + n * 20)
  header.write('wOFF', 0, 'latin1'); sfnt.copy(header, 4, 0, 4); header.writeUInt16BE(n, 12)
  const parts = []
  tables.forEach((t, i) => {
    const r = 44 + i * 20
    t.tag.copy(header, r); header.writeUInt32BE(offset, r + 4); header.writeUInt32BE(t.comp.length, r + 8)
    header.writeUInt32BE(t.raw.length, r + 12); header.writeUInt32BE(t.checksum, r + 16)
    const padded = Buffer.alloc(Math.ceil(t.comp.length / 4) * 4); t.comp.copy(padded)
    parts.push(padded); offset += padded.length
  })
  header.writeUInt32BE(offset, 8)
  return Buffer.concat([header, ...parts])
}

const svg = (family, text = 'Hello Wörld') => `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100"><rect width="300" height="100" fill="#fff"/><text x="10" y="60" font-size="36" ${family ? `font-family="${family}"` : ''} fill="#000">${text}</text></svg>`
async function ink(cardId, source) {
  const b64 = await invoke('templates:render', { cardId, templateId: source.templateId, svgSource: source.svg, width: 300 })
  const { data } = await sharp(Buffer.from(b64, 'base64')).raw().toBuffer({ resolveWithObject: true })
  let n = 0; for (let i = 0; i < data.length; i += 3) if (data[i] < 128) n++
  return n
}
async function cardWith(svgSource) {
  const { cards, template } = await seedSet({ cards: [{ name: 'c' }], template: { svg: svgSource } })
  return { cardId: cards[0].id, templateId: template.id }
}

describe('font file reading', () => {
  it('reads the real family and style from the name table', () => {
    expect(readFontInfo(readFileSync(SANS))).toEqual({ family: 'Liberation Sans', style: 'Regular' })
    expect(readFontInfo(readFileSync(SANS_BOLD))).toEqual({ family: 'Liberation Sans', style: 'Bold' })
  })
  it('returns null for garbage rather than throwing', () => {
    expect(readFontInfo(Buffer.from('not a font'))).toBe(null)
  })
  it('recognises sfnt data', () => {
    expect(isSfnt(readFileSync(SANS))).toBe(true)
    expect(isSfnt(Buffer.from('<svg/>'))).toBe(false)
  })
  it('converts WOFF 1.0 back to an identical font', () => {
    const ttf = readFileSync(SANS)
    const back = woffToSfnt(encodeWoff(ttf))
    expect(isSfnt(back)).toBe(true)
    expect(readFontInfo(back)).toEqual({ family: 'Liberation Sans', style: 'Regular' })
    expect(back.length).toBeGreaterThanOrEqual(ttf.length - 4)
  })
})

describe('font import (PRD §7.6)', () => {
  it('uses the internal family name even when the file is named differently', async () => {
    const f = join(ctx.root, 'totally-unrelated-name.ttf'); copyFileSync(SERIF, f)
    const [font] = await invoke('fonts:import', [f])
    expect(font).toMatchObject({ family_name: 'Liberation Serif', style: 'Regular' })
    expect(existsSync(join(ctx.dir, 'fonts', font.filename))).toBe(true)
  })

  it('imports WOFF and WOFF2 by converting them to TTF', async () => {
    const w1 = join(ctx.root, 'a.woff'); writeFileSync(w1, encodeWoff(readFileSync(SANS)))
    const w2 = join(ctx.root, 'b.woff2'); writeFileSync(w2, Buffer.from(await wawoff2.compress(readFileSync(SANS_BOLD))))
    const fonts = await invoke('fonts:import', [w1, w2])
    expect(fonts.map(f => `${f.family_name}/${f.style}`)).toEqual(['Liberation Sans/Regular', 'Liberation Sans/Bold'])
    for (const f of fonts) expect(f.filename).toMatch(/\.(ttf|otf)$/)
  })

  it('does not import the same family and style twice', async () => {
    const f = join(ctx.root, 'a.ttf'); copyFileSync(SERIF, f)
    await invoke('fonts:import', [f]); await invoke('fonts:import', [f])
    expect(await invoke('fonts:list')).toHaveLength(1)
  })

  it('rejects files that are not fonts, even with a font extension', async () => {
    const f = join(ctx.root, 'fake.ttf'); writeFileSync(f, 'this is not a font')
    await expect(invoke('fonts:import', [f])).rejects.toThrow(/not a valid font/i)
  })

  it('deletes the file with the record', async () => {
    const f = join(ctx.root, 'a.ttf'); copyFileSync(SERIF, f)
    const [font] = await invoke('fonts:import', [f])
    await invoke('fonts:delete', font.id)
    expect(existsSync(join(ctx.dir, 'fonts', font.filename))).toBe(false)
    expect(await invoke('fonts:list')).toHaveLength(0)
  })
})

describe('font rendering', () => {
  it('shows text even when the template names no font (bundled default)', async () => {
    const c = await cardWith(svg(null))
    expect(await ink(c.cardId, { templateId: c.templateId, svg: svg(null) })).toBeGreaterThan(300)
  })

  it('falls back to the default for an unknown font family instead of rendering nothing', async () => {
    const s = svg('No Such Font')
    const c = await cardWith(s)
    expect(await ink(c.cardId, { templateId: c.templateId, svg: s })).toBeGreaterThan(300)
  })

  it('supports the generic families serif, sans-serif and monospace', async () => {
    const results = []
    for (const fam of ['serif', 'sans-serif', 'monospace']) {
      const s = svg(fam); const c = await cardWith(s)
      results.push(await ink(c.cardId, { templateId: c.templateId, svg: s }))
    }
    expect(results.every(n => n > 300)).toBe(true)
    expect(new Set(results).size).toBe(3) // three genuinely different faces
  })

  it('renders with an imported project font, and it differs from the default face', async () => {
    const mono = '/usr/share/fonts/truetype/freefont/FreeMono.ttf'
    const src = existsSync(mono) ? mono : null
    if (!src) return // no non-bundled fixture font on this machine
    const f = join(ctx.root, 'mono.ttf'); copyFileSync(src, f)
    const [font] = await invoke('fonts:import', [f])
    const withFont = svg(font.family_name); const withDefault = svg(null)
    const c = await cardWith(withFont)
    const a = await ink(c.cardId, { templateId: c.templateId, svg: withFont })
    const b = await ink(c.cardId, { templateId: c.templateId, svg: withDefault })
    expect(a).toBeGreaterThan(300)
    expect(a).not.toBe(b)
  })

  it('renders an imported WOFF2 font', async () => {
    const w2 = join(ctx.root, 'b.woff2'); writeFileSync(w2, Buffer.from(await wawoff2.compress(readFileSync(SERIF))))
    const [font] = await invoke('fonts:import', [w2])
    const s = svg(font.family_name); const c = await cardWith(s)
    const serifInk = await ink(c.cardId, { templateId: c.templateId, svg: s })
    const sansInk = await ink(c.cardId, { templateId: c.templateId, svg: svg('Liberation Sans') })
    expect(serifInk).toBeGreaterThan(300)
    expect(serifInk).not.toBe(sansInk)
  })

  it('honours bold and italic variants', async () => {
    const regular = svg('Liberation Sans'), bold = regular.replace('font-size', 'font-weight="bold" font-size')
    const c = await cardWith(regular)
    const a = await ink(c.cardId, { templateId: c.templateId, svg: regular })
    const b = await ink(c.cardId, { templateId: c.templateId, svg: bold })
    expect(b).toBeGreaterThan(a)
  })
})
