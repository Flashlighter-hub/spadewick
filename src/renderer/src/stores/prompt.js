import { writable } from 'svelte/store'

/**
 * Ask the user for a line of text. Electron does not implement window.prompt(), so the app shows
 * its own dialog (PromptDialog.svelte). Resolves to the text, or null when cancelled.
 */
export const promptRequest = writable(null)

/**
 * Ask a yes-or-no question in the application's own dialog (ConfirmDialog.svelte). Resolves to true or false. This replaces the browser's
 * confirm(), which in Electron takes the window's keyboard focus away until the person switches to another window and back (UPDATES U1).
 */
export const confirmRequest = writable(null)

export function askConfirm(message) {
  return new Promise(resolve => confirmRequest.set({ message: String(message ?? ''), resolve }))
}

export function askText(message, initial = '') {
  return new Promise(resolve => promptRequest.set({ message, initial, resolve }))
}
