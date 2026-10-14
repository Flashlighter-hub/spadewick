/**
 * The commands of the command line (PRD §21.3). Each one is `run(ctx, args)` returning `{ data, exit, text }`: `data` is what
 * `--json` prints, `text` is the same result for a person, `exit` is 0 (done) or 1 (the check ran and found problems).
 * They call the same services as the interface's handlers (src/main/core), so the results are the same.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, readdirSync } from 'fs'
import { join, resolve, dirname, basename } from 'path'
import { dbOf, dirOf } from '../main/core/context.js'
import { CURRENT_SCHEMA_VERSION } from '../main/db.js'
import * as sets from '../main/core/sets.js'
import * as snapshots from '../main/core/snapshots.js'
import * as compare from '../main/core/snapshotCompare.js'
import { changeList, FORMATS } from '../main/snapshots/report.js'
import * as presets from '../main/core/presets.js'
import * as exportProfiles from '../main/core/exportProfiles.js'
import * as textCheck from '../main/core/textCheck.js'
import * as preflight from '../main/core/preflight.js'
import * as production from '../main/core/production.js'
import * as exporter from '../main/core/export.js'
import * as dataio from '../main/core/dataio.js'
import { renderCard, effectiveTemplateId, effectiveBackTemplateId } from '../main/render.js'
import { validateValue, validateQuantity, parseRules } from '../shared/validate.js'
import { tr, plural } from '../shared/i18n.js'
import { UsageError, parseOpts } from './args.js'

const NOT_YET = ['cloud']

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A plain-text table: columns padded to the widest cell. */
export function table(head, rows) {
  const all = [head, ...rows.map(r => r.map(c => String(c ?? '')))]
  const widths = head.map((_, i) => Math.max(...all.map(r => r[i].length)))
  const line = r => r.map((c, i) => c.padEnd(widths[i])).join('  ').trimEnd()
  return [line(head), line(widths.map(w => '-'.repeat(w))), ...rows.map(r => line(r.map(c => String(c ?? ''))))].join('\n')
}

const rowsOf = (d, sql, ...p) => d.prepare(sql).all(...p)

/** Sets named by `--set` (a name, a code or an id), or every set. */
export function selectSets(ctx, flags) {
  const all = sets.list(ctx)
  if (!flags.set?.length) return all
  return flags.set.map(ref => {
    const hit = all.find(s => s.id === ref || s.code === ref || s.name.toLowerCase() === ref.toLowerCase())
    if (!hit) throw new UsageError(`No set named "${ref}". Sets: ${all.map(s => s.name).join(', ') || '(none)'}`)
    return hit
  })
}

function readOptionsFile(path) {
  if (!path) return {}
  if (!existsSync(path)) throw new UsageError(`Options file not found: ${path}`)
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { throw new UsageError(`Options file is not valid JSON: ${path}`) }
}

/**
 * The settings of an export, built the way the dialog builds them: a manufacturer preset first, then a saved export profile,
 * then an options file, then `--opt key=value`, each overriding the one before. Also returns what the preflight takes from a preset.
 */
export function resolveSettings(ctx, flags, setIds) {
  let options = {}
  let preset = null, minimums
  if (flags.preset) {
    const ref = flags.preset.toLowerCase()
    const found = presets.list(ctx).presets.find(p => p.id.toLowerCase() === ref || p.name.toLowerCase() === ref)
    if (!found) throw new UsageError(`No preset "${flags.preset}". Run "list presets" to see them.`)
    const a = presets.apply(ctx, { id: found.id, setId: setIds[0] })
    options = { ...a.options }
    minimums = a.minimums
    preset = { name: a.notes.name, sizeOk: a.notes.sizeOk, sizes: a.notes.sizes, size: a.notes.size, profile: a.notes.profile, verify: a.notes.verify, needsVector: a.notes.needsVector, deck: a.deck }
  }
  if (flags.profile) {
    const saved = exportProfiles.list(ctx, { kind: 'production' }).find(p => p.name.toLowerCase() === flags.profile.toLowerCase())
    if (!saved) throw new UsageError(`No saved export profile "${flags.profile}".`)
    const { noInkLimit, ...rest } = saved.options
    options = { ...options, ...rest, ...(noInkLimit ? { inkLimit: null } : {}) }
  }
  options = { ...options, ...readOptionsFile(flags.options), ...parseOpts(flags.opt) }
  return { options, preset, minimums }
}

