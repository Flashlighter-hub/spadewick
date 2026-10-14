/** Saved export settings (PRD §17.8): a name and the options of an export, to choose again in the dialog. */
import { randomUUID } from 'crypto'
import { dbOf } from './context.js'
import { recordChange, rowOf, changesFor } from './history.js'
import { tr } from '../../shared/i18n.js'

const present = r => ({ id: r.id, name: r.name, kind: r.kind, options: JSON.parse(r.options || '{}') })

export const list = (ctx, opts) => dbOf(ctx).prepare('SELECT * FROM export_profiles WHERE kind = ? ORDER BY name').all(opts?.kind ?? 'production').map(present)

/** Save under a name: a new entry, or the one that already has the name. */
export function save(ctx, { name, kind, options }) {
  const d = dbOf(ctx)
  const n = String(name ?? '').trim()
  if (!n || n.length > 60) throw new Error(tr('errors.exportProfileName'))
  const json = JSON.stringify(options ?? {})
  if (json.length > 20000) throw new Error(tr('errors.exportProfileName'))
  const existing = d.prepare('SELECT * FROM export_profiles WHERE name = ?').get(n)
  if (existing) {
    const before = rowOf(d, 'export_profiles', existing.id)
    d.prepare('UPDATE export_profiles SET options = ?, kind = ? WHERE id = ?').run(json, kind ?? existing.kind, existing.id)
    recordChange(d, 'UPDATE_EXPORT_PROFILE', changesFor(d, 'export_profiles', [before]))
    return present(rowOf(d, 'export_profiles', existing.id))
  }
  const id = randomUUID()
  d.prepare('INSERT INTO export_profiles (id, name, kind, options, created_at) VALUES (?, ?, ?, ?, ?)').run(id, n, kind ?? 'production', json, Date.now())
  recordChange(d, 'CREATE_EXPORT_PROFILE', [{ table: 'export_profiles', before: null, after: rowOf(d, 'export_profiles', id) }])
  return present(rowOf(d, 'export_profiles', id))
}

export function remove(ctx, id) {
  const d = dbOf(ctx)
  const before = rowOf(d, 'export_profiles', id)
  if (!before) return
  d.prepare('DELETE FROM export_profiles WHERE id = ?').run(id)
  recordChange(d, 'DELETE_EXPORT_PROFILE', [{ table: 'export_profiles', before, after: null }])
}
