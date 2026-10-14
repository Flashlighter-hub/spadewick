import { join } from 'path'
import { existsSync, mkdirSync, renameSync, rmSync } from 'fs'
import { dbOf, projectDirOfDb } from './context.js'
import { announce, changeOfRows } from './changes.js'

/**
 * Undo/redo (PRD §11.2).
 *
 * Every undoable operation records the rows it changed as before/after snapshots:
 *   { table, before: row | null, after: row | null }
 * Undo restores `before` (deleting the row when it is null); redo restores `after`.
 * Because both directions use the same payload, every operation is symmetric and a multi-row
 * operation (bulk edit, import, slug change…) is automatically a single undo step.
 *
 * Asset files are kept in a cache folder while an entry can still be replayed:
 *   files: [{ name, presentAfter }]  — presentAfter tells which side of the change has the file.
 */

const DEFAULT_UNDO_LIMIT = 1000
let undoLimit = DEFAULT_UNDO_LIMIT

/** The number of undo steps kept (a setting of the installation, taken from the context when it is created). */
export function setUndoLimit(limit) {
  undoLimit = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Number(limit) : DEFAULT_UNDO_LIMIT
}

const ALLOWED_TABLES = new Set(['cards', 'fields', 'templates', 'assets', 'palette', 'sets', 'icons', 'text_styles', 'keyword_rules', 'icc_profiles', 'print_colors', 'export_profiles', 'rules_pages', 'saved_views'])

// The folder of a project is found from its database handle, so no function here needs to know which project is "open"
export const undoCacheDir = d => join(projectDirOfDb(d), '.cache', 'undo')

// ---------------------------------------------------------------------------
// Row snapshots
// ---------------------------------------------------------------------------

/** Rows may contain BLOBs (asset thumbnails); JSON cannot carry Buffers, so they are base64-wrapped. */
function serializeRow(row) {
  if (!row) return null
  const out = {}
  for (const [k, v] of Object.entries(row)) out[k] = Buffer.isBuffer(v) ? { __b64: v.toString('base64') } : v
  return out
}

function deserializeRow(row) {
  const out = {}
  for (const [k, v] of Object.entries(row)) out[k] = v && typeof v === 'object' && '__b64' in v ? Buffer.from(v.__b64, 'base64') : v
  return out
}

/** Snapshot of one row (by id), or null if it does not exist. Call before and after mutating. */
export function rowOf(d, table, id) {
  if (!ALLOWED_TABLES.has(table)) throw new Error(`Unknown table: ${table}`)
  return serializeRow(d.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) ?? null)
}

export const rowsOf = (d, table, ids) => ids.map(id => rowOf(d, table, id))

/** Build the change list for rows that were snapshotted before and are re-read after a mutation. */
export function changesFor(d, table, befores, ids = null) {
  return befores.map((before, i) => {
    const id = ids ? ids[i] : before?.id
    return { table, before, after: id == null ? null : rowOf(d, table, id) }
  })
}

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

function discardFiles(d, entries) {
  for (const e of entries) {
    for (const f of JSON.parse(e.payload).files ?? []) {
      // A cached copy exists for files that are absent on one side; clean it up once the entry is gone
      try { rmSync(join(undoCacheDir(d), f.name), { force: true }) } catch { /* best effort */ }
    }
  }
}

/**
 * Record one undoable operation. `changes` that changed nothing are dropped; an operation with no
 * effective change records nothing.
 */
export function recordChange(d, opType, changes, files = []) {
  const effective = changes.filter(c => JSON.stringify(c.before) !== JSON.stringify(c.after))
  if (!effective.length && !files.length) return
  announce(effective.length ? changeOfRows(effective) : { all: true })
  d.prepare('INSERT INTO undo_log (op_type, payload, created_at) VALUES (?, ?, ?)').run(
    opType, JSON.stringify({ changes: effective, files }), Date.now()
  )
  // A new user action invalidates anything that could have been redone
  const staleRedo = d.prepare('SELECT payload FROM redo_log').all()
  if (staleRedo.length) { discardFiles(d, staleRedo); d.prepare('DELETE FROM redo_log').run() }
  // Prune the oldest entries beyond the limit
  const count = d.prepare('SELECT COUNT(*) AS c FROM undo_log').get().c
  if (count > undoLimit) {
    const old = d.prepare('SELECT seq, payload FROM undo_log ORDER BY seq ASC LIMIT ?').all(count - undoLimit)
    discardFiles(d, old)
    d.prepare('DELETE FROM undo_log WHERE seq <= ?').run(old[old.length - 1].seq)
  }
}

