/**
 * The pictures of the virtual table's cards (PRD §7.9): drawn once by the application (the card's front or back, in a size that stays
 * sharp when the table is zoomed) and kept while the table is open. Cards that share a back share its picture.
 */
import { writable, get } from 'svelte/store'

export const pictures = writable({})          // key -> data URL, or 'failed'
export const epoch = writable(0)              // goes up whenever pictures are forgotten, so what shows them asks for them again
const requested = new Set()
const queue = []
let running = 0
const LIMIT = 3                                // pictures drawn at once, so the window stays quick

export const PICTURE_WIDTH = 300               // pixels a card is drawn at on the table
export const LARGE_WIDTH = 520                 // pixels a card is drawn at when looked at closely

export const frontKey = (cardId, width) => `f:${width}:${cardId}`
export const backKey = (key, width) => `b:${width}:${key}`

async function pump() {
  while (running < LIMIT && queue.length) {
    const job = queue.shift()
    running++
    job().finally(() => { running--; pump() })
  }
}

/**
 * Where the pictures come from. By default the application draws them (the project's own renderer). At a table shared by somebody else the
 * host draws them and sends them: `setRemote(link)` with a guest link of lib/tableLink.js, and `setRemote(null)` to go back.
 */
let remote = null
export function setRemote(link) { remote = link; clearPictures() }
export const isRemote = () => remote !== null

/** Ask for a picture; the first ask draws it, and `pictures` has it when it is done. */
export function want(key, load) {
  if (requested.has(key)) return
  requested.add(key)
  queue.push(async () => {
    let url = 'failed'
    try { url = `data:image/png;base64,${await load()}` } catch { /* a card with no template or back is shown without a picture */ }
    pictures.update(p => ({ ...p, [key]: url }))
  })
  pump()
}

/** Ask for a picture that is made into an address in the window (an image of the library); `failed` for one that is gone. */
function wantUrl(key, loadUrl) {
  if (requested.has(key)) return
  requested.add(key)
  queue.push(async () => {
    let url = 'failed'
    try { url = (await loadUrl()) || 'failed' } catch { /* an image that was deleted is shown as a plain disc */ }
    pictures.update(p => ({ ...p, [key]: url }))
  })
  pump()
}

/** The picture of an image of the library, for a round token (UPDATES U4): by the key it is kept under. */
export function asset(assetId) {
  const key = `a:${assetId}`
  if (get(pictures)[key] === undefined) {
    if (remote) wantUrl(key, () => remote.picture({ side: 'asset', asset: assetId, width: 300 }))
    else wantUrl(key, async () => {
      const p = await window.spadewick.assets.getPreview(assetId)
      return p ? URL.createObjectURL(new Blob([p.bytes], { type: p.mime })) : null
    })
  }
  return key
}

/** The picture of a card's front: `want` is called for what is not there yet. */
export function front(cardId, width = PICTURE_WIDTH) {
  const key = frontKey(cardId, width)
  const have = get(pictures)[key]
  if (have === undefined) {
    if (remote) wantUrl(key, () => remote.picture({ side: 'front', card: cardId, width }))
    else want(key, () => window.spadewick.templates.render({ cardId, width }))
  }
  return key
}

/** The picture of a card's back, by the key the card table service gave (cards with the same key share the picture). */
export function back(cardId, key, width = PICTURE_WIDTH) {
  const id = backKey(key, width)
  const have = get(pictures)[id]
  if (have === undefined) {
    if (remote) wantUrl(id, () => remote.picture({ side: 'back', card: cardId, back: key, width }))
    else want(id, () => window.spadewick.templates.render({ cardId, width, side: 'back' }))
  }
  return id
}

/** Draw everything again (a template, a font or a card changed). */
export function clearPictures() {
  for (const url of Object.values(get(pictures))) if (typeof url === 'string' && url.startsWith('blob:')) URL.revokeObjectURL(url)
  requested.clear()
  queue.length = 0
  pictures.set({})
  epoch.update(n => n + 1)
}

/** Draw only these cards again (UPDATES U6): their fronts, and the backs that show their own data. */
export function invalidateCards(cardIds) {
  const ends = cardIds.map(id => `:${id}`)
  const stale = key => ends.some(e => key.endsWith(e))
  for (const key of [...requested]) if (stale(key)) requested.delete(key)
  pictures.update(p => Object.fromEntries(Object.entries(p).filter(([key]) => !stale(key))))
  epoch.update(n => n + 1)
}
