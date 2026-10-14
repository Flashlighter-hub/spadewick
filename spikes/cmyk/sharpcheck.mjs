import sharp from 'sharp'
import { PATCHES, flatRgb, openLcms, toCmyk, COMBOS, PROFILES } from './common.mjs'
const ctx = await openLcms(); const rgb = flatRgb(PATCHES)
const png = await sharp(Buffer.from(rgb), { raw: { width: PATCHES.length, height: 1, channels: 3 } }).png().toBuffer()
const { data } = await sharp(png).withIccProfile(PROFILES.isocoated.file, { attach: false }).toColourspace('cmyk').raw().toBuffer({ resolveWithObject: true })
const mine = toCmyk(ctx, rgb, 'isocoated', COMBOS[0]), rel = toCmyk(ctx, rgb, 'isocoated', COMBOS[3])
for (const n of ['white', 'black', 'red', 'grey 50%', 'cyan']) { const i = PATCHES.findIndex(p => p.name === n); console.log(n.padEnd(9), 'sharp', [...data.slice(i*4,i*4+4)].join(','), '| lcms perceptual', [...mine.slice(i*4,i*4+4)].join(','), '| lcms rel+bpc', [...rel.slice(i*4,i*4+4)].join(',')) }
const meta = await sharp(png).withIccProfile(PROFILES.isocoated.file, { attach: false }).toColourspace('cmyk').jpeg().toBuffer()
console.log('cmyk jpeg bytes', meta.length, (await sharp(meta).metadata()).space)
