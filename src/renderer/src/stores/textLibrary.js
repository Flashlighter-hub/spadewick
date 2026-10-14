/**
 * The project's icons, text styles and keyword rules as the interface needs them (PRD §16.4, §16.5): the rich text editor
 * lists them, the card table and previews draw with them, and the dialogs edit them. Reloaded when a project opens, after
 * an edit in a dialog, and after an undo or redo.
 */
import { writable, derived, get } from 'svelte/store'
import { project } from './project.js'
import { iconKey } from '../../../shared/richText.js'

const EMPTY = { icons: [], builtIn: [], ambiguous: [] }

export const iconLibrary = writable(EMPTY)
export const textStyles = writable([])
export const keywordRules = writable([])

/** name or alias -> the library icon, for drawing and picking */
export const iconsByKey = derived(iconLibrary, $lib => {
  const map = new Map()
  for (const i of $lib.icons) map.set(i.name, i)
  for (const i of $lib.icons) for (const a of i.aliases) if (!map.has(a)) map.set(a, i)
  return map
})

/** style name -> its properties */
export const stylesByKey = derived(textStyles, $s => new Map($s.map(s => [iconKey(s.name), s.props])))

export async function loadTextLibrary() {
  if (!get(project)) { iconLibrary.set(EMPTY); textStyles.set([]); keywordRules.set([]); return }
  try {
    const [icons, styles, rules] = await Promise.all([window.spadewick.icons.list(), window.spadewick.textStyles.list(), window.spadewick.keywords.list()])
    iconLibrary.set(icons); textStyles.set(styles); keywordRules.set(rules)
  } catch { /* the project was closed while loading */ }
}

// Load whenever the project changes, and after an undo or redo (which can change icons, styles and rules)
project.subscribe(loadTextLibrary)
if (typeof window !== 'undefined') {
  window.addEventListener('spadewick:history-applied', loadTextLibrary)
  window.addEventListener('spadewick:text-library-changed', loadTextLibrary)
}
