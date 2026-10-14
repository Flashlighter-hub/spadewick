// Copies open-licence font families from a local clone of the Google Fonts repository (github.com/google/fonts, a sparse checkout of the
// families below is enough) into resources/fonts/extra/<family>/, with each family's licence file, and writes resources/fonts/extra/manifest.json
// (family, style, file) for the application. Only families whose licence text is the SIL Open Font License or the Apache License are kept.
// Run: node scripts/fetch-fonts.mjs <path of the clone>
import { mkdirSync, writeFileSync, rmSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { readFontInfo } from '../src/main/fontFiles.js'

const OUT = 'resources/fonts/extra'
const FAMILIES = [
  // fantasy and display
  'cinzel', 'cinzeldecorative', 'uncialantiqua', 'metamorphous', 'almendra', 'imfelldoublepica', 'pirataone', 'grenzegotisch', 'eaglelake', 'macondo', 'caudex', 'unifrakturcook', 'newrocker', 'bevan', 'creepster',
  // serif
  'alegreya', 'alegreyasc', 'lora', 'merriweather', 'ebgaramond', 'cormorantgaramond', 'crimsonpro', 'librebaskerville', 'playfairdisplay', 'spectral', 'fraunces', 'cardo',
  // sans
  'roboto', 'opensans', 'lato', 'montserrat', 'oswald', 'raleway', 'firasans', 'sourcesans3', 'notosans', 'nunito', 'worksans', 'barlowcondensed', 'bebasneue', 'anton',
  // hand and fun
  'caveat', 'kalam', 'specialelite', 'bangers', 'permanentmarker', 'amaticsc', 'patrickhand',
  // science fiction and mono
  'orbitron', 'exo2', 'audiowide', 'sharetechmono', 'firacode', 'michroma', 'russoone'
]
const CLONE = process.argv[2]
if (!CLONE) throw new Error('give the folder of the google/fonts clone')
const APACHE = new Set(['specialelite', 'permanentmarker'])   // these live in the repository's apache/ folder

const pickFiles = names => {
  const fonts = names.filter(n => /\.(ttf|otf)$/i.test(n))
  const staticFaces = fonts.filter(n => !n.includes('[') && /-(Regular|Bold|Italic|BoldItalic)\.(ttf|otf)$/i.test(n))
  if (staticFaces.length) return staticFaces
  // variable fonts: the file's default instance is the regular face; the italic file is the italic
  const variable = fonts.filter(n => n.includes('['))
  return [variable.find(n => !/italic/i.test(n)), variable.find(n => /italic/i.test(n))].filter(Boolean)
}

rmSync(OUT, { recursive: true, force: true })
const manifest = []
const kept = [], skipped = []
for (const dir of FAMILIES) {
  try {
    const root = join(CLONE, APACHE.has(dir) ? 'apache' : 'ofl', dir)
    const names = readdirSync(root)
    const licenceName = names.find(n => /^(OFL|LICENSE)\.txt$/i.test(n))
    if (!licenceName) throw new Error('no licence file')
    const licence = readFileSync(join(root, licenceName), 'utf8')
    if (!/SIL OPEN FONT LICENSE|Apache License/i.test(licence)) throw new Error('licence is not OFL or Apache')
    const files = pickFiles(names)
    if (!files.length) throw new Error('no font files')
    mkdirSync(join(OUT, dir), { recursive: true })
    writeFileSync(join(OUT, dir, licenceName), licence)
    for (const f of files) {
      const data = readFileSync(join(root, f))
      const info = readFontInfo(data)
      if (!info) { console.log('  unreadable', f); continue }
      writeFileSync(join(OUT, dir, f), data)
      manifest.push({ family: info.family, style: info.style, file: `extra/${dir}/${f}` })
    }
    kept.push(dir)
  } catch (err) { skipped.push(`${dir}: ${err.message}`) }
}
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1))
console.log(`kept ${kept.length} families, ${manifest.length} faces`)
console.log('skipped:', skipped)
