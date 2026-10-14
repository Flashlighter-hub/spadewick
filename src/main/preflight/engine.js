/**
 * The print preflight (PRD §17.7): a checklist that runs before a production export and says, for every finding, which card and
 * which element, and what to do. Findings are grouped (a problem many cards share is one line with the cards listed), with a
 * severity: error (the file would be wrong; blocks the export unless the person insists), warning, or information.
 *
 * It uses what is already known: the text check (missing icons and characters, text that does not fit, fonts that forbid
 * embedding) and the text step's own report (sizes and where text is drawn), the template (strokes, pictures, transparency), and a
 * small drawing of each card converted to the output profile (ink, colours out of range, the edge that becomes the bleed).
 *
 *   type            severity            what
 *   noBleed         error               the export has no bleed
 *   backMissing     error               no card back is chosen
 *   backFile        error               the card back picture is gone
 *   backShape       error               the back picture is not the shape of the card
 *   backSome        warning             some cards have no card back (a plain colour is printed on them)
 *   backPlain       info                no card has a card back: a plain colour is printed
 *   missingImage    error               a picture a card or template uses is gone
 *   imageLowRes     warning / error     a picture below the resolution at its placed size
 *   missingIcon, missingGlyph, noFit, cardError   error   from the text check
 *   fontForbids     warning             a font whose own flag forbids embedding
 *   safeArea        warning             text or an icon outside the safe area
 *   textSmall       warning             text under the minimum size (reversed text has its own)
 *   blackText       warning             small pure-black text that will print as a rich black
 *   strokeThin      warning             a stroke thinner than the minimum
 *   inkLimit        warning             total ink above the limit (it is reduced)
 *   edgeNotPlain    warning             the edge that is extended into the bleed is not plain (or has transparent corners)
 *   dieLineMissing  warning             a die line is required and none is chosen
 *   settings        error               the settings contradict each other (marks over the bleed, a safe area bigger than the card, …)
 *   profileMissing  error               the output profile is gone
 *   outOfGamut      info                colours the press cannot print
 *   transparency    info                an element that needs transparency (flattened in this output)
 *   bleedCarried    info                the template's own bleed is smaller than the export's and is carried further
 *   fileSize        info                the file will be large
 */
import sharp from 'sharp'
import { join } from 'path'
import { existsSync } from 'fs'
import { dbOf, dirOf } from '../core/context.js'
import * as textCheck from '../core/textCheck.js'
import { normalizeProduction } from '../production/settings.js'
import { collect, printColorList, openConverter, backKey } from '../production/engine.js'
import { effectiveBackTemplateId } from '../render.js'
import { drawsTheSameOnEveryCard } from '../core/export.js'
import { renderFront, toInk, pixelBox } from '../production/raster.js'
import { proofImage, outOfGamut } from '../colour/lcms.js'
import { analyzeTemplate, isPureBlack, isLight } from './static.js'
import { normalizeMinimums } from './settings.js'
import { deckProblem } from '../../shared/presets.js'
import { tr } from '../../shared/i18n.js'

const PT_PER_MM = 72 / 25.4
const SEVERITY = { noBleed: 'error', backMissing: 'error', backSome: 'warning', backPlain: 'info', backFile: 'error', backShape: 'error', missingImage: 'error', missingIcon: 'error', missingGlyph: 'error', noFit: 'error', cardError: 'error', settings: 'error', profileMissing: 'error',
  imageLowRes: 'warning', fontForbids: 'warning', safeArea: 'warning', textSmall: 'warning', blackText: 'warning', strokeThin: 'warning', inkLimit: 'warning', edgeNotPlain: 'warning', dieLineMissing: 'warning',
  deckSize: 'warning', presetSize: 'warning', presetProfile: 'warning',
  outOfGamut: 'info', transparency: 'info', bleedCarried: 'info', fileSize: 'info', presetUnverified: 'info', presetVector: 'info' }
const MAX_CARDS_LISTED = 200
const PROBE_DPI = 100            // the cards are drawn small for the colour checks
const OUT_OF_RANGE_NOTE_PCT = 0.5