const cardLabel = c => c.name || c.code || c.id
const countText = (n, word) => `${n} ${plural(n, word)}`

// ---------------------------------------------------------------------------
// info, list
// ---------------------------------------------------------------------------

function info(ctx) {
  const d = dbOf(ctx)
  const meta = Object.fromEntries(rowsOf(d, 'SELECT key, value FROM project_meta').map(r => [r.key, r.value]))
  const setList = sets.list(ctx).map(s => {
    const size = sets.cardsizeGet(ctx, s.id)
    return { name: s.name, code: s.code, cards: d.prepare('SELECT COUNT(*) AS n FROM cards WHERE set_id = ? AND deleted = 0').get(s.id).n, cardSize: size?.label ?? size?.id ?? null }
  })
  const count = t => d.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n
  const data = {
    name: meta.name ?? '', schemaVersion: Number(meta.schema_version ?? 0), appSchemaVersion: CURRENT_SCHEMA_VERSION, textEngine: meta.text_engine ?? 'estimate',
    sets: setList, fields: count('fields'), templates: count('templates'), assets: count('assets'), fonts: count('fonts'), icons: count('icons'), snapshots: snapshots.list(ctx).length
  }
  const text = [
    `Project:   ${data.name || '(unnamed)'}`,
    `Format:    ${data.schemaVersion} (this version writes ${data.appSchemaVersion})`,
    `Templates: ${data.templates}   Fields: ${data.fields}   Images: ${data.assets}   Fonts: ${data.fonts}   Icons: ${data.icons}   Snapshots: ${data.snapshots}`,
    '', table(['Set', 'Code', 'Cards', 'Card size'], setList.map(s => [s.name, s.code, s.cards, s.cardSize]))
  ].join('\n')
  return { data, exit: 0, text }
}

function list(ctx, { positional }) {
  const what = positional[0]
  const d = dbOf(ctx)
  const setName = new Map(sets.list(ctx).map(s => [s.id, s.name]))
  const kinds = {
    sets: () => sets.list(ctx).map(s => ({ name: s.name, code: s.code, template: s.default_template_id ? (d.prepare('SELECT name FROM templates WHERE id = ?').get(s.default_template_id)?.name ?? '') : '', cardBack: s.default_back_template_id ? (d.prepare('SELECT name FROM templates WHERE id = ?').get(s.default_back_template_id)?.name ?? '') : '', cards: d.prepare('SELECT COUNT(*) AS n FROM cards WHERE set_id = ? AND deleted = 0').get(s.id).n })),
    cards: () => rowsOf(d, 'SELECT * FROM cards WHERE deleted = 0 ORDER BY set_id, sort_order').map(c => ({ set: setName.get(c.set_id), id: c.card_code, name: c.display_name, copies: c.quantity, template: c.template_id ? (d.prepare('SELECT name FROM templates WHERE id = ?').get(c.template_id)?.name ?? '') : '', back: c.back_template_id ? (d.prepare('SELECT name FROM templates WHERE id = ?').get(c.back_template_id)?.name ?? '') : '' })),
    fields: () => rowsOf(d, 'SELECT * FROM fields ORDER BY set_id, display_order').map(f => ({ set: setName.get(f.set_id), name: f.name, slug: f.slug, type: f.type })),
    templates: () => rowsOf(d, 'SELECT id, name, card_size FROM templates ORDER BY name').map(t => ({ name: t.name, cardSize: t.card_size })),
    assets: () => rowsOf(d, 'SELECT original_name, mime_type, width_px, height_px, file_size_bytes FROM assets ORDER BY original_name').map(a => ({ name: a.original_name, type: a.mime_type, width: a.width_px, height: a.height_px, bytes: a.file_size_bytes })),
    fonts: () => rowsOf(d, 'SELECT family_name, style FROM fonts ORDER BY family_name').map(f => ({ family: f.family_name, style: f.style })),
    icons: () => rowsOf(d, 'SELECT name, aliases FROM icons ORDER BY name').map(i => ({ name: i.name, aliases: JSON.parse(i.aliases || '[]').join(', ') })),
    snapshots: () => snapshots.list(ctx).map(s => ({ id: s.id, name: s.name, created: new Date(s.created_at).toISOString(), bytes: s.size_bytes })),
    presets: () => presets.list(ctx).presets.map(p => ({ id: p.id, name: p.name, kind: p.kind, shipped: p.shipped ?? false }))
  }
  if (!kinds[what]) throw new UsageError(`list needs one of: ${Object.keys(kinds).join(', ')}`)
  const rows = kinds[what]()
  const head = rows.length ? Object.keys(rows[0]) : []
  return { data: rows, exit: 0, text: rows.length ? table(head, rows.map(r => head.map(k => r[k]))) : `(no ${what})` }
}

