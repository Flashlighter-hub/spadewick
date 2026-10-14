/**
 * Manufacturer presets (PRD §18): the shipped ones (read only) and the person's own (duplicated, edited, imported), which are JSON
 * files in the library folder of the application, shared by every project. `apply` turns a preset into the settings of the export.
 */
import { join, basename } from 'path'
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'fs'
import { SHIPPED } from '../presets/shipped.js'
import { validatePreset, isStale, ageDays, duplicate as duplicatePreset, PRESET_FORMAT } from '../../shared/presets.js'
import { getCardSize } from '../cardSize.js'
import { dbOf } from './context.js'
import * as profiles from './profiles.js'
import { tr } from '../../shared/i18n.js'

const dirOf = ctx => {
  const root = ctx.settings.get('library_dir')
  if (!root) throw new Error(tr('library.noLibraryFolder'))
  const dir = join(root, 'presets')
  mkdirSync(dir, { recursive: true })
  return dir
}
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'preset'

const decorate = (p, shipped, now = new Date()) => ({ ...p, shipped, stale: isStale(p.checkedOn, now), ageDays: ageDays(p.checkedOn, now) })

/**
 * Every preset: the shipped ones, then the person's. A file that is not a valid preset is skipped and named in `problems`.
 * @param {{ kind?: 'pdf' | 'images' }} [opts] only the presets that apply to this kind of output
 */
export function list(ctx, opts) {
  const problems = []
  const mine = []
  const dir = dirOf(ctx)
  for (const f of readdirSync(dir).filter(n => n.endsWith('.json')).sort()) {
    try {
      const p = JSON.parse(readFileSync(join(dir, f), 'utf8'))
      const errors = validatePreset(p)
      if (errors.length || SHIPPED.some(s => s.id === p.id)) { problems.push({ file: f, errors: errors.length ? errors : ['id'] }); continue }
      mine.push(decorate({ ...p, basedOn: p.basedOn ?? null }, false))
    } catch { problems.push({ file: f, errors: ['unreadable'] }) }
  }
  const all = [...SHIPPED.map(p => decorate(p, true)), ...mine]
  const kind = opts?.kind
  return { presets: kind ? all.filter(p => p.kind === 'both' || p.kind === kind) : all, problems }
}

export function get(ctx, id) {
  const p = list(ctx).presets.find(x => x.id === id)
  if (!p) throw new Error(tr('errors.presetNotFound'))
  return p
}

/** What the export settings become when a preset is chosen for a set (PRD §18.4). */
export function apply(ctx, { id, setId }) {
  const p = get(ctx, id)
  const size = setId ? getCardSize(dbOf(ctx), setId) : null
  const options = {
    presetId: p.id, standard: p.standard, colour: p.colour === 'rgb' ? 'rgb' : 'cmyk', bleedMm: p.bleedMm, safeMm: p.safeMm, dpi: p.dpi, backLayout: p.backLayout,
    dieLine: p.die.mode, dieSpotName: p.die.spotName ?? 'DieCut', dieRadiusMm: p.die.radiusMm
  }
  if (options.colour === 'rgb' && options.standard === 'x1a') options.standard = 'plain'
  if (p.rules?.inkLimit) options.inkLimit = p.rules.inkLimit
  let profile = null
  if (p.profileHint) {
    const hit = profiles.list(ctx).imported.find(x => x.name.toLowerCase().includes(p.profileHint.toLowerCase()))
    if (hit) options.profileId = hit.id
    profile = { hint: p.profileHint, found: !!hit }
  }
  const vector = Object.entries(p.rules ?? {}).filter(([k, v]) => ['pureBlackText', 'overprintBlack', 'richBlack'].includes(k) && v).map(([k]) => k)
  return {
    options, minimums: p.minimums ?? {}, deck: p.deck ?? null,
    image: { format: p.imageFormat ?? 'png', pixels: p.pixels },
    notes: {
      name: p.name, sizeOk: !p.sizes || !size || p.sizes.includes(size.id), sizes: p.sizes, size: size?.id ?? null, verify: p.verify, stale: p.stale, ageDays: p.ageDays,
      proofTested: p.proofTested, profile, needsVector: vector, notesText: p.notes, guideUrl: p.guideUrl, checkedOn: p.checkedOn, manufacturer: p.manufacturer
    }
  }
}

