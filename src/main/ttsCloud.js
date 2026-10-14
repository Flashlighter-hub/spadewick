/**
 * Steam Cloud links for a Tabletop Simulator saved object (PRD §10.2.4).
 *
 * Spadewick cannot upload to Steam Cloud itself: the person uploads the exported sheets in Tabletop Simulator (Modding, Cloud
 * Manager), copies the address of each, and gives them here. This writes a second JSON whose sheets are those addresses, so
 * the deck loads for anyone the game is shared with. The exported JSON is never changed, so the step can be done again.
 */
import { tr } from '../shared/i18n.js'

const IMAGE_KEYS = new Set(['FaceURL', 'BackURL'])

/** The file name a link points at: the last part of a file link, or the bare name itself (the reverse of `fileLink`). */
export function linkFileName(link) {
  const last = String(link ?? '').split(/[\\/]/).pop()
  return last.replace(/%3F/g, '?').replace(/%23/g, '#').replace(/%25/g, '%')
}

const isWebLink = v => /^https?:\/\/\S+$/i.test(v)

/** Every `FaceURL` / `BackURL` in the object that is not already a web address, as `[holder, key]` pairs. */
function localImageSlots(node, out = []) {
  if (Array.isArray(node)) { for (const n of node) localImageSlots(n, out); return out }
  if (!node || typeof node !== 'object') return out
  for (const [k, v] of Object.entries(node)) {
    if (IMAGE_KEYS.has(k) && typeof v === 'string' && v && !isWebLink(v)) out.push([node, k])
    else localImageSlots(v, out)
  }
  return out
}

/** The sheet and back images a saved object needs uploaded, by file name, in the order they first appear. */
export function ttsImageFiles(doc) {
  return [...new Set(localImageSlots(doc).map(([n, k]) => linkFileName(n[k])))]
}

/**
 * A copy of the saved object with the web address `links[fileName]` in place of every link to `fileName`.
 * @returns {{ doc: object, replaced: number, missing: string[] }} `missing` are images that were given no address
 */
export function applyCloudLinks(doc, links) {
  const clean = {}
  for (const [name, raw] of Object.entries(links ?? {})) {
    const url = String(raw ?? '').trim()
    if (!url) continue
    if (!isWebLink(url)) throw new Error(tr('errors.ttsCloudLinkInvalid', { name, link: url }))
    clean[name] = url
  }
  const copy = JSON.parse(JSON.stringify(doc))
  const missing = new Set()
  let replaced = 0
  for (const [node, key] of localImageSlots(copy)) {
    const name = linkFileName(node[key])
    if (clean[name]) { node[key] = clean[name]; replaced++ } else missing.add(name)
  }
  return { doc: copy, replaced, missing: [...missing] }
}