// ---------------------------------------------------------------------------
// validate
// ---------------------------------------------------------------------------

async function validate(ctx, { flags }) {
  const d = dbOf(ctx), dir = dirOf(ctx)
  const chosen = selectSets(ctx, flags)
  const problems = []
  const add = (severity, kind, where, message) => problems.push({ severity, kind, ...where, message })
  let checked = 0

  for (const set of chosen) {
    const fields = rowsOf(d, 'SELECT * FROM fields WHERE set_id = ? ORDER BY display_order', set.id)
    for (const f of fields) {
      if (f.type === 'number' || f.type === 'text') { /* its rules are applied to every value below */ }
      const rules = parseRules(f.validation)
      if (rules.regex) { try { new RegExp(rules.regex) } catch { add('warning', 'rule', { set: set.name, field: f.name }, `The pattern "${rules.regex}" is not a valid regular expression, so it is not applied.`) } }
    }
    for (const card of rowsOf(d, 'SELECT * FROM cards WHERE set_id = ? AND deleted = 0 ORDER BY sort_order', set.id)) {
      checked++
      const where = { set: set.name, card: card.display_name || card.card_code || card.id }
      const values = JSON.parse(card.fields_json || '{}')
      const q = validateQuantity(card.quantity)
      if (q.error) add('error', 'quantity', where, q.error)
      for (const f of fields) {
        const raw = values[f.slug]
        if (raw === undefined || raw === null || raw === '') continue
        if (f.type === 'image_ref') {
          const ref = String(raw)
          const asset = ref.startsWith('asset:') ? d.prepare('SELECT filename FROM assets WHERE id = ?').get(ref.slice(6)) : null
          if (!asset) add('error', 'image', { ...where, field: f.name }, 'The picture this field points to is not in the project.')
          else if (!existsSync(join(dir, 'assets', asset.filename))) add('error', 'image', { ...where, field: f.name }, `The picture file ${asset.filename} is missing from the assets folder.`)
          continue
        }
        const r = validateValue(f, raw)
        if (r.error) add('error', 'value', { ...where, field: f.name }, r.error)
      }
      if (!effectiveTemplateId(d, card)) add('warning', 'template', where, 'The card has no template, and its set has no default template: it is left out of exports.')
    }
  }

  // Missing icons and fonts, text that does not fit: the text check, over the chosen sets
  const report = await textCheck.run(ctx, { setIds: chosen.map(s => s.id) })
  for (const g of report.groups) {
    if (g.severity === 'info') continue
    const names = g.cards.slice(0, 5).map(c => c.card?.name ?? c.name ?? '').filter(Boolean)
    add(g.severity, g.type, { template: g.template?.name, element: g.element?.id ?? g.element?.field, cards: g.count }, `${g.type} ${JSON.stringify(g.detail)}${names.length ? ` (${names.join(', ')}${g.count > names.length ? ', …' : ''})` : ''}`)
  }

  const counts = { error: 0, warning: 0 }
  for (const p of problems) counts[p.severity]++
  const lines = problems.map(p => `${p.severity.padEnd(7)} ${p.kind.padEnd(9)} ${[p.set, p.card, p.field].filter(Boolean).join(' › ')}${p.template ? ` [template ${p.template}]` : ''}: ${p.message}`)
  const text = [...lines, `${countText(checked, 'card')} checked: ${countText(counts.error, 'error')}, ${countText(counts.warning, 'warning')}.`].join('\n')
  return { data: { checked, counts, problems }, exit: counts.error ? 1 : 0, text }
}

// ---------------------------------------------------------------------------
// preflight
// ---------------------------------------------------------------------------

