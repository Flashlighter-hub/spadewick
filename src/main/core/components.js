/**
 * The component library (PRD §7.10): reusable parts of a template (a cost badge, a frame, a stat box) kept with the template library, so
 * every project can use them. A component is copied into a template when it is used, so the template stays complete on its own (A55);
 * the library is only where the copy comes from, and where an update comes from.
 *
 * A component is one JSON file in `<library>/components/`:
 *   { format, id, name, description, version, refWidth, bounds: { x, y, w, h }, xml: [element source], defs: [definition source], fields: [slugs], updated }
 * Pictures of the project's image library that the parts use are put inside as data, so the component works in any project.
 */
import { join } from 'path'
import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'fs'
import { tr } from '../../shared/i18n.js'
import { sanitizeSvg } from '../../shared/svgSafety.js'
import { rasterizeSample } from '../templateLibrary.js'
import { starterComponents, isStarterComponentId } from '../componentStarters.js'
import { dbOf, dirOf } from './context.js'

const FORMAT = 1
const MAX_PARTS = 400                 // elements in a component
const MAX_SOURCE = 400_000            // characters of one element's source
const NAME_MAX = 100

const folder = ctx => {
  const root = ctx.settings.get('library_dir')
  if (!root) throw new Error(tr('library.noLibraryFolder'))
  const dir = join(root, 'components')
  mkdirSync(dir, { recursive: true })
  return dir
}
const fileOf = (ctx, id) => join(folder(ctx), `${id}.json`)
const validId = id => /^[0-9a-f-]{36}$/.test(String(id))

const isNum = n => typeof n === 'number' && Number.isFinite(n)
const wrap = parts => `<svg xmlns="http://www.w3.org/2000/svg">${parts.join('')}</svg>`
/** Source with scripts, event handlers and references to the outside taken out (a component can come from a file). */
const clean = source => sanitizeSvg(wrap([source])).replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')

/** The `{{slug}}` a source shows and the `data-spadewick-field` it binds, without the card's own values. */
function fieldsIn(sources) {
  const found = new Set()
  for (const s of sources) {
    for (const m of s.matchAll(/\{\{\s*([A-Za-z_][\w]*)\s*\}\}/g)) found.add(m[1])
    for (const m of s.matchAll(/data-spadewick-field="([\w]+)"/g)) found.add(m[1])
  }
  return [...found].sort()
}

/** A component made safe and complete from what arrived (a request, or a file); throws for what cannot be a component. */
export function normalize(raw, { id, version, keepId = false } = {}) {
  const bad = () => { throw new Error(tr('components.invalid')) }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) bad()
  const name = String(raw.name ?? '').trim().slice(0, NAME_MAX)
  if (!name) throw new Error(tr('components.nameEmpty'))
  if (!Array.isArray(raw.xml) || !raw.xml.length || raw.xml.length > MAX_PARTS || raw.xml.some(x => typeof x !== 'string' || !x.trim() || x.length > MAX_SOURCE)) bad()
  if (!Array.isArray(raw.defs ?? []) || (raw.defs ?? []).length > MAX_PARTS || (raw.defs ?? []).some(x => typeof x !== 'string' || x.length > MAX_SOURCE)) bad()
  const b = raw.bounds
  const bounds = b && isNum(b.x) && isNum(b.y) && isNum(b.w) && isNum(b.h) && b.w > 0 && b.h > 0 ? { x: b.x, y: b.y, w: b.w, h: b.h } : null
  if (!bounds) bad()
  const xml = raw.xml.map(clean), defs = (raw.defs ?? []).map(clean)
  return {
    format: FORMAT, id: id ?? (keepId && validId(raw.id) ? raw.id : randomUUID()), name, description: String(raw.description ?? '').slice(0, 1000),
    version: Math.max(1, Math.round(version ?? raw.version ?? 1)), refWidth: isNum(raw.refWidth) && raw.refWidth > 0 ? raw.refWidth : 500, bounds,
    xml, defs, fields: fieldsIn([...xml, ...defs]), updated: Date.now()
  }
}

/** Pictures of the project's image library become data inside the component. */
function embedAssets(ctx, sources) {
  const d = dbOf(ctx), dir = dirOf(ctx)
  const cache = new Map()
  const dataOf = assetId => {
    if (cache.has(assetId)) return cache.get(assetId)
    const row = d.prepare('SELECT filename, mime_type FROM assets WHERE id = ?').get(assetId)
    const file = row && join(dir, 'assets', row.filename)
    let uri = ''
    if (file && existsSync(file)) uri = `data:${row.mime_type};base64,${readFileSync(file).toString('base64')}`
    cache.set(assetId, uri)
    return uri
  }
  return sources.map(s => s.replace(/\{\{\s*@asset\.([^}\s]+)\s*\}\}/g, (_, id) => dataOf(id)))
}

function thumbnail(c) {
  try {
    const pad = Math.max(c.bounds.w, c.bounds.h) * 0.06
    const vb = `${c.bounds.x - pad} ${c.bounds.y - pad} ${c.bounds.w + 2 * pad} ${c.bounds.h + 2 * pad}`
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${vb}" width="${c.bounds.w + 2 * pad}" height="${c.bounds.h + 2 * pad}"><defs>${c.defs.join('')}</defs>${c.xml.join('')}</svg>`
    const sample = Object.fromEntries([['cost', '3'], ['power', '4'], ['toughness', '5'], ['value', '3'], ['name', 'Card name'], ['title', 'Card name'], ['rules', 'Rules text goes here.'], ['text', 'Rules text goes here.']])
    const values = Object.fromEntries(c.fields.map(f => [f, sample[f] ?? f]))        // a sample word for the usual fields, else the field's own name
    return rasterizeSample(svg, { values, width: 180 }).toString('base64')
  } catch { return null }
}