/** Put a file that is leaving /assets into the undo cache (so the deletion can be reversed). */
export function stashAssetFile(d, filename) {
  const src = join(projectDirOfDb(d), 'assets', filename)
  if (!existsSync(src)) return false
  mkdirSync(undoCacheDir(d), { recursive: true })
  renameSync(src, join(undoCacheDir(d), filename))
  return true
}

/** Drop everything that could refer to rows that are about to disappear (e.g. a deleted set). */
export function clearHistory(d) {
  discardFiles(d, [...d.prepare('SELECT payload FROM undo_log').all(), ...d.prepare('SELECT payload FROM redo_log').all()])
  d.prepare('DELETE FROM undo_log').run()
  d.prepare('DELETE FROM redo_log').run()
}

// ---------------------------------------------------------------------------
// Replaying
// ---------------------------------------------------------------------------

function writeRow(d, table, row) {
  const cols = Object.keys(row)
  // A row that is still there is updated where it is: replacing it would delete it first, and deleting a set takes its cards and fields with it
  if (d.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(row.id)) {
    try {
      d.prepare(`UPDATE ${table} SET ${cols.filter(c => c !== 'id').map(c => `${c} = ?`).join(', ')} WHERE id = ?`).run(...cols.filter(c => c !== 'id').map(c => row[c]), row.id)
      return
    } catch { /* a unique value another row still holds: the replacement below settles it, as before */ }
  }
  d.prepare(`INSERT OR REPLACE INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .run(...cols.map(c => row[c]))
}

function moveFile(from, to) {
  if (!existsSync(from)) return
  mkdirSync(join(to, '..'), { recursive: true })
  renameSync(from, to)
}

function replay(d, payload, direction) {
  const undo = direction === 'undo'
  const changes = undo ? [...payload.changes].reverse() : payload.changes
  for (const c of changes) {
    if (!ALLOWED_TABLES.has(c.table)) throw new Error(`Unknown table: ${c.table}`)
    const target = undo ? c.before : c.after
    const other = undo ? c.after : c.before
    if (target) writeRow(d, c.table, deserializeRow(target))
    else if (other) d.prepare(`DELETE FROM ${c.table} WHERE id = ?`).run(other.id)
  }
  for (const f of payload.files ?? []) {
    const inAssets = join(projectDirOfDb(d), 'assets', f.name)
    const inCache = join(undoCacheDir(d), f.name)
    const shouldBePresent = undo ? !f.presentAfter : f.presentAfter
    if (shouldBePresent) moveFile(inCache, inAssets)
    else moveFile(inAssets, inCache)
  }
}

// With no project open there is nothing to undo, which is not an error
const openDbOf = ctx => (ctx.project ? dbOf(ctx) : null)

function step(ctx, direction) {
  const d = openDbOf(ctx)
  if (!d) return false
  const [from, to] = direction === 'undo' ? ['undo_log', 'redo_log'] : ['redo_log', 'undo_log']
  const entry = d.prepare(`SELECT * FROM ${from} ORDER BY seq DESC LIMIT 1`).get()
  if (!entry) return false

  try {
    d.transaction(() => {
      const payload = JSON.parse(entry.payload)
      replay(d, payload, direction)
      announce(payload.changes?.length ? changeOfRows(payload.changes) : { all: true })
      d.prepare(`DELETE FROM ${from} WHERE seq = ?`).run(entry.seq)
      d.prepare(`INSERT INTO ${to} (op_type, payload, created_at) VALUES (?, ?, ?)`).run(entry.op_type, entry.payload, Date.now())
    })()
    return true
  } catch (err) {
    // The rows this entry refers to no longer exist (or conflict). Drop it rather than wedging the stack.
    d.prepare(`DELETE FROM ${from} WHERE seq = ?`).run(entry.seq)
    return false
  }
}

export function getStack(ctx) {
  const d = openDbOf(ctx)
  if (!d) return { undo: [], redo: [] }
  const undo = d.prepare('SELECT seq, op_type, created_at FROM undo_log ORDER BY seq DESC LIMIT 50').all()
  const redo = d.prepare('SELECT seq, op_type, created_at FROM redo_log ORDER BY seq DESC LIMIT 50').all()
  return { undo, redo }
}

export const undo = ctx => step(ctx, 'undo')
export const redo = ctx => step(ctx, 'redo')