function preflightText(result) {
  const lines = []
  for (const g of result.groups) {
    const names = g.cards.slice(0, 5).map(c => c.card?.name || c.name).filter(Boolean)
    lines.push(`${g.severity.padEnd(7)} ${g.type}${g.count > 1 ? ` x${g.count}` : ''} ${JSON.stringify(g.detail)}${g.template?.name ? ` [template ${g.template.name}]` : ''}${names.length ? ` (${names.join(', ')}${g.count > names.length ? ', …' : ''})` : ''}`)
  }
  lines.push(`${countText(result.checked, 'card')} checked: ${countText(result.counts.error, 'error')}, ${countText(result.counts.warning, 'warning')}, ${result.counts.info} information.`)
  return lines.join('\n')
}

async function runPreflight(ctx, flags) {
  const chosen = selectSets(ctx, flags)
  const { options, preset, minimums } = resolveSettings(ctx, flags, chosen.map(s => s.id))
  return preflight.run(ctx, { ...options, setIds: chosen.map(s => s.id), filter: flags.cards, preset: preset ?? undefined, minimums })
}

async function preflightCommand(ctx, { flags }) {
  const result = await runPreflight(ctx, flags)
  const shown = flags['only-errors'] ? { ...result, groups: result.groups.filter(g => g.severity === 'error') } : result
  return { data: shown, exit: result.counts.error ? 1 : 0, text: preflightText(shown) }
}

// ---------------------------------------------------------------------------
// export, render
// ---------------------------------------------------------------------------

const EXPORTS = {
  tts: (ctx, o) => exporter.exportTts(ctx, o),
  png: (ctx, o) => exporter.exportPngSheet(ctx, o),
  pdf: (ctx, o) => exporter.exportPdf(ctx, o),
  'production-pdf': (ctx, o) => production.run(ctx, o),
  images: (ctx, o) => production.runImagesService(ctx, o)
}

async function exportCommand(ctx, { positional, flags }) {
  const kind = positional[0]
  if (!EXPORTS[kind]) throw new UsageError(`export needs one of: ${Object.keys(EXPORTS).join(', ')}`)
  const d = dbOf(ctx)
  const chosen = selectSets(ctx, flags)
  if (!chosen.length) throw new UsageError('The project has no sets to export.')
  const { options, preset, minimums } = resolveSettings(ctx, flags, chosen.map(s => s.id))
  const outputDir = resolve(flags.out ?? join(dirOf(ctx), 'exports'))
  const opts = { ...options, setIds: chosen.map(s => s.id), outputDir, filter: flags.cards }

  if (flags['dry-run']) {
    const cards = chosen.reduce((n, s) => n + d.prepare('SELECT COUNT(*) AS n FROM cards WHERE set_id = ? AND deleted = 0').get(s.id).n, 0)
    return { data: { dryRun: true, kind, sets: chosen.map(s => s.name), cardsInSets: cards, outputDir, options }, exit: 0, text: `Would export ${kind} of ${chosen.map(s => s.name).join(', ')} (${countText(cards, 'card')} in these sets) to ${outputDir}. Nothing was written.` }
  }

  // The interface will not export a production file while the print readiness check has errors unless the person insists; so does this
  if (kind === 'production-pdf' && !flags['export-anyway']) {
    const result = await preflight.run(ctx, { ...opts, preset: preset ?? undefined, minimums })
    if (result.counts.error) {
      return { data: { exported: false, preflight: result }, exit: 1, text: `${preflightText(result)}\nNothing was exported: the print readiness check found errors. Fix them, or run again with --export-anyway.` }
    }
  }
  const result = await EXPORTS[kind](ctx, opts)
  const files = result.files ?? result.writtenFiles ?? []
  const dir = result.outputDir ?? outputDir
  const data = { exported: true, kind, outputDir: dir, files, ...(result.cardCount != null ? { cardCount: result.cardCount } : {}), ...(result.pageCount != null ? { pageCount: result.pageCount } : {}) }
  return { data, exit: 0, text: `${files.length ? files.map(f => `${dir}${dir.endsWith('/') || dir.endsWith('\\') ? '' : '/'}${f}`).join('\n') + '\n' : ''}Exported ${kind}: ${countText(files.length, 'file')} in ${dir}.` }
}

