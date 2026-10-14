/**
 * The project's change signal (UPDATES U6): one small event that says what changed in the project, whoever changed it (an edit, an import,
 * an undo, a restored snapshot), so that whatever shows the project (the virtual table, a preview, later a host sending to its guests,
 * PRD §22.0) can look again at exactly that and nothing else.
 *
 *   { all: true }             something that can change how every card looks changed (a template, a font, an icon, a set's settings…)
 *   { cards: [card ids] }     only these cards changed (their data, their template, or they were added, deleted or restored)
 *
 * The signal knows nothing of windows: whoever wants it subscribes with `onProjectChange`. Changes made in quick succession are joined
 * into one event, so an import of a thousand cards is one signal.
 */

/** Tables whose rows never change how a card looks. */
const NOT_SEEN = new Set(['rules_pages', 'icc_profiles', 'print_colors', 'export_profiles', 'saved_views'])
const JOIN_MS = 40

const listeners = new Set()
let pending = null
let timer = null

/** Be told of every change; returns the way to stop. */
export function onProjectChange(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** What a list of recorded row changes ({ table, before, after }) means for what is on screen. */
export function changeOfRows(changes) {
  const out = { all: false, cards: [] }
  for (const c of changes) {
    if (NOT_SEEN.has(c.table)) continue
    if (c.table === 'cards') { const id = c.after?.id ?? c.before?.id; if (id) out.cards.push(id) } else out.all = true
  }
  return out
}

/** Say that something changed. `{ all: true }` when nothing narrower is known. */
export function announce(change = { all: true }) {
  if (!change.all && !change.cards?.length) return
  pending = pending ?? { all: false, cards: new Set() }
  if (change.all) pending.all = true
  for (const id of change.cards ?? []) pending.cards.add(id)
  if (listeners.size && !timer) {
    timer = setTimeout(flushProjectChanges, JOIN_MS)
    timer.unref?.()
  }
}

/** Send what is waiting now (a test, or a caller that cannot wait). */
export function flushProjectChanges() {
  clearTimeout(timer); timer = null
  const change = pending
  pending = null
  if (!change) return
  const event = change.all ? { all: true, cards: [] } : { all: false, cards: [...change.cards] }
  for (const fn of listeners) { try { fn(event) } catch { /* a listener that fails must not stop the others */ } }
}
