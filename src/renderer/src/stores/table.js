/**
 * The open virtual table (PRD §7.9, §22.0). It is kept here, not in the view, so that looking at another tab does not lose it.
 * What a table is, and every move on it, is in shared/table.js; this file holds the session, what it was saved as, and whether the table
 * is shared with other players.
 *
 * Three ways a table can be:
 *   solo   played alone: the session here is the table.
 *   host   shared by this player: the host's table (shared/tableNet.js) is the one that is right, and its session is the one kept here. What the
 *          player sees of it is their own view (`tableState`): their hand, and the others as a number of cards.
 *   guest  somebody else's table: the session here only holds the view the host last described; every move is asked of the host.
 */
import { writable, derived, get } from 'svelte/store'
import { createSession, dispatch, dispatchAll, undo, redo, refreshSession } from '../../../shared/table.js'
import { tr } from '../../../shared/i18n.js'
import { createHost, viewFor } from '../../../shared/tableNet.js'
import { createHostLink, createGuestLink } from '../lib/tableLink.js'
import { LinkError } from '../lib/rtcCode.js'
import { appRender } from '../lib/tableLinkApp.js'
import { setRemote, clearPictures, invalidateCards } from '../lib/tableImages.js'
import { PROJECT_CHANGED } from './projectChanges.js'
import { activeTab } from './ui.js'

export const tableSession = writable(null)     // { initial, state, past, future, log } or null while there is no table
export const tableName = writable('')          // the name it was saved under
export const tableId = writable(null)          // the file it was saved in
export const savedSteps = writable(0)          // how many steps the table had when it was saved or opened
export const tableMode = writable('solo')      // 'solo' | 'host' | 'guest'

/** About sharing: who is at the table, who you are, and how the connection is. */
export const shareInfo = writable({ peers: [], players: [], you: null, status: 'idle', ticket: null, name: '', iceServers: [] })

let hostLink = null
let guestLink = null

/** What this player sees of the table: all of it when played alone, their own hand and the others' counts when shared. */
export const tableState = derived([tableSession, tableMode], ([s, mode]) => {
  if (!s) return null
  if (mode === 'host' && hostLink) return viewFor(s.state, hostLink.host.hostSeat, { guest: false })
  return s.state
})

export function startTable(state, { name = '', id = null, steps = 0 } = {}) {
  tableSession.set(createSession(state))
  tableName.set(name)
  tableId.set(id)
  savedSteps.set(steps)
}

export function closeTable() {
  if (get(tableMode) === 'host') stopHosting()
  if (get(tableMode) === 'guest') leaveTable()
  tableSession.set(null); tableName.set(''); tableId.set(null); savedSteps.set(0)
}

// ---------------------------------------------------------------------------
// Moves: by the mode of the table
// ---------------------------------------------------------------------------

export const act = action => {
  const mode = get(tableMode)
  if (mode === 'guest') guestLink?.act(action)
  else if (mode === 'host') hostLink.act(action)
  else tableSession.update(s => (s ? dispatch(s, action) : s))
}
export const actAll = actions => {
  const mode = get(tableMode)
  if (mode === 'guest') guestLink?.actAll(actions)
  else if (mode === 'host') hostLink.actAll(actions)
  else tableSession.update(s => (s ? dispatchAll(s, actions) : s))
}
export const undoTable = () => {
  const mode = get(tableMode)
  if (mode === 'guest') guestLink?.undo()
  else if (mode === 'host') hostLink.undo()
  else tableSession.update(s => (s ? undo(s) : s))
}
export const redoTable = () => {
  const mode = get(tableMode)
  if (mode === 'guest') guestLink?.redo()
  else if (mode === 'host') hostLink.redo()
  else tableSession.update(s => (s ? redo(s) : s))
}

/** What the project now says about cards on the table: names, backs, cards gone (not a move: it is not undone and not in the log). */
export const refreshTable = info => {
  const mode = get(tableMode)
  if (mode === 'guest') return
  if (mode === 'host') hostLink.refresh(info)
  else tableSession.update(s => (s ? refreshSession(s, info) : s))
}

/** True when the table has been changed since it was saved (or opened). */
export const tableChanged = () => { const s = get(tableSession); return get(tableMode) !== 'guest' && !!s && s.log.length !== get(savedSteps) }

// ---------------------------------------------------------------------------
// The project changes under the table (UPDATES U6)
// ---------------------------------------------------------------------------

/**
 * The project changed (a card, a template, a font, which template a set or card uses…): draw again what changed and update the names.
 * This is heard here, not by the table's view, because the view is not there while another tab is shown, and a template that was edited
 * in the meantime must already be right when the table is looked at again. A guest has no project: the host says what changed.
 */
