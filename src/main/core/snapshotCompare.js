import { join } from 'path'
import { mkdtempSync, rmSync, existsSync, copyFileSync, writeFileSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { openProjectDb, closeProjectDb } from '../db.js'
import { extractZip } from '../zip.js'
import { renderCard } from '../render.js'
import { compareStates, lineDiff } from '../snapshots/compare.js'
import { changeList } from '../snapshots/report.js'
import * as snapshotsService from './snapshots.js'
import { recordChange, rowOf } from './history.js'
import { syncCounters } from '../cardIds.js'
import { tr } from '../../shared/i18n.js'
import { dirOf, dbOf } from './context.js'

/**
 * Snapshot compare (PRD §20). A snapshot is unpacked into the operating system's temporary folder and opened as a
 * project of its own, so the earlier cards are drawn from the snapshot's own templates, fonts and images (§20.6) and
 * the open project is never touched by looking. The copy is removed when the comparison is closed.
 */

const sessions = new Map()   // handle -> { dirs: [temp folders], from: {dir, db}, to: {dir, db} | null }

function unpack(ctx, snapshotId) {
  if (!/^[\w.-]+$/.test(String(snapshotId))) throw new Error(tr('errors.snapshotNotFound'))
  const zip = join(dirOf(ctx), 'snapshots', `${snapshotId}.zip`)
  if (!existsSync(zip)) throw new Error(tr('errors.snapshotNotFound'))
  const dir = mkdtempSync(join(tmpdir(), 'spadewick-compare-'))
  try {
    extractZip(zip, dir)
    if (!existsSync(join(dir, 'project.db'))) throw new Error(tr('errors.snapshotNoDatabase'))
    return { dir, db: openProjectDb(dir) }
  } catch (err) {
    try { closeProjectDb(dir) } catch { /* not opened */ }
    rmSync(dir, { recursive: true, force: true })
    throw err
  }
}

function discard(s) {
  for (const side of [s.from, s.to]) {
    if (!side || side.live) continue
    try { closeProjectDb(side.dir) } catch { /* already closed */ }
    rmSync(side.dir, { recursive: true, force: true })
  }
}

function diffOf(s) {
  const result = compareStates(s.from.db, s.to.db)
  if (s.to.live) {
    // A card that was removed can come back only into a set that still exists
    const sets = new Set(s.to.db.prepare('SELECT id FROM sets').all().map(r => r.id))
    for (const c of result.cards) c.restorable = c.kind === 'removed' ? sets.has(c.setId) : true
  } else {
    for (const c of result.cards) c.restorable = false
  }
  return result
}

const session = handle => {
  const s = sessions.get(handle)
  if (!s) throw new Error(tr('errors.compareClosed'))
  return s
}

/** Open a comparison of snapshot `from` with snapshot `to`, or with the open project when `to` is not given. */
export function open(ctx, { from, to = null }) {
  const live = { dir: dirOf(ctx), db: dbOf(ctx), live: true }
  const a = unpack(ctx, from)
  let b = live
  if (to) {
    try { b = unpack(ctx, to) } catch (err) { discard({ from: a }); throw err }
  }
  const handle = randomUUID()
  const meta = snapshotsService.list(ctx)
  const s = { from: a, to: b, meta: { from: meta.find(m => m.id === from) ?? { id: from, name: from, created_at: 0 }, to: to ? meta.find(m => m.id === to) ?? { id: to, name: to, created_at: 0 } : null } }
  sessions.set(handle, s)
  return { handle, live: !to, ...diffOf(s) }
}

export function close(ctx, handle) {
  const s = sessions.get(handle)
  if (!s) return
  sessions.delete(handle)
  discard(s)
}

/** The comparison again, after something was taken back. */
export function refresh(ctx, handle) {
  const s = session(handle)
  if (s.to.live) s.to.db = dbOf(ctx)
  return { handle, live: !!s.to.live, ...diffOf(s) }
}

/** One card as it was (`side` 'from') or is (`side` 'to'), as a base64 PNG. */
export async function renderSide(ctx, { handle, side, cardId, width = 360 }) {
  const s = session(handle)
  const target = side === 'from' ? s.from : s.to
  const present = target.db.prepare('SELECT 1 FROM cards WHERE id = ?').get(cardId)
  if (!present) return null
  try {
    return (await renderCard(target.dir, cardId, { width })).toString('base64')
  } catch {
    return null   // a card whose template no longer exists cannot be drawn; the field list still shows what changed
  }
}


/** A template as the earlier or later state draws it, on a sample card of its set (`side` 'from' or 'to'), as a base64 PNG. */
export async function renderTemplate(ctx, { handle, side, templateId, width = 300 }) {
  const s = session(handle)
  const target = side === 'from' ? s.from : s.to
  if (!target.db.prepare('SELECT 1 FROM templates WHERE id = ?').get(templateId)) return null
  const card = target.db.prepare(
    `SELECT c.id FROM cards c LEFT JOIN sets st ON st.id = c.set_id
      WHERE c.deleted = 0 AND (c.template_id = ? OR st.default_template_id = ?) ORDER BY c.sort_order LIMIT 1`).get(templateId, templateId)
    ?? target.db.prepare('SELECT id FROM cards WHERE deleted = 0 ORDER BY sort_order LIMIT 1').get()
  if (!card) return null
  try { return (await renderCard(target.dir, card.id, { width, templateId })).toString('base64') } catch { return null }
}

/** The line differences between the two versions of a template's SVG source. */
export function templateSource(ctx, { handle, templateId }) {
  const s = session(handle)
  const a = s.from.db.prepare('SELECT svg_source FROM templates WHERE id = ?').get(templateId)?.svg_source ?? ''
  const b = s.to.db.prepare('SELECT svg_source FROM templates WHERE id = ?').get(templateId)?.svg_source ?? ''
  return lineDiff(a, b)
}

/** The change list as Markdown, CSV or HTML, written where the person chooses (§20.4). Returns { path } or null when cancelled. */
export async function exportChanges(ctx, { handle, format, path }) {
  const s = session(handle)
  const text = changeList(diffOf(s), s.meta.from, s.meta.to, format)
  const ext = { markdown: 'md', csv: 'csv', html: 'html' }[format]
  if (!ext) throw new Error(tr('errors.compareFormat'))
  let file = path
  if (!file) {
    const r = await ctx.ui.showSaveDialog({ title: tr('compare.exportTitle'), defaultPath: `changes.${ext}`, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] })
    if (r.canceled) return null
    file = r.filePath
  }
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text, 'utf8')
  return { path: file }
}