/** The components that ship with the application, made safe and complete like any other (read only). */
const starters = new Map()
const starter = id => {
  if (!isStarterComponentId(id)) return null
  if (!starters.size) for (const raw of starterComponents()) starters.set(raw.id, normalize(raw, { id: raw.id, version: raw.version }))
  return starters.get(id) ?? null
}
const starterThumbs = new Map()

const read = (ctx, id) => {
  if (!validId(id)) return null
  if (isStarterComponentId(id)) return starter(id)
  const file = fileOf(ctx, id)
  if (!existsSync(file)) return null
  try { const raw = JSON.parse(readFileSync(file, 'utf8')); return normalize(raw, { id, version: raw.version }) } catch { return null }
}

/** The components of the library, by name, each with a small picture. */
export function list(ctx) {
  const dir = folder(ctx)
  const out = []
  for (const f of readdirSync(dir).filter(n => n.endsWith('.json'))) {
    const c = read(ctx, f.slice(0, -5))
    if (c) out.push({ id: c.id, name: c.name, description: c.description, version: c.version, fields: c.fields, updated: c.updated, parts: c.xml.length, thumbnail: thumbnail(c), builtIn: false })
  }
  for (const raw of starterComponents()) {
    const c = starter(raw.id)
    if (!starterThumbs.has(c.id)) starterThumbs.set(c.id, thumbnail(c))
    out.push({ id: c.id, name: c.name, description: c.description, version: c.version, fields: c.fields, updated: 0, parts: c.xml.length, thumbnail: starterThumbs.get(c.id), builtIn: true })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/** One component in full, for putting into a template; null when it is not in the library. */
export function get(ctx, id) {
  return read(ctx, id)
}

/**
 * Save a component: a new one, or (with `id`) a new version of one that is there. The project's pictures are embedded.
 * @returns {{ id: string, version: number }}
 */
export function save(ctx, { id, name, description, xml, defs, bounds, refWidth }) {
  if (isStarterComponentId(id)) id = undefined          // a built-in component is not changed: what is saved over it is a component of the person's own
  const existing = id ? read(ctx, id) : null
  if (id && !existing) throw new Error(tr('components.notFound'))
  const strings = list => (Array.isArray(list) ? list.map(x => (typeof x === 'string' ? x : '')) : [])     // anything else is refused as a component
  const raw = { name: name ?? existing?.name, description: description ?? existing?.description, xml: embedAssets(ctx, strings(xml)), defs: embedAssets(ctx, strings(defs)), bounds, refWidth }
  const c = normalize(raw, { id: existing?.id, version: existing ? existing.version + 1 : 1 })
  writeFileSync(fileOf(ctx, c.id), JSON.stringify(c))
  return { id: c.id, version: c.version }
}

export function rename(ctx, { id, name, description }) {
  if (isStarterComponentId(id)) throw new Error(tr('components.builtIn'))
  const c = read(ctx, id)
  if (!c) throw new Error(tr('components.notFound'))
  const title = String(name ?? c.name).trim().slice(0, NAME_MAX)
  if (!title) throw new Error(tr('components.nameEmpty'))
  writeFileSync(fileOf(ctx, id), JSON.stringify({ ...c, name: title, description: String(description ?? c.description).slice(0, 1000), updated: Date.now() }))
}

export function remove(ctx, id) {
  if (!validId(id) || isStarterComponentId(id)) return          // the built-in ones stay
  rmSync(fileOf(ctx, id), { force: true })
}

/** Write a component to a file of the person's choosing, to give to someone or to keep. */
export async function exportItem(ctx, { id }) {
  const c = read(ctx, id)
  if (!c) throw new Error(tr('components.notFound'))
  const picked = await ctx.ui.showSaveDialog({ title: tr('components.exportTitle'), defaultPath: `${c.name.replace(/[^\w.-]+/g, '_')}.spadecomponent.json`, filters: [{ name: tr('components.fileKind'), extensions: ['json'] }] })
  if (picked.canceled || !picked.filePath) return { canceled: true }
  writeFileSync(picked.filePath, JSON.stringify(c, null, 2))
  return { canceled: false, path: picked.filePath }
}

/** Read a component from a file into the library, as a component of its own (never replacing one that is there). */
export async function importItem(ctx) {
  const picked = await ctx.ui.showOpenDialog({ title: tr('components.importTitle'), properties: ['openFile'], filters: [{ name: tr('components.fileKind'), extensions: ['json'] }] })
  if (picked.canceled || !picked.filePaths?.length) return { canceled: true }
  let raw
  try { raw = JSON.parse(readFileSync(picked.filePaths[0], 'utf8')) } catch { throw new Error(tr('components.invalid')) }
  if (raw?.format !== FORMAT) throw new Error(tr('components.invalid'))
  const c = normalize(raw)
  writeFileSync(fileOf(ctx, c.id), JSON.stringify(c))
  return { canceled: false, id: c.id, name: c.name }
}
