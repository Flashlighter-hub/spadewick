/**
 * Which text engine a project uses (PRD §16.2). A project made before the engine drew its text with the earlier
 * per-character estimate; the first time such a project is opened it moves to the engine, and wrapping may then
 * differ. This module does that move, and lets the engine be switched off again for one project.
 */
import { dbOf, dirOf } from './context.js'
import { buildCardSvg, effectiveTemplateId, textEngineOf } from '../render.js'
import { writeSnapshot } from '../snapshotCore.js'
import { logError } from '../log.js'
import { tr } from '../../shared/i18n.js'

const ENGINES = ['outlines', 'estimate']
const putMeta = (d, value) => d.prepare('INSERT OR REPLACE INTO project_meta (key, value) VALUES (?, ?)').run('text_engine', value)

/** Switch the open project to one of the engines ('outlines' or 'estimate'). */
export function setTextEngine(ctx, engine) {
  if (!ENGINES.includes(engine)) throw new Error(tr('errors.textEngineInvalid'))
  const d = dbOf(ctx)
  putMeta(d, engine)
  return textEngineOf(d)
}

/**
 * Move a project that has not used the engine yet. Every card is laid out both ways (no pictures are made, only the
 * text step runs) to find the templates whose text changes size or line breaks; if there are any, a snapshot is taken
 * first. Returns what to tell the user, or null when the project already uses an engine.
 * @returns {Promise<{ snapshot: string|null, changedCards: number, templates: string[], notices: string[] } | null>}
 */
export async function upgradeTextEngine(ctx) {
  const dir = dirOf(ctx), d = dbOf(ctx)
  if (d.prepare("SELECT 1 FROM project_meta WHERE key = 'text_engine'").get()) return null

  let changedCards = 0
  const byTemplate = new Map()
  for (const card of d.prepare('SELECT * FROM cards WHERE deleted = 0').all()) {
    const report = { compare: true }
    try { await buildCardSvg(dir, card.id, { report, textEngine: 'outlines' }) } catch { continue } // a card that cannot be drawn is not part of the comparison
    if (!report.changed) continue
    changedCards++
    const tid = effectiveTemplateId(d, card)
    byTemplate.set(tid, (byTemplate.get(tid) ?? 0) + 1)
  }
  const templates = [...byTemplate.keys()].map(id => d.prepare('SELECT name FROM templates WHERE id = ?').get(id)?.name).filter(Boolean)

  let snapshot = null
  if (changedCards) {
    try {
      snapshot = writeSnapshot(dir, d, { id: `pre_text_engine_${Date.now()}`, name: tr('snapshots.textEngineName'), description: tr('snapshots.textEngineDescription') })
    } catch (err) { logError('text-engine:pre-snapshot', err) }
  }
  putMeta(d, 'outlines')
  const notice = changedCards
    ? tr('upgrade.textEngineChanged', { cards: changedCards, templates: templates.join(', ') })
    : tr('upgrade.textEngineSame')
  return { snapshot: snapshot?.id ?? null, changedCards, templates, notices: [notice] }
}
