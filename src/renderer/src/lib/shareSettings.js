/**
 * What a player chooses about sharing a table, kept in this window between games (PRD §22.0): the name others see, and whether to use a
 * public helper (STUN) to connect across the internet. The helper is off until the player turns it on.
 */
const KEY = 'spadewick.share'
export const DEFAULT_STUN = 'stun:stun.l.google.com:19302'

export function loadShareSettings() {
  const fallback = { name: '', useStun: false, stunUrl: DEFAULT_STUN }
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (!raw || typeof raw !== 'object') return fallback
    return {
      name: typeof raw.name === 'string' ? raw.name.slice(0, 30) : '',
      useStun: raw.useStun === true,
      stunUrl: typeof raw.stunUrl === 'string' && /^stuns?:[^\s]{1,200}$/.test(raw.stunUrl) ? raw.stunUrl : DEFAULT_STUN
    }
  } catch { return fallback }
}

export function saveShareSettings(settings) {
  try { localStorage.setItem(KEY, JSON.stringify(settings)) } catch { /* private window: the choice is only for now */ }
}

/** The ICE servers a choice stands for: none on one network, the helper across the internet. */
export const iceServersOf = ({ useStun, stunUrl }) => (useStun && /^stuns?:[^\s]{1,200}$/.test(stunUrl) ? [{ urls: stunUrl }] : [])
