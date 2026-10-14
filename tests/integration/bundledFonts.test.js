import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { BUNDLED_FACES, bundledFamilies, bundledFontsDir, defaultFontFiles } from '../../src/main/fontFiles.js'
import { loadHarfBuzz } from '../../src/main/text/hb.js'
import { createFontSet } from '../../src/main/text/fonts.js'

/** The open-licence families that come with the application (resources/fonts/extra). */
const dir = bundledFontsDir()
const extra = join(dir, 'extra')

describe('the bundled extra fonts', () => {
  it('are 40 to 60 families, every face file exists, and every family has a licence that is the OFL or the Apache licence', () => {
    const families = bundledFamilies().filter(f => !/^(Liberation|Noto Sans (Arabic|Hebrew))/.test(f))
    expect(families.length).toBeGreaterThanOrEqual(40)
    expect(families.length).toBeLessThanOrEqual(60)
    for (const face of BUNDLED_FACES) expect(existsSync(join(dir, face.file)), face.file).toBe(true)
    for (const folder of readdirSync(extra, { withFileTypes: true }).filter(e => e.isDirectory())) {
      const licence = readdirSync(join(extra, folder.name)).find(n => /^(OFL|LICENSE)\.txt$/i.test(n))
      expect(licence, `${folder.name} has a licence file`).toBeTruthy()
      expect(readFileSync(join(extra, folder.name, licence), 'utf8'), folder.name).toMatch(/SIL OPEN FONT LICENSE|Apache License/i)
    }
  })

  it('are found by the text engine by family name, and the drawing engine is given only the ones a design names', async () => {
    const hb = await loadHarfBuzz()
    const fonts = createFontSet(hb, { bundledDir: dir })
    for (const name of ['Cinzel', 'Alegreya', 'Roboto', 'Orbitron']) expect(fonts.hasFamily(name), name).toBe(true)
    const plain = defaultFontFiles()
    const named = defaultFontFiles('<text font-family="Cinzel">x</text>')
    expect(named.length).toBe(plain.length + BUNDLED_FACES.filter(f => f.family === 'Cinzel').length)
  })
})
