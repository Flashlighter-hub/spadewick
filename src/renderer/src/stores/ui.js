import { writable } from 'svelte/store'

// Which main tab is active
export const activeTab = writable('cards') // 'cards' | 'template' | 'rules' | 'table' | 'balance' | 'assets' | 'snapshots' | 'help'

// The card whose own version of its template is being edited (UPDATES U29): a card id, or null
export const instanceEdit = writable(null)

// The filter of the card table, per set: { [setId]: { text, viewId } }. Kept while the person is on another tab (UPDATES U25).
export const cardFilters = writable({})

// Project → What Changed Since…: set when asked; the Snapshots panel takes it (sets it back) and asks which snapshot to compare with
export const whatChangedRequest = writable(false)

// Whether the sidebar is visible
export const sidebarVisible = writable(true)

// Card preview size
export const previewSize = writable('medium') // 'small' | 'medium' | 'large'

// Autosave status line text
export const saveStatus = writable('Ready')

// Whether any modal/dialog is open
export const modalStack = writable([])

export function pushModal(id) {
  modalStack.update(s => [...s, id])
}

export function popModal() {
  modalStack.update(s => s.slice(0, -1))
}

// Notification toasts
export const toasts = writable([])
let toastSeq = 0

export function toast(message, type = 'info', durationMs = 3000) {
  const id = ++toastSeq
  toasts.update(t => [...t, { id, message, type }])
  setTimeout(() => toasts.update(t => t.filter(x => x.id !== id)), durationMs)
}

// What the template library dialog was opened for: { intent: 'browse' | 'new-set' | 'save' | 'export' | 'update' | 'reset' | 'import', templateId? }
export const libraryRequest = writable(null)

// Which app-level dialog is open: 'template-rules' | 'fields' | 'find-replace' | 'preferences' | 'fonts' | 'icons' | 'text-styles' | 'check-text' | 'card-ids' | 'template-library' | 'about' | null
export const openDialog = writable(null)

// View-menu commands for the canvas editor: { cmd: 'rulers' | 'grid' | 'snap' | 'guides', n: counter }
// Show me (print preflight, PRD §17.7): open the template editor on an element of a template, with a card that shows the problem
export const showMeRequest = writable(null)
let showMeSeq = 0
export function showMe(target) {
  showMeRequest.set({ ...target, n: ++showMeSeq })
  activeTab.set('template')
}

export const canvasCommand = writable(null)
let canvasSeq = 0
export function sendCanvasCommand(cmd) {
  canvasCommand.set({ cmd, n: ++canvasSeq })
}

// "Navigate to card" requests (from the asset browser): { cardId, setId, n }
export const focusCardRequest = writable(null)
let focusSeq = 0
export function focusCard(setId, cardId) { focusCardRequest.set({ setId, cardId, n: ++focusSeq }) }
