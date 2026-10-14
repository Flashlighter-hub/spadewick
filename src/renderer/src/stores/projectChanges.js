/**
 * What changed in the project (UPDATES U6): the main process tells the window once, whoever made the change (an edit, an import, an undo, a
 * restored snapshot). It is passed on as a window event, `spadewick:project-changed`, with `detail` = { all, cards }, so that anything
 * that shows the project (the virtual table) can look again at exactly what changed, and nothing needs to know where the change came from.
 */
export const PROJECT_CHANGED = 'spadewick:project-changed'

if (typeof window !== 'undefined' && window.spadewick?.onProjectChanged) {
  window.spadewick.onProjectChanged(change => window.dispatchEvent(new CustomEvent(PROJECT_CHANGED, { detail: change })))
}
