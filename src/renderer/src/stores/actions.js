import { tr } from '../../../shared/i18n.js'
import { askText, askConfirm } from './prompt.js'
import { get } from 'svelte/store'
import { project, activeSetId, loadSet, refreshProject } from './project.js'
import { toast, activeTab } from './ui.js'

/** Project-level actions shared by the menu bar and the welcome screen. */
export async function newProject() {
  const name = await askText(tr('actions.promptProjectName'))
  if (!name?.trim()) return
  try {
    await window.spadewick.projects.create({ name: name.trim() })
    activeSetId.set(null)
    await refreshProject()
    activeTab.set('cards')
  } catch (err) { toast(err.message, 'error', 5000) }
}

/**
 * A project whose database fails its integrity check is not opened as-is: the user is offered the
 * most recent snapshot (PRD §14.2). Returns the state to show, or null if the project stays closed.
 */
async function offerRecovery(state) {
  const [latest] = await window.spadewick.snapshots.list()
  if (!latest) {
    alert(tr('actions.noSnapshots', { error: state.error }))
    return null
  }
  const when = new Date(latest.created_at).toLocaleString()
  if (!await askConfirm(tr('actions.offerRestore', { error: state.error, name: latest.name, when }))) return null
  try {
    await window.spadewick.snapshots.restore(latest.id)
    toast(tr('actions.restored', { name: latest.name }), 'info', 4000)
    return await window.spadewick.projects.getMeta()
  } catch (err) {
    toast(tr('actions.restoreFailed', { reason: err.message }), 'error', 6000)
    return null
  }
}

export async function openProject(path, { file = false } = {}) {
  try {
    let state = file ? await window.spadewick.projects.openFile() : await window.spadewick.projects.open(path)
    if (!state) return
    if (state.corrupt) { state = await offerRecovery(state); if (!state) { await window.spadewick.projects.close(); return } }
    activeSetId.set(null)
    await loadSet(null)
    project.set(state)
    activeTab.set('cards')
    // An older project was brought up to date (a snapshot was taken first): say what changed (PRD §5.8)
    if (state.upgrade) {
      toast(tr('toasts.upgraded'), 'info', 7000)
      for (const notice of state.upgrade.notices ?? []) toast(notice, 'info', 9000)
    }
    // The project moved to the text engine (PRD §16.2): say whether any card's text changed
    for (const notice of state.textEngine?.notices ?? []) toast(notice, 'info', 12000)
  } catch (err) { toast(err.message, 'error', 8000) }
}

export async function closeProject() {
  if (!get(project)) return
  await window.spadewick.projects.close()
  activeSetId.set(null)
  await loadSet(null)
  project.set(null)
}

export async function duplicateProject() {
  const current = get(project)
  if (!current) return
  const newName = await askText(tr('actions.promptCopyName'), tr('actions.defaultCopyName', { name: current.meta?.name ?? tr('actions.project') }))
  if (!newName?.trim()) return
  const targetDir = await window.spadewick.app.pickDirectory()
  if (!targetDir) return
  try {
    const res = await window.spadewick.projects.duplicate({ targetDir, newName: newName.trim() })
    toast(tr('actions.duplicated', { path: res.path }), 'info', 4000)
  } catch (err) { toast(err.message, 'error', 5000) }
}

export function revealProject() {
  if (get(project)) window.spadewick.projects.reveal()
}

/** Ask for a name and create a snapshot of the open project. Returns the snapshot, or null if cancelled. */
export async function createSnapshotInteractive() {
  if (!get(project)) return null
  const name = await askText(tr('actions.promptSnapshotName'))
  if (!name?.trim()) return null
  const description = await askText(tr('actions.promptSnapshotDescription')) ?? ''
  try {
    const snap = await window.spadewick.snapshots.create({ name: name.trim(), description })
    toast(tr('actions.snapshotCreated'), 'info', 2000)
    window.dispatchEvent(new Event('spadewick:snapshots-changed'))
    return snap
  } catch (err) { toast(tr('actions.snapshotFailed', { reason: err.message }), 'error', 5000); return null }
}