const round1 = n => Math.round(n * 10) / 10
const round2 = n => Math.round(n * 100) / 100

/** The edge of the drawn card: how much of the outermost pixel ring is transparent (rounded corners), and how busy it is. */
async function edgeInfo(png) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const w = info.width, h = info.height
  let ring = 0, transparent = 0
  const colours = new Set()
  const visit = (x, y) => {
    const i = (y * w + x) * 4
    ring++
    if (data[i + 3] < 250) transparent++
    else colours.add(((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4))
  }
  for (let x = 0; x < w; x++) { visit(x, 0); visit(x, h - 1) }
  for (let y = 1; y < h - 1; y++) { visit(0, y); visit(w - 1, y) }
  const opaque = ring - transparent
  return { transparentPct: transparent / ring * 100, colours: opaque > 0 ? colours.size : 0 }
}

/** The pixel size of a picture: from the asset's own record, or read from an embedded data URI. */
async function pictureSize(db, projectDir, href, values, fieldTypes) {
  const asset = id => {
    const row = db.prepare('SELECT filename, width_px, height_px FROM assets WHERE id = ?').get(id)
    if (!row) return { missing: true }
    if (!existsSync(join(projectDir, 'assets', row.filename))) return { missing: true }
    return { w: row.width_px, h: row.height_px }
  }
  const fixed = /^\{\{\s*@asset\.([^}\s]+)\s*\}\}$/.exec(href)
  if (fixed) return { ...asset(fixed[1]), name: fixed[1] }
  const field = /^\{\{\s*([\w-]+)\s*\}\}$/.exec(href)
  if (field) {
    const v = String(values[field[1]] ?? '')
    if (!v) return { empty: true, name: field[1] }
    if (v.startsWith('asset:')) return { ...asset(v.slice(6)), name: field[1] }
    return { empty: true, name: field[1] }
  }
  const data = /^data:image\/[a-z+]+;base64,(.*)$/i.exec(href)
  if (data) { try { const m = await sharp(Buffer.from(data[1], 'base64')).metadata(); return { w: m.width, h: m.height } } catch { return { missing: true } } }
  return { empty: true }
}

/** The dots per inch a picture gets when it is placed in a box. */
function placedPpi(img, pic, unitsPerMm) {
  const sx = img.width / pic.w, sy = img.height / pic.h              // template units per picture pixel on each axis
  const mode = /slice/i.test(img.par) ? Math.max : /none/i.test(img.par) ? Math.max : Math.min
  const unitsPerPx = /none/i.test(img.par) ? Math.max(sx, sy) : mode(sx, sy)
  return 25.4 / (unitsPerPx / unitsPerMm)
}

/**
 * @param {object} ctx
 * @param {object} opts the production settings plus the selection (`setIds`, `cardIds`, `filter`) and, optionally, `minimums`
 * @returns {Promise<{ checked: number, groups: object[], counts: object, minimums: object }>}
 */