/** A copy of a preset (shipped or the person's) under a new name; it can then be changed. */
export function duplicate(ctx, { id, name }) {
  const src = get(ctx, id)
  const dir = dirOf(ctx)
  const n = String(name ?? '').trim() || tr('presets.copyName', { name: src.name })
  let newId = slug(n), i = 2
  while (SHIPPED.some(s => s.id === newId) || existsSync(join(dir, `${newId}.json`))) newId = `${slug(n)}-${i++}`
  const { shipped, stale, ageDays: _a, ...clean } = src
  const copy = duplicatePreset({ ...clean, shipped }, newId, n)
  delete copy.shipped
  copy.proofTested = false
  writeFileSync(join(dir, `${newId}.json`), JSON.stringify(copy, null, 2))
  return decorate(copy, false)
}

/** Save changes to one of the person's presets (a shipped one is read only). */
export function save(ctx, preset) {
  if (SHIPPED.some(s => s.id === preset?.id)) throw new Error(tr('errors.presetShipped'))
  const dir = dirOf(ctx)
  const file = join(dir, `${preset?.id}.json`)
  if (!existsSync(file)) throw new Error(tr('errors.presetNotFound'))
  const { shipped, stale, ageDays: _a, ...clean } = preset
  const errors = validatePreset({ ...clean, format: PRESET_FORMAT })
  if (errors.length) throw new Error(tr('errors.presetInvalid', { problems: errors.join(', ') }))
  writeFileSync(file, JSON.stringify({ ...clean, format: PRESET_FORMAT }, null, 2))
  return decorate(clean, false)
}

export function remove(ctx, id) {
  if (SHIPPED.some(s => s.id === id)) throw new Error(tr('errors.presetShipped'))
  rmSync(join(dirOf(ctx), `${slug(id)}.json`), { force: true })
}

/** Import a preset file (asks the person unless `opts.path` is given); it must be valid and gets a new id when its own is taken. */
export async function importFile(ctx, opts) {
  opts ??= {}
  let path = opts.path
  if (!path) {
    const r = await ctx.ui.showOpenDialog({ title: tr('dialogs.importPreset'), properties: ['openFile'], filters: [{ name: tr('dialogs.presetFiles'), extensions: ['json'] }] })
    if (r.canceled || !r.filePaths.length) return null
    path = r.filePaths[0]
  }
  let p
  try { p = JSON.parse(readFileSync(path, 'utf8')) } catch { throw new Error(tr('errors.presetUnreadable', { file: basename(path) })) }
  const errors = validatePreset(p)
  if (errors.length) throw new Error(tr('errors.presetInvalid', { problems: errors.join(', ') }))
  const dir = dirOf(ctx)
  let id = p.id, i = 2
  while (SHIPPED.some(s => s.id === id) || existsSync(join(dir, `${id}.json`))) id = `${p.id}-${i++}`
  const imported = { ...p, id, proofTested: false }
  delete imported.shipped
  writeFileSync(join(dir, `${id}.json`), JSON.stringify(imported, null, 2))
  return decorate(imported, false)
}

/** Write a preset to a file the person chooses (or `opts.path`). */
export async function exportFile(ctx, { id, path }) {
  const p = get(ctx, id)
  let target = path
  if (!target) {
    const r = await ctx.ui.showSaveDialog({ title: tr('dialogs.exportPreset'), defaultPath: `${p.id}.json`, filters: [{ name: tr('dialogs.presetFiles'), extensions: ['json'] }] })
    if (r.canceled || !r.filePath) return null
    target = r.filePath
  }
  const { shipped, stale, ageDays: _a, ...clean } = p
  writeFileSync(target, JSON.stringify(clean, null, 2))
  return { path: target }
}
