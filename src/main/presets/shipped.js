/**
 * The manufacturer presets that ship with the application (PRD §18.3), as data. The values come from the manufacturers' public
 * artwork guidance as found on 2026-10-02; manufacturers change their rules, and some pages could not be read in full, so a value
 * that was not stated is named in `verify` and left at a safe default. Every preset is "not proof-tested" (PRD §18.5): the interface
 * says so and tells the person to read the manufacturer's current guide and to order a proof.
 *
 * `guideUrl` is the manufacturer's site, not a page of it: deep links change.
 */
import { PRESET_FORMAT } from '../../shared/presets.js'

const CHECKED = '2026-10-02'
const base = {
  format: PRESET_FORMAT, checkedOn: CHECKED, proofTested: false, sizes: null, profileHint: null, standard: 'plain', backLayout: 'once',
  rules: {}, minimums: {}, deck: null, imageFormat: 'png', pixels: null, verify: [], notes: ''
}
const poker = { forTrimMmW: 63.5, forTrimMmH: 88.9 }
const die = (mode, radiusMm = 3.175, spotName = 'DieCut') => ({ mode, radiusMm, spotName })

export const SHIPPED = [
  { ...base, id: 'tgc-poker', name: 'The Game Crafter, poker', manufacturer: 'The Game Crafter', guideUrl: 'https://www.thegamecrafter.com/', kind: 'images',
    sizes: ['poker'], bleedMm: 3.175, safeMm: 3.175, dpi: 300, colour: 'either', die: die('none'), pixels: { width: 825, height: 1125, ...poker }, verify: ['colour'],
    notes: 'Per-card images of 825 × 1125 px at 300 DPI (trim 750 × 1050). Keep content 1/8 in inside the cut. The colour mode was not stated in what was read.' },
  { ...base, id: 'mpc-poker', name: 'MakePlayingCards, poker', manufacturer: 'MakePlayingCards', guideUrl: 'https://www.makeplayingcards.com/', kind: 'images',
    sizes: ['poker'], bleedMm: 3.048, safeMm: 3.048, dpi: 300, colour: 'rgb', die: die('none'), pixels: { width: 822, height: 1122, ...poker }, verify: ['colour'],
    notes: 'At least 822 × 1122 px at 300 DPI. Their template marks a red safe line 36 px inside the cut and about 36 px is cut from each side. RGB images are converted by the printer.' },
  { ...base, id: 'dtc-poker', name: 'DriveThruCards, poker', manufacturer: 'DriveThruCards', guideUrl: 'https://www.drivethrucards.com/', kind: 'both',
    sizes: ['poker'], bleedMm: 3.175, safeMm: 3.175, dpi: 300, colour: 'either', die: die('none'), pixels: { width: 825, height: 1125, ...poker }, verify: ['colour', 'sizes'],
    notes: 'The final layout is 2.75 × 3.75 in (825 × 1125 px) at 300 DPI. Other card sizes were not stated.' },
  { ...base, id: 'printninja', name: 'PrintNinja, cards', manufacturer: 'PrintNinja', guideUrl: 'https://www.printninja.com/', kind: 'pdf',
    standard: 'x4', backLayout: 'separate', bleedMm: 3, safeMm: 5, dpi: 300, colour: 'cmyk', die: die('spot'), verify: ['bleed', 'safe', 'sizes', 'profile', 'die', 'deck'],
    notes: 'A print-ready CMYK PDF at 300 ppi or more. Bleed is required; its value is on each product page. The tarot safe margin is 5 mm (0.197 in); other products were not read in full.' },
  { ...base, id: 'panda-cards', name: 'Panda Game Manufacturing, cards', manufacturer: 'Panda Game Manufacturing', guideUrl: 'https://www.pandagm.com/', kind: 'pdf',
    standard: 'x4', backLayout: 'separate', bleedMm: 3, safeMm: 3, dpi: 300, colour: 'cmyk', profileHint: 'U.S. Sheetfed Uncoated v2', die: die('spot'),
    rules: { pureBlackText: true, overprintBlack: true }, verify: ['die', 'deck'],
    notes: 'CMYK with the profile U.S. Sheetfed Uncoated v2, which you import (Profiles…). Black text is pure K and set to overprint. Boards and boxes need 18 mm bleed; this preset is for cards.' },
  { ...base, id: 'longpack-cards', name: 'Longpack Games, cards', manufacturer: 'Longpack Games', guideUrl: 'https://www.longpackgames.com/', kind: 'pdf',
    standard: 'x4', backLayout: 'separate', bleedMm: 3, safeMm: 3, dpi: 300, colour: 'cmyk', die: die('spot'), rules: { richBlack: { c: 40, m: 0, y: 0, k: 100 } }, verify: ['dpi', 'die', 'deck', 'profile'],
    notes: 'CMYK. Large black borders are best as C40 M0 Y0 K100. The resolution was not stated.' },
  { ...base, id: 'wingo-cards', name: 'WinGo Games, cards', manufacturer: 'WinGo Games', guideUrl: 'https://www.wingogames.com/', kind: 'pdf',
    standard: 'x4', backLayout: 'separate', bleedMm: 3, safeMm: 3, dpi: 300, colour: 'cmyk', die: die('spot'), verify: ['dpi', 'die', 'deck', 'profile'],
    notes: 'CMYK. 3 mm bleed from the die cut and a 3 mm margin inside it. The resolution was not stated.' },
  { ...base, id: 'generic-offset-metric', name: 'Generic offset printer, metric', manufacturer: 'Any', guideUrl: null, kind: 'pdf',
    standard: 'x4', backLayout: 'separate', bleedMm: 3, safeMm: 3, dpi: 300, colour: 'cmyk', die: die('spot'), rules: { inkLimit: 300 },
    notes: 'A safe default when your manufacturer is not listed: 3 mm bleed and safe margin, 300 ppi (600 for fine line art), CMYK, PDF/X-4.' },
  { ...base, id: 'generic-print-us', name: 'Generic print service, US', manufacturer: 'Any', guideUrl: null, kind: 'both',
    standard: 'plain', backLayout: 'once', bleedMm: 3.175, safeMm: 3.175, dpi: 300, colour: 'either', die: die('none'),
    notes: 'A safe default for US print-on-demand services: 1/8 in bleed and safe margin, 300 DPI, CMYK or RGB as the service asks.' }
]
