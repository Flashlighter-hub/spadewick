import { writable, derived, get } from 'svelte/store'

// The full project state returned from projects:open / projects:get-meta
export const project = writable(null)

// Active set ID
export const activeSetId = writable(null)

// Active card IDs (multi-select)
export const selectedCardIds = writable([])

// Cards for the active set — loaded on set change
export const cards = writable([])

// Fields for the active set
export const fields = writable([])

// The templates the active set can use: those of its card size (PRD §10.6)
export const templates = writable([])

// Derived: all sets in the open project
export const sets = derived(project, $project => $project?.sets ?? [])

// Derived: the active set object
export const activeSet = derived(
  [project, activeSetId],
  ([$project, $activeSetId]) =>
    $project?.sets?.find(s => s.id === $activeSetId) ?? null
)

// Derived: card count for status bar
export const cardCount = derived(cards, $cards => $cards.length)

// Load cards and fields for the given set
export async function loadSet(setId) {
  if (!setId) { cards.set([]); fields.set([]); templates.set([]); return }
  const [c, f, t] = await Promise.all([
    window.spadewick.cards.list(setId),
    window.spadewick.fields.list(setId),
    window.spadewick.templates.list({ setId })
  ])
  cards.set(c)
  fields.set(f)
  templates.set(t)
  selectedCardIds.set([])
}

/** Look again at the templates the active set can use (after one was made, deleted, or the set's size changed). */
export async function refreshTemplates() {
  const setId = get(activeSetId)
  // the project may have been closed while this was on its way: then there is nothing to list
  try { templates.set(setId ? await window.spadewick.templates.list({ setId }) : []) } catch { /* no project open */ }
}

export async function refreshProject() {
  const state = await window.spadewick.projects.getMeta()
  project.set(state)
  return state
}