async function renderCommand(ctx, { flags }) {
  const ref = flags.card
  if (!ref) throw new UsageError('render needs --card <name or card ID>')
  const d = dbOf(ctx)
  const rows = rowsOf(d, 'SELECT * FROM cards WHERE deleted = 0')
  const lower = ref.toLowerCase()
  const hits = rows.filter(c => c.id === ref || (c.card_code ?? '').toLowerCase() === lower)
  const found = hits.length ? hits : rows.filter(c => c.display_name.toLowerCase() === lower)
  if (!found.length) throw new UsageError(`No card "${ref}".`)
  if (found.length > 1) throw new UsageError(`"${ref}" names ${found.length} cards; use the card ID (${found.map(c => c.card_code).filter(Boolean).join(', ')}).`)
  const card = found[0]
  const width = flags.width ? Number(flags.width) : undefined
  if (flags.width && !(width > 0)) throw new UsageError('--width must be a number of pixels.')
  if (flags.side && !['front', 'back'].includes(flags.side)) throw new UsageError('--side must be front or back.')
  const side = flags.side === 'back' ? 'back' : 'front'
  if (side === 'back' && !effectiveBackTemplateId(d, card)) throw new UsageError(`"${ref}" has no card back: choose one for its set, or give the card a back of its own.`)
  const file = resolve(flags.out ?? `${(card.card_code || card.id).replace(/[^\w.-]+/g, '_')}${side === 'back' ? '_back' : ''}.png`)
  if (flags['dry-run']) return { data: { dryRun: true, card: card.id, file }, exit: 0, text: `Would write ${file}. Nothing was written.` }
  const png = await renderCard(dirOf(ctx), card.id, { width, side })
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, png)
  return { data: { card: card.id, file, bytes: png.length }, exit: 0, text: file }
}

// ---------------------------------------------------------------------------
// compare
// ---------------------------------------------------------------------------

function snapshotRef(ctx, ref) {
  const all = snapshots.list(ctx)
  const hit = all.find(s => s.id === ref) ?? all.find(s => s.name.toLowerCase() === ref.toLowerCase())
  if (!hit) throw new UsageError(`No snapshot "${ref}". Run "list snapshots" to see them.`)
  return hit
}

async function compareCommand(ctx, { positional, flags }) {
  if (!positional.length || positional.length > 2) throw new UsageError('compare needs one or two snapshots (name or id): compare <snapshot> [<snapshot>]')
  let from = snapshotRef(ctx, positional[0])
  let to = positional[1] ? snapshotRef(ctx, positional[1]) : null
  if (to && to.created_at < from.created_at) [from, to] = [to, from]   // the earlier one is always the "before"
  const format = flags.format ?? 'text'
  if (![...FORMATS, 'json'].includes(format)) throw new UsageError('--format must be text, markdown, csv, html or json')
  const r = compare.open(ctx, { from: from.id, to: to?.id ?? null })
  try {
    const { handle, ...result } = r
    const empty = !result.summary.cardsChanged && !result.summary.cardsAdded && !result.summary.cardsRemoved && !result.summary.fields && !result.summary.other
    const data = { from: from.id, to: to?.id ?? null, ...result }
    return { data, exit: 0, text: format === 'json' ? JSON.stringify(data, null, 2) : changeList(result, from, to, format), empty }
  } finally { compare.close(ctx, r.handle) }
}

// ---------------------------------------------------------------------------
// import, snapshot, profiles
// ---------------------------------------------------------------------------

/** Commands that change the project: they take the lock (see core/lock.js) and refuse to start when another program holds it. */
export function needsWrite(command, positional, flags) {
  if (command === 'import') return !flags['dry-run']
  if (command === 'snapshot') return ['create', 'restore'].includes(positional[0])
  if (command === 'watch') return !!flags.reimport
  return false
}

function oneSet(ctx, flags) {
  const chosen = selectSets(ctx, flags)
  if (chosen.length !== 1) throw new UsageError(chosen.length ? 'This command needs exactly one set: use --set <name>.' : 'The project has no sets.')
  return chosen[0]
}

