// Fonts used by the spike: bundled Liberation (as in the app) plus OFL fonts for the hard cases.
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
const here = dirname(fileURLToPath(import.meta.url))
const lib = join(here, '../../resources/fonts')
const loc = join(here, 'fonts')
export const FONTS = {
  lato:      { file: join(loc, 'Lato-Regular.ttf'),            family: 'Lato' },
  latoBold:  { file: join(loc, 'Lato-Bold.ttf'),               family: 'Lato', weight: 700 },
  garamond:  { file: join(loc, 'EBGaramond-Variable.ttf'),     family: 'EB Garamond' },
  arabic:    { file: join(loc, 'NotoSansArabic-Regular.ttf'),  family: 'Noto Sans Arabic' },
  hebrew:    { file: join(loc, 'NotoSansHebrew-Regular.ttf'),  family: 'Noto Sans Hebrew' },
  liberation:{ file: join(lib, 'LiberationSans-Regular.ttf'),  family: 'Liberation Sans' }
}
export const allFontFiles = () => Object.values(FONTS).map(f => f.file)
