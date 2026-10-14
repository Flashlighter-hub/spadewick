/**
 * How the user has arranged the interface (PRD §12.5): the widths and heights of the panels and whether the
 * template list is open. Kept in the application settings (`ui_layout`), so it survives restarts and travels
 * with a portable install. Every value has a minimum and a maximum so a panel can never be dragged out of reach.
 */
import { writable, get } from 'svelte/store'

export const LIMITS = {
  sidebar:      { min: 160, max: 420, reset: 220 },
  templateList: { min: 140, max: 360, reset: 190 },
  props:        { min: 220, max: 560, reset: 280 },
  preview:      { min: 160, max: 520, reset: 220 },
  propsSplit:   { min: 0.15, max: 0.85, reset: 0.5 }   // share of the right panel given to properties; the rest is layers
}

const DEFAULTS = {
  sidebar: LIMITS.sidebar.reset,
  templateList: LIMITS.templateList.reset,
  templateListOpen: true,
  props: LIMITS.props.reset,
  preview: LIMITS.preview.reset,
  propsSplit: LIMITS.propsSplit.reset
}

/** The menu's Small / Medium / Large preview sizes are widths of the preview pane. */
export const PREVIEW_WIDTH = { small: 170, medium: 220, large: 320 }

export const clampTo = (key, value) => {
  const { min, max } = LIMITS[key]
  const v = Number(value)
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : LIMITS[key].reset
}

/** What was stored, with anything missing or out of range put back to its default. */
export function sanitizeLayout(stored) {
  const out = { ...DEFAULTS }
  if (!stored || typeof stored !== 'object') return out
  for (const key of Object.keys(LIMITS)) if (key in stored) out[key] = clampTo(key, stored[key])
  if (typeof stored.templateListOpen === 'boolean') out.templateListOpen = stored.templateListOpen
  return out
}

export const layout = writable({ ...DEFAULTS })

let saveTimer = null
const save = () => {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => { window.spadewick?.settings?.set('ui_layout', get(layout)).catch?.(() => {}) }, 300)
}

/** Read the saved arrangement (call once at start). */
export async function loadLayout() {
  try { layout.set(sanitizeLayout(await window.spadewick.settings.get('ui_layout'))) } catch { /* the defaults are fine */ }
}

/** Change one value; it is limited to its range and saved a moment later. */
export function setLayout(key, value) {
  layout.update(l => ({ ...l, [key]: key === 'templateListOpen' ? !!value : clampTo(key, value) }))
  save()
}

/** Put every panel back to its original size. */
export function resetLayout() {
  layout.set({ ...DEFAULTS })
  save()
}