/** Import a CSV or JSON file into one set: the same reading, mapping and checking as the interface (PRD §5.5). */
function runImport(ctx, file, flags) {
  const set = oneSet(ctx, flags)
  if (!existsSync(file)) throw new UsageError(`File not found: ${file}`)
  const mode = flags.mode ?? 'append'
  if (!['append', 'merge'].includes(mode)) throw new UsageError('--mode must be append or merge')
  const read = dataio.readDataFile(ctx, { path: file, setId: set.id, sheet: flags.sheet === undefined ? undefined : /^d+$/.test(flags.sheet) ? Number(flags.sheet) - 1 : flags.sheet })
  const fileProblems = read.issues ?? []
  // A CSV that breaks the CSV rules (a stray quote, a row with the wrong number of columns) loses or runs together cards without a word,
  // so nothing is written until the problems are fixed, or accepted with --ignore-file-problems. A dry run reports them and goes on.
  if (fileProblems.length && !flags['dry-run'] && !flags['ignore-file-problems']) return { set: set.name, rows: read.rows.length, mode, refused: true, fileProblems }
  let mapping = read.mapping
  if (flags.mapping && flags.mapping !== 'auto') {
    if (!existsSync(flags.mapping)) throw new UsageError(`Mapping file not found: ${flags.mapping}`)
    try { mapping = { ...mapping, ...JSON.parse(readFileSync(flags.mapping, 'utf8')) } } catch { throw new UsageError(`Mapping file is not valid JSON: ${flags.mapping}`) }
  }
  const richText = parseOpts(flags.opt).richText
  const base = { setId: set.id, rows: read.rows, mapping, mode, keyField: flags.key, ...(richText ? { richText } : {}) }
  const preview = !!flags['dry-run']
  const r = dataio.importRows(ctx, { ...base, previewOnly: preview })
  return { set: set.name, rows: read.rows.length, mode, ...(fileProblems.length ? { fileProblems } : {}), ...(preview ? { dryRun: true, validRows: r.validCount, newFields: r.newFields, errors: r.errors } : { created: r.created, updated: r.updated, skipped: r.skipped, errors: r.errors }) }
}

function importCommand(ctx, { positional, flags }) {
  if (!positional[0]) throw new UsageError('import needs a file: import <file.csv|file.json|file.xlsx> --set <set>')
  const r = runImport(ctx, resolve(positional[0]), flags)
  const problems = (r.fileProblems ?? []).slice(0, 20).map(p => `  line ${p.line}: ${p.message}`)
  const moreProblems = (r.fileProblems?.length ?? 0) > 20 ? [`  … and ${r.fileProblems.length - 20} more`] : []
  if (r.refused) {
    return { data: r, exit: 1, text: [`Nothing was imported: the file breaks the CSV rules in ${countText(r.fileProblems.length, 'place')}, so cards may be lost or run together (${countText(r.rows, 'row')} could be read).`, ...problems, ...moreProblems, 'Fix the file, or run again with --ignore-file-problems to import what was read.'].join('\n') }
  }
  const errors = (r.errors ?? []).slice(0, 20).map(e => `  ${typeof e === 'string' ? e : `row ${e.row ?? '?'}${e.field ? ` ${e.field}` : ''}: ${e.message ?? e.error ?? JSON.stringify(e)}`}`)
  const head = r.dryRun
    ? `Dry run: ${countText(r.validRows, 'row')} of ${r.rows} would be imported into ${r.set}${r.newFields?.length ? `; new fields: ${r.newFields.join(', ')}` : ''}. Nothing was written.`
    : `Imported into ${r.set}: ${r.created} created, ${r.updated} updated, ${r.skipped} skipped.`
  const warned = r.fileProblems?.length ? [`Warning: the file breaks the CSV rules in ${countText(r.fileProblems.length, 'place')}; cards may be lost or run together.`, ...problems, ...moreProblems] : []
  return { data: r, exit: r.errors?.length ? 1 : 0, text: [head, ...warned, ...errors, ...(r.errors?.length > 20 ? [`  … and ${r.errors.length - 20} more`] : [])].join('\n') }
}