async function onProjectChanged(e) {
  const mode = get(tableMode)
  const session = get(tableSession)
  if (!session || mode === 'guest') return
  const { all, cards } = e.detail ?? {}
  const onTable = new Set(Object.values(session.state.cards).map(c => c.id))
  const ids = all ? [...onTable] : (cards ?? []).filter(id => onTable.has(id))
  if (all) clearPictures(); else if (ids.length) invalidateCards(ids); else return
  if (mode === 'host') hostLink?.redraw()                    // the players draw their pictures again too
  if (!ids.length) return
  try { refreshTable(await window.spadewick.table.cardInfo({ ids })) } catch { /* the project is closed: nothing to look at */ }
}
if (typeof window !== 'undefined') window.addEventListener(PROJECT_CHANGED, onProjectChanged)

// ---------------------------------------------------------------------------
// Hosting
// ---------------------------------------------------------------------------

const publish = () => {
  if (!hostLink) return
  tableSession.set(hostLink.host.session)
  shareInfo.update(i => ({ ...i, players: hostLink.host.players(), peers: hostLink.peers }))
}

/**
 * Share the table that is open: from now on players can be invited, and this player sees only their own hand.
 * @returns {boolean} false when there is no table, or it is shared already
 */
export function startHosting({ name = 'Host', iceServers = [] } = {}) {
  const s = get(tableSession)
  if (!s || get(tableMode) !== 'solo') return false
  const host = createHost({ state: s.state, session: s, name })
  hostLink = createHostLink({ host, render: appRender, iceServers, onChange: publish, onPeers: peers => shareInfo.update(i => ({ ...i, peers, players: host.players() })) })
  shareInfo.set({ peers: [], players: host.players(), you: { peer: 'host', name, seat: host.hostSeat }, status: 'hosting', ticket: null, name, iceServers })
  tableMode.set('host')
  publish()
  return true
}

/** Stop sharing: every player is let go, and the table goes on as the player's own, with every hand as it is. */
export function stopHosting() {
  if (!hostLink) return
  const session = hostLink.host.session
  hostLink.close()
  hostLink = null
  tableMode.set('solo')
  tableSession.set(session)
  shareInfo.set({ peers: [], players: [], you: null, status: 'idle', ticket: null, name: '', iceServers: [] })
}

/** The host's link, for the dialog that invites players (null when the table is not shared by this player). */
export const hosting = () => hostLink

// ---------------------------------------------------------------------------
// Joining
// ---------------------------------------------------------------------------

/**
 * Answer an invitation to somebody else's table. Resolves with the answer to give back to the host; the table arrives (and this window
 * shows it) once the host has accepted the answer.
 * @param {string} offerCode
 * @param {{ name?: string, ticket?: string, iceServers?: object[] }} [opts]   `ticket` from an earlier try gives the seat back
 */
export async function joinTable(offerCode, { name = 'Guest', ticket, iceServers = [] } = {}) {
  if (get(tableMode) === 'host') throw new LinkError('hosting', tr('tableShare.alreadyHosting'))
  const wasGuest = get(tableMode) === 'guest'
  guestLink?.leave()
  const link = createGuestLink({
    name, ticket, iceServers,
    onChange: view => {
      if (get(tableMode) !== 'guest') activeTab.set('table')
      tableMode.set('guest')
      tableSession.set({ initial: view, state: view, past: [], future: [], log: [] })
      tableName.set(''); tableId.set(null)
      shareInfo.update(i => ({ ...i, status: 'joined', you: link.you, players: link.players }))
    },
    onPlayers: players => shareInfo.update(i => ({ ...i, players, you: link.you })),
    onClose: () => { if (guestLink === link) shareInfo.update(i => ({ ...i, status: 'closed' })) },
    onRedraw: () => clearPictures()
  })
  guestLink = link
  setRemote(link)
  shareInfo.set({ peers: [], players: [], you: null, status: 'connecting', ticket: link.ticket, name, iceServers })
  if (!wasGuest) tableSession.set(null)
  try { return await link.join(offerCode) } catch (err) { shareInfo.update(i => ({ ...i, status: 'closed' })); throw err }
}

/** Leave somebody else's table: the table goes from this window. */
export function leaveTable() {
  guestLink?.leave()
  guestLink = null
  setRemote(null)
  tableMode.set('solo')
  tableSession.set(null); tableName.set(''); tableId.set(null); savedSteps.set(0)
  shareInfo.set({ peers: [], players: [], you: null, status: 'idle', ticket: null, name: '', iceServers: [] })
}

/** Take another free seat at somebody else's table, or watch (null). */
export const takeSeat = seat => guestLink?.takeSeat(seat)
/** Tell the table by what name to call this player. */
export const renameSelf = name => guestLink?.rename(name)