export async function run(ctx, opts) {
  opts ??= {}
  const s = normalizeProduction(opts)
  const db = dbOf(ctx), projectDir = dirOf(ctx)
  const mins = normalizeMinimums({ ...getMinimums(ctx), ...(opts.minimums ?? {}) })
  const groups = new Map()
  const note = (type, detail, { card = null, template = null, element = null, severity = null, value = null } = {}) => {
    const key = [type, JSON.stringify(detail), template?.id ?? '', element?.id ?? '', element?.field ?? ''].join('|')
    let g = groups.get(key)
    if (!g) { g = { type, severity: severity ?? SEVERITY[type], detail, template, element, cards: [], count: 0, max: null }; groups.set(key, g) }
    if (value !== null) g.max = g.max === null ? value : Math.max(g.max, value)
    if (card) { g.count++; if (g.cards.length < MAX_CARDS_LISTED) g.cards.push(card) } else g.count = Math.max(g.count, 1)
  }

  const items = collect(db, opts.setIds ?? [], s, opts)
  const templateNames = new Map(db.prepare('SELECT id, name FROM templates').all().map(t => [t.id, t.name]))
  const setNames = new Map(db.prepare('SELECT id, name FROM sets').all().map(r => [r.id, r.name]))
  const infoOf = item => ({ card: { id: item.card.id, name: item.card.display_name, set: setNames.get(item.card.set_id) ?? '' }, template: { id: item.template.id, name: (templateNames.get(item.template.id) ?? '') + (item.back ? ` ${tr('preflight.backTag')}` : '') } })

  // ---- the manufacturer preset that is chosen (PRD §18.4): its rules, and what it could not confirm ----
  const preset = opts.preset ?? null
  if (preset) {
    if (preset.sizeOk === false) note('presetSize', { name: preset.name, sizes: preset.sizes, size: preset.size })
    if (preset.profile && !preset.profile.found) note('presetProfile', { name: preset.name, hint: preset.profile.hint })
    if (preset.verify?.length) note('presetUnverified', { name: preset.name, fields: preset.verify })
    if (preset.needsVector?.length) note('presetVector', { name: preset.name, rules: preset.needsVector })
    const count = s.repeatCopies ? items.reduce((n, i) => n + i.copies, 0) : items.length
    const deck = deckProblem(preset.deck, count)
    if (deck) note('deckSize', { name: preset.name, ...deck })
  }

  // ---- the settings, and what they need ----
  if (s.bleedMm <= 0) note('noBleed', {})
  if (s.safeMm * 2 >= 30) note('settings', { problem: 'safeLarge' })
  if (s.dieRadiusMm > 0 && items.some(i => s.dieRadiusMm * 2 >= Math.min(i.trim.w, i.trim.h))) note('settings', { problem: 'dieRadius' })
  if ((s.cropMarks || s.registrationMarks) && s.marksMarginMm < 6) note('settings', { problem: 'marksMargin' })
  if (mins.requireDieLine && s.dieLine === 'none') note('dieLineMissing', {})
  let converter = null
  if (s.colour === 'cmyk') {
    try { converter = (await openConverter(ctx, s)).converter } catch (err) { note('profileMissing', { message: err.message }) }
  }
  // the card back
  const backItems = []                                   // the set's card backs, to be checked as the fronts are (one of each, or one per card when a back shows the card's data)
  if (s.cardBack === 'template') {
    const seen = new Set()
    let without = 0
    for (const item of items) {
      const id = effectiveBackTemplateId(db, item.card)
      if (!id) { without++; continue }
      const key = backKey(db, s, item)
      if (seen.has(key)) continue
      seen.add(key)
      backItems.push({ card: item.card, copies: item.copies, trim: item.trim, back: true, template: db.prepare('SELECT * FROM templates WHERE id = ?').get(id) })
    }
    if (without && without === items.length) note('backPlain', {})
    else if (without) note('backSome', { n: without })
  }
  if (s.cardBack === 'none') note('backMissing', {})
  else if (s.cardBack === 'asset') {
    const row = s.cardBackAssetId ? db.prepare('SELECT filename, width_px, height_px FROM assets WHERE id = ?').get(s.cardBackAssetId) : null
    if (!row || !existsSync(join(projectDir, 'assets', row.filename))) note('backFile', {})
    else if (row.width_px && row.height_px && items[0]) {
      const ratio = row.width_px / row.height_px, want = items[0].trim.w / items[0].trim.h
      if (Math.abs(ratio - want) / want > 0.02) note('backShape', { ratio: round2(ratio), want: round2(want) })
    }
  }
  if (!items.length) return finish([], 0)

  // ---- the text check and the text step's report of every card ----
  const staticOf = new Map()
  const staticFor = item => {
    const key = item.template.id
    if (!staticOf.has(key)) {
      const native = item.template.bleed_mode === 'included' ? Number(item.template.bleed_mm) : 0
      staticOf.set(key, analyzeTemplate(item.template.svg_source, { mmW: item.trim.w, mmH: item.trim.h, bleedMm: native, bleedMode: item.template.bleed_mode }, s.safeMm))
      if (item.template.bleed_mode === 'included' && native > 0 && native < s.bleedMm) note('bleedCarried', { have: native, want: s.bleedMm }, { template: { id: item.template.id, name: templateNames.get(item.template.id) ?? '' }, severity: 'info' })
    }
    return staticOf.get(key)
  }
  const byCard = new Map(items.map(i => [i.card.id, i]))
  const ids = items.map(i => i.card.id)
  const tcheck = await textCheck.run(ctx, {
    cardIds: ids,
    onReport: (card, info, report) => {
      const item = info.side === 'back' ? backItems.find(b => b.card.id === card.id && b.template.id === info.template.id) ?? backItems.find(b => b.template.id === info.template.id) : byCard.get(card.id)
      const st = item && staticFor(item)
      if (!st?.ok) return
      for (const f of report.fits ?? []) {
        const el = { id: f.where?.id ?? null, field: f.where?.field ?? null }
        const m = el.id ? st.matrices.get(el.id) : null
        const sc = m ? Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) : 1
        const pt = f.size * sc / st.unitsPerMm * PT_PER_MM
        const light = isLight(f.fill)
        const min = light ? mins.reversedTextPt : mins.textPt
        if (f.size > 0 && pt < min) note('textSmall', { pt: round1(pt), min, reversed: light }, { ...info, element: el })
        if (isPureBlack(f.fill) && pt <= mins.smallBlackPt) note('blackText', { printColor: printColorsHave(ctx, s) }, { ...info, element: el, severity: printColorsHave(ctx, s) ? 'info' : 'warning' })
        const flat = !m || (Math.abs(m[1]) < 1e-9 && Math.abs(m[2]) < 1e-9)
        if (f.extent && !f.rotated && flat) {
          const [l, t, r, b] = f.extent
          const at = (x, y) => (m ? [m[0] * x + m[4], m[3] * y + m[5]] : [x, y])
          const [x0, y0] = at(l, t), [x1, y1] = at(r, b)
          const eps = 0.025 * st.unitsPerMm
          if (Math.min(x0, x1) < st.safe[0] - eps || Math.min(y0, y1) < st.safe[1] - eps || Math.max(x0, x1) > st.safe[2] + eps || Math.max(y0, y1) > st.safe[3] + eps) note('safeArea', {}, { ...info, element: el })
        }
      }
    }
  })
  for (const g of tcheck.groups) {
    if (!['missingIcon', 'missingGlyph', 'noFit', 'cardError', 'fontForbids'].includes(g.type)) continue
    const key = [g.type, JSON.stringify(g.detail), g.template?.id ?? '', g.element?.id ?? '', g.element?.field ?? ''].join('|')
    groups.set(key, { ...g, severity: g.type === 'fontForbids' ? 'warning' : 'error', max: null })
  }

  // ---- the template: strokes and transparency (once per template, with the cards that use it), pictures per card ----
  const used = new Map()
  for (const item of [...items, ...backItems]) { const l = used.get(item.template.id) ?? []; l.push(item); used.set(item.template.id, l) }
  for (const [templateId, list] of used) {
    const st = staticFor(list[0])
    if (!st.ok) continue
    const tmpl = { id: templateId, name: (templateNames.get(templateId) ?? '') + (list[0].back ? ` ${tr('preflight.backTag')}` : '') }
    for (const sk of st.strokes) if (sk.widthPt < mins.strokePt) for (const item of list) note('strokeThin', { widthPt: round2(sk.widthPt), min: mins.strokePt }, { ...infoOf(item), element: { id: sk.id, field: null } })
    for (const t of st.transparency) note('transparency', { kind: t.kind }, { template: tmpl, element: { id: t.id, field: null } })
  }

  // ---- each card: pictures, the edge, ink and colour ----
  const colors = s.colour === 'cmyk' ? printColorList(ctx, s) : []
  const probe = { ...s, dpi: PROBE_DPI }
  let checked = 0
  for (const item of [...items, ...backItems]) {
    const info = infoOf(item)
    const st = staticFor(item)
    const values = { ...JSON.parse(item.card.fields_json || '{}') }
    for (const img of st.ok ? st.images : []) {
      const pic = await pictureSize(db, projectDir, img.href, values)
      if (pic.missing) note('missingImage', { name: pic.name ?? '', where: img.href.startsWith('{{@') ? 'template' : 'card' }, { ...info, element: { id: img.id, field: null } })
      else if (pic.w && pic.h) {
        const ppi = placedPpi(img, pic, st.unitsPerMm)
        if (ppi < mins.ppiWarn) note('imageLowRes', { ppi: Math.round(ppi), min: ppi < mins.ppiError ? mins.ppiError : mins.ppiWarn }, { ...info, element: { id: img.id, field: null }, severity: ppi < mins.ppiError ? 'error' : 'warning' })
      }
    }
    if (converter) {
      try {
        let edge = null
        const r = await renderFront(projectDir, db, item.card, item.trim, probe, item.template, async png => { if (item.template.bleed_mode === 'extend' || !item.template.bleed_mode) edge = await edgeInfo(png) }, item.back ? item.template.id : undefined)
        if (edge && s.bleedMm > 0 && (edge.transparentPct > 0.2 || edge.colours > 12)) note('edgeNotPlain', { reason: edge.transparentPct > 0.2 ? 'transparent' : 'busy' }, { ...info })
        const { cmyk, stats } = toInk(r.rgb, r.size.width, r.size.height, { converter, colors, limit: s.inkLimit })
        if (s.inkLimit && stats.maxInkBefore > s.inkLimit) note('inkLimit', { limit: s.inkLimit }, { ...info, value: stats.maxInkBefore })
        const shown = proofImage(converter, cmyk, r.size.width, r.size.height)
        const gamut = outOfGamut(r.rgb, shown)
        const pct = gamut.count / gamut.mask.length * 100
        if (pct >= OUT_OF_RANGE_NOTE_PCT) note('outOfGamut', {}, { ...info, value: round1(pct) })
      } catch (err) { /* a card that cannot be drawn is reported by the text check */ }
    }
    if (++checked % 10 === 0) await new Promise(r => setImmediate(r))
  }
  if (converter) converter.close()

  // ---- the size of the file ----
  const first = items[0]
  const px = pixelBox(first.trim.w, first.trim.h, s.bleedMm, s.dpi)
  const pages = items.reduce((n, i) => n + i.copies, 0) * (s.cardBack === 'none' ? 1 : s.backLayout === 'once' ? 1 : 2)
  const estimateMb = pages * px.width * px.height * (s.colour === 'rgb' ? 3 : 4) / 4 / 1e6   // flat colour compresses well; a picture does not, so this is a middle
  if (estimateMb > 150) note('fileSize', { mb: Math.round(estimateMb) })

  return finish([...groups.values()], checked)

  function finish(list, count) {
    if (converter && !items.length) converter.close()
    const order = ['error', 'warning', 'info']
    list.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity) || a.type.localeCompare(b.type))
    const counts = { error: 0, warning: 0, info: 0 }
    for (const g of list) counts[g.severity]++
    return { checked: count, groups: list, counts, minimums: mins }
  }
}

const printColorsHave = (ctx, s) => s.usePrintColors && s.colour === 'cmyk' && printColorList(ctx, s).some(c => c.rgb.every(v => v === 0) && c.cmyk && c.cmyk[0] === 0 && c.cmyk[1] === 0 && c.cmyk[2] === 0 && c.cmyk[3] === 100)

// ---- the minimums, kept in the project ----
export function getMinimums(ctx) {
  const row = dbOf(ctx).prepare("SELECT value FROM project_meta WHERE key = 'preflight_minimums'").get()
  try { return normalizeMinimums(row ? JSON.parse(row.value) : {}) } catch { return normalizeMinimums({}) }
}
export function setMinimums(ctx, input) {
  const m = normalizeMinimums(input ?? {})
  dbOf(ctx).prepare("INSERT OR REPLACE INTO project_meta (key, value) VALUES ('preflight_minimums', ?)").run(JSON.stringify(m))
  return m
}
export const defaultMinimums = () => normalizeMinimums({})