function snapshotCommand(ctx, { positional, flags }) {
  const [sub, ref] = positional
  if (sub === 'list') return list(ctx, { positional: ['snapshots'] })
  if (sub === 'create') {
    if (!ref) throw new UsageError('snapshot create needs a name: snapshot create <name>')
    if (flags['dry-run']) return { data: { dryRun: true, name: ref }, exit: 0, text: `Would create the snapshot "${ref}". Nothing was written.` }
    const meta = snapshots.create(ctx, { name: ref, description: flags.description })
    return { data: meta, exit: 0, text: `Created snapshot "${meta.name}" (${meta.id}).` }
  }
  if (sub === 'restore') {
    if (!ref) throw new UsageError('snapshot restore needs a snapshot: snapshot restore <name or id>')
    const snap = snapshotRef(ctx, ref)
    if (flags['dry-run']) return { data: { dryRun: true, snapshot: snap.id }, exit: 0, text: `Would restore "${snap.name}" (the current state is saved as an automatic snapshot first). Nothing was written.` }
    const r = snapshots.restore(ctx, snap.id)
    return { data: r, exit: 0, text: `Restored "${snap.name}". The state before is saved as ${r.autoSnapshot ? `"${r.autoSnapshot.name}" (${r.autoSnapshot.id})` : 'a copy of the damaged database'}.` }
  }
  throw new UsageError('snapshot needs create <name>, list or restore <name or id>')
}

