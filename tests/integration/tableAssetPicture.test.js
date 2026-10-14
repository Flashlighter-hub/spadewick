/**
 * The picture of a library image that the host of a shared table sends to a guest (PRD §22.0, step 4): small, a PNG, whatever the file was.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import sharp from 'sharp'
import { createTestProject, invoke, makePng, writeText } from '../helpers/project.js'

let ctx
beforeEach(async () => { ctx = await createTestProject() })
afterEach(async () => { await ctx.cleanup() })

const decode = async picture => sharp(Buffer.from(picture.data, 'base64')).metadata()

describe('table:asset-picture', () => {
  it('gives a PNG no larger than asked, whatever the file is, and never the file itself', async () => {
    const [big] = await invoke('assets:import', [await makePng(join(ctx.root, 'big.png'), 1200, 800, '#2288cc')])
    const picture = await invoke('table:asset-picture', { id: big.id, width: 200 })
    expect(picture.mime).toBe('image/png')
    const meta = await decode(picture)
    expect(meta.format).toBe('png')
    expect(Math.max(meta.width, meta.height)).toBe(200)
    expect(picture.data.length).toBeLessThan(20000)
    const small = await invoke('table:asset-picture', { id: big.id, width: 99999 })
    expect(Math.max((await decode(small)).width, (await decode(small)).height)).toBe(600)       // at most 600 whatever is asked
    expect(Math.max((await decode(await invoke('table:asset-picture', { id: big.id }))).width, 0)).toBe(300)
  })

  it('draws a vector image as a picture', async () => {
    writeText(join(ctx.root, 'disc.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50" viewBox="0 0 50 50"><circle cx="25" cy="25" r="20" fill="#cc3333"/></svg>')
    const [disc] = await invoke('assets:import', [join(ctx.root, 'disc.svg')])
    const picture = await invoke('table:asset-picture', { id: disc.id, width: 100 })
    expect((await decode(picture)).format).toBe('png')
  })

  it('gives nothing for an image that is gone, an id that is not one, or a file that is not a picture', async () => {
    const [img] = await invoke('assets:import', [await makePng(join(ctx.root, 'x.png'))])
    await invoke('assets:delete', img.id)
    expect(await invoke('table:asset-picture', { id: img.id })).toBe(null)
    expect(await invoke('table:asset-picture', { id: 'no-such' })).toBe(null)
    expect(await invoke('table:asset-picture', {})).toBe(null)
    expect(await invoke('table:asset-picture', { id: "' OR 1=1 --" })).toBe(null)
  })
})