/**
 * Take back the changes named by `keys` (as listed by open/refresh) in the open project: one undoable step, nothing
 * unselected is touched (§20.3). Changes that cannot be taken back any more are counted as skipped.
 */
export function restore(ctx, { handle, keys }) {
  const s = session(handle)
  if (!s.to.live) throw new Error(tr('errors.compareNotLive'))
  const d = dbOf(ctx)
  s.to.db = d
  const A = s.from.db
  const wanted = new Set(keys)
  const diff = diffOf(s)
  const now = Date.now()

  // Which keys exist right now, so a stale selection is skipped, not applied
  const known = new Set()
  for (const c of diff.cards) { known.add(c.key); for (const ch of c.changes) known.add(ch.key) }
  for (const o of diff.other) known.add(o.key)
  let skipped = [...wanted].filter(k => !known.has(k)).length

  const befores = new Map()
  const touch = id => { if (!befores.has(id)) befores.set(id, rowOf(d, 'cards', id)) }
  const others = new Map()   // table:id -> { table, id, before }: the rows other than cards that are changed
  const files = []
  const touchRow = (table, id) => { const k = `${table}:${id}`; if (!others.has(k)) others.set(k, { table, id, before: rowOf(d, table, id) }) }
  const writeRow = (table, row) => { const cols = Object.keys(row); d.prepare(`INSERT OR REPLACE INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...cols.map(c => row[c])) }
  const slugOf = (db, fid) => db.prepare('SELECT slug FROM fields WHERE id = ?').get(fid)?.slug
  let restored = 0

  d.transaction(() => {
    for (const c of diff.cards) {
      if (c.kind === 'added' && wanted.has(`card:${c.id}:added`)) {
        touch(c.id)
        d.prepare('UPDATE cards SET deleted = 1, updated_at = ? WHERE id = ?').run(now, c.id)
        restored++
      } else if (c.kind === 'removed' && wanted.has(`card:${c.id}:removed`)) {
        if (!c.restorable) { skipped++; continue }
        touch(c.id)
        const old = A.prepare('SELECT * FROM cards WHERE id = ?').get(c.id)
        const oldValues = JSON.parse(old.fields_json || '{}')
        const values = {}
        for (const f of A.prepare('SELECT id, slug FROM fields WHERE set_id = ?').all(old.set_id)) {
          const slug = slugOf(d, f.id)
          if (slug && f.slug in oldValues) values[slug] = oldValues[f.slug]
        }
        const template = old.template_id && d.prepare('SELECT 1 FROM templates WHERE id = ?').get(old.template_id) ? old.template_id : null
        const back = old.back_template_id && d.prepare('SELECT 1 FROM templates WHERE id = ?').get(old.back_template_id) ? old.back_template_id : null
        const codeTaken = old.card_code && d.prepare('SELECT 1 FROM cards WHERE card_code = ? AND id != ?').get(old.card_code, c.id)
        const existing = d.prepare('SELECT created_at FROM cards WHERE id = ?').get(c.id)
        d.prepare(
          `INSERT OR REPLACE INTO cards (id, set_id, card_code, template_id, back_template_id, quantity, fields_json, sort_order, deleted, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
        ).run(c.id, old.set_id, codeTaken ? null : old.card_code, template, back, old.quantity, JSON.stringify(values), old.sort_order, existing?.created_at ?? old.created_at ?? now, now)
        restored++
      } else if (c.kind === 'changed') {
        for (const ch of c.changes) {
          if (!wanted.has(ch.key)) continue
          const old = A.prepare('SELECT * FROM cards WHERE id = ?').get(c.id)
          touch(c.id)
          if (ch.kind === 'name') {
            // the name is the value of the set's display field
            const slug = d.prepare('SELECT s.display_field AS slug FROM sets s JOIN cards c ON c.set_id = s.id WHERE c.id = ?').get(c.id)?.slug
            if (!slug) { skipped++; continue }
            const live = JSON.parse(d.prepare('SELECT fields_json FROM cards WHERE id = ?').get(c.id).fields_json || '{}')
            live[slug] = old.display_name
            d.prepare('UPDATE cards SET fields_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(live), now, c.id)
          }
          else if (ch.kind === 'quantity') d.prepare('UPDATE cards SET quantity = ?, updated_at = ? WHERE id = ?').run(old.quantity, now, c.id)
          else if (ch.kind === 'template') {
            if (old.template_id && !d.prepare('SELECT 1 FROM templates WHERE id = ?').get(old.template_id)) { skipped++; continue }
            d.prepare('UPDATE cards SET template_id = ?, updated_at = ? WHERE id = ?').run(old.template_id, now, c.id)
          } else if (ch.kind === 'back') {
            if (old.back_template_id && !d.prepare('SELECT 1 FROM templates WHERE id = ?').get(old.back_template_id)) { skipped++; continue }
            d.prepare('UPDATE cards SET back_template_id = ?, updated_at = ? WHERE id = ?').run(old.back_template_id ?? null, now, c.id)
          } else if (ch.kind === 'code') {
            if (old.card_code && d.prepare('SELECT 1 FROM cards WHERE card_code = ? AND id != ?').get(old.card_code, c.id)) { skipped++; continue }
            d.prepare('UPDATE cards SET card_code = ?, updated_at = ? WHERE id = ?').run(old.card_code, now, c.id)
          } else if (ch.kind === 'field') {
            const fid = ch.key.split(':field:')[1]
            const oldSlug = slugOf(A, fid), curSlug = slugOf(d, fid)
            if (!oldSlug || !curSlug) { skipped++; continue }
            const live = JSON.parse(d.prepare('SELECT fields_json FROM cards WHERE id = ?').get(c.id).fields_json || '{}')
            const before = JSON.parse(old.fields_json || '{}')
            if (oldSlug in before) live[curSlug] = before[oldSlug]; else delete live[curSlug]
            d.prepare('UPDATE cards SET fields_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(live), now, c.id)
          }
          restored++
        }
      }
    }

    // Templates ("use the old version") and pictures that were deleted ("bring this image back")
    for (const o of diff.other) {
      if (!wanted.has(o.key)) continue
      const [area, id] = o.key.split(':')
      if (area === 'template' && (o.kind === 'changed' || o.kind === 'removed')) {
        const old = A.prepare('SELECT * FROM templates WHERE id = ?').get(id)
        if (!old) { skipped++; continue }
        touchRow('templates', id)
        if (old.parent_id && !d.prepare('SELECT 1 FROM templates WHERE id = ?').get(old.parent_id)) old.parent_id = null
        writeRow('templates', { ...old, updated_at: now })
        restored++
      } else if (area === 'rules' && (o.kind === 'changed' || o.kind === 'removed')) {
        const old = A.prepare('SELECT * FROM rules_pages WHERE id = ?').get(id)
        if (!old) { skipped++; continue }
        touchRow('rules_pages', id)
        if (old.parent_id && !d.prepare('SELECT 1 FROM rules_pages WHERE id = ?').get(old.parent_id)) old.parent_id = null
        writeRow('rules_pages', { ...old, updated_at: now })
        restored++
      } else if (area === 'asset' && o.kind === 'removed') {
        const old = A.prepare('SELECT * FROM assets WHERE id = ?').get(id)
        const from = old && join(s.from.dir, 'assets', old.filename)
        if (!old || !existsSync(from) || d.prepare('SELECT 1 FROM assets WHERE id = ? OR filename = ?').get(id, old.filename)) { skipped++; continue }
        mkdirSync(join(dirOf(ctx), 'assets'), { recursive: true })
        copyFileSync(from, join(dirOf(ctx), 'assets', old.filename))
        touchRow('assets', id)
        writeRow('assets', old)
        files.push({ name: old.filename, presentAfter: true })
        restored++
      } else skipped++
    }
    syncCounters(d, [...new Set([...befores.keys()].map(id => d.prepare('SELECT set_id FROM cards WHERE id = ?').get(id)?.set_id).filter(Boolean))])
  })()

  recordChange(d, 'RESTORE_FROM_SNAPSHOT', [
    ...[...befores].map(([id, before]) => ({ table: 'cards', before, after: rowOf(d, 'cards', id) })),
    ...[...others.values()].map(o => ({ table: o.table, before: o.before, after: rowOf(d, o.table, o.id) }))
  ], files)
  return { restored, skipped }
}