function profilesCommand(ctx, { positional }) {
  const d = dbOf(ctx)
  const all = rowsOf(d, 'SELECT * FROM export_profiles ORDER BY kind, name').map(r => ({ name: r.name, kind: r.kind, options: JSON.parse(r.options || '{}') }))
  const [sub, ref] = positional
  if (sub === 'list') return { data: all.map(({ name, kind }) => ({ name, kind })), exit: 0, text: all.length ? table(['Name', 'Kind'], all.map(p => [p.name, p.kind])) : '(no saved export profiles)' }
  if (sub === 'show') {
    if (!ref) throw new UsageError('profiles show needs a name: profiles show <name>')
    const hit = all.find(p => p.name.toLowerCase() === ref.toLowerCase())
    if (!hit) throw new UsageError(`No saved export profile "${ref}".`)
    return { data: hit, exit: 0, text: [`${hit.name} (${hit.kind})`, ...Object.entries(hit.options).map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`)].join('\n') }
  }
  throw new UsageError('profiles needs list or show <name>')
}

// ---------------------------------------------------------------------------
// watch
// ---------------------------------------------------------------------------

/** What changed on disk, as one string: the project database and its log, the pictures and fonts, and any extra files. */
function signatureOf(dir, extra) {
  const parts = []
  const stat = path => { try { const s = statSync(path); return `${Math.round(s.mtimeMs)}:${s.size}` } catch { return '-' } }
  for (const f of ['project.db', 'project.db-wal']) parts.push(stat(join(dir, f)))
  for (const sub of ['assets', 'fonts']) {
    try { for (const name of readdirSync(join(dir, sub)).sort()) parts.push(`${sub}/${name}:${stat(join(dir, sub, name))}`) } catch { /* no folder */ }
  }
  for (const f of extra) parts.push(`${f}:${stat(f)}`)
  return parts.join('|')
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

/**
 * Run an export now, and again whenever the project's files change (PRD §21.3). Stops on Ctrl+C, or after `--runs <n>` exports
 * (for scripts and tests). A failed run is reported and the watch goes on. With `--reimport <file>`, a changed data file is imported
 * again (merge by `--key`) before each export.
 */
async function watchCommand(ctx, args) {
  const { positional, flags, log, signal } = args
  if (!EXPORTS[positional[0]]) throw new UsageError(`watch needs an export kind: ${Object.keys(EXPORTS).join(', ')}`)
  const interval = flags.interval ? Number(flags.interval) : 1000
  if (!(interval >= 50)) throw new UsageError('--interval must be a number of milliseconds, at least 50')
  const maxRuns = flags.runs ? Number(flags.runs) : Infinity
  if (!(maxRuns >= 1)) throw new UsageError('--runs must be a number, at least 1')
  const reimport = flags.reimport ? resolve(flags.reimport) : null
  if (reimport && !existsSync(reimport)) throw new UsageError(`File not found: ${reimport}`)
  const extra = [...(flags.also ?? []).map(f => resolve(f)), ...(reimport ? [reimport] : [])]
  const dir = dirOf(ctx)
  let stopped = false
  signal?.addEventListener('abort', () => { stopped = true })

  let runs = 0, failures = 0
  const runOnce = async reason => {
    try {
      if (reimport) {
        const r = runImport(ctx, reimport, { ...flags, mode: flags.mode ?? 'merge', 'dry-run': false })
        if (r.refused) throw new Error(`${basename(reimport)} breaks the CSV rules in ${countText(r.fileProblems.length, 'place')} (first: line ${r.fileProblems[0].line}); nothing was imported`)
        log(`Imported ${basename(reimport)}: ${r.created} created, ${r.updated} updated, ${r.skipped} skipped.`)
      }
      const r = await exportCommand(ctx, { positional, flags })
      log(`${reason}: ${r.text.split('\n').at(-1)}`)
      if (r.exit) failures++
    } catch (e) {
      failures++
      log(`${reason}: failed: ${e.message}`)
    }
    runs++
  }

  let seen = signatureOf(dir, extra)
  await runOnce('Start')
  seen = signatureOf(dir, extra)   // an import in the first run changed the files itself
  while (!stopped && runs < maxRuns) {
    await sleep(interval)
    const now = signatureOf(dir, extra)
    if (now === seen) continue
    await sleep(interval)            // let the writer finish: run when the files have stopped changing
    const settled = signatureOf(dir, extra)
    if (settled !== now) { seen = now; continue }
    seen = settled
    await runOnce('Changed')
    seen = signatureOf(dir, extra)
  }
  return { data: { runs, failures }, exit: failures ? 1 : 0, text: `Stopped after ${countText(runs, 'run')}${failures ? `, ${countText(failures, 'run')} failed` : ''}.` }
}

// ---------------------------------------------------------------------------

export const COMMANDS = { info, list, validate, preflight: preflightCommand, export: exportCommand, render: renderCommand, compare: compareCommand, import: importCommand, snapshot: snapshotCommand, profiles: profilesCommand, watch: watchCommand }
export const NOT_BUILT = NOT_YET

export const HELP = `Spadewick command line

Usage: spadewick <command> [options]

Commands
  info                            Summary of the project
  list <what>                     sets, cards, fields, templates, assets, fonts, icons, snapshots, presets
  validate                        Check field rules, quantities, pictures, icons, fonts and text fit (exit 1 on errors)
  preflight [--preset <name>]     The print readiness check (exit 1 on errors)
  export <kind>                   tts, png, pdf, production-pdf, images
  render --card <name or ID>      One card as a PNG (--out file.png, --width px, --side front|back)
  compare <snapshot> [<snapshot>] What changed since a snapshot, or between two (--format text|markdown|csv|html|json)
  import <file> --set <set>       Import a CSV, JSON or Excel (.xlsx) file (--mode append|merge, --key <field>, --mapping <file.json>, --sheet <name or number>, --dry-run)
  snapshot create <name> | list | restore <name or id>
  profiles list | show <name>     The saved export profiles of the project
  watch <kind>                    Export now and again whenever the project changes (--interval ms, --also <file>, --reimport <file>, --runs n)
  version, help

Options
  --project <folder>              The project (default: the current folder)
  --set <name|code|id>            Only this set (repeat for several; default: all sets)
  --cards <filter>                Only cards matching a filter such as "faction == 'Red'"
  --out <folder or file>          Where files go (export: a folder; render: a file)
  --preset <name>                 A manufacturer preset (see "list presets")
  --profile <name>                A saved export profile of the project
  --options <file.json>           Export settings from a JSON file
  --opt key=value                 One export setting (repeat), e.g. --opt dpi=600 --opt bleedMm=3
  --export-anyway                 production-pdf: export even when the print readiness check has errors
  --ignore-file-problems          import: go on although the CSV breaks the CSV rules (a stray quote, a row with the wrong number of columns)
  --only-errors                   preflight: show errors only
  --library <folder>              The folder of your own presets (or set SPADEWICK_LIBRARY)
  --json                          Machine-readable output
  --quiet                         Print nothing but results and errors
  --dry-run                       Say what would be written and write nothing
  --force                         Write even though another program has the project open

Exit codes: 0 done; 1 the check ran and found problems; 2 wrong usage; 3 the project cannot be opened.
Commands that change the project refuse to run while another program (the application, another command) has it open, unless --force is given.
Not in this version: cloud (see the PRD, section 21).
`
