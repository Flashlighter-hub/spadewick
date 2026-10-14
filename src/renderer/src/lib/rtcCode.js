/**
 * Connection codes (PRD §22.0): what two players trade, by any way they like (a message, an email, spoken over a call), to join a table
 * without a server. A code is the connection description of one side (WebRTC's "SDP"), squeezed (deflate) and written as one line of
 * letters and digits:
 *
 *   SPW1-O-1A2B-<text>      an invitation, made by the host for one guest
 *   SPW1-A-1A2B-<text>      the answer, made by the guest and given back to the host
 *
 * The four characters after the kind check that the code was copied whole. Whatever is pasted is untrusted: it is checked for its shape
 * and size before it is given to the browser.
 */
import { tr } from '../../../shared/i18n.js'

export const CODE_PREFIX = 'SPW1'
const MAX_CODE_CHARS = 24000          // a description with every address of a machine is about 2,000 once squeezed
const MAX_SDP_BYTES = 64 * 1024

/** An error with a sentence for the person, and a `code` for the program. */
export class LinkError extends Error {
  constructor(code, message) { super(message); this.name = 'LinkError'; this.code = code }
}

function crc16(bytes) {
  let crc = 0xffff
  for (const b of bytes) {
    crc ^= b << 8
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

const toBase64Url = bytes => {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const fromBase64Url = text => {
  const s = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

async function through(bytes, stream, limit = Infinity) {
  const reader = new Blob([bytes]).stream().pipeThrough(stream).getReader()
  const chunks = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > limit) { await reader.cancel(); throw new LinkError('tooBig', tr('shareLink.codeTooBig')) }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let at = 0
  for (const c of chunks) { out.set(c, at); at += c.length }
  return out
}

/** The code for a description: kind is 'offer' (an invitation) or 'answer'. */
export async function packCode(kind, sdp) {
  if (kind !== 'offer' && kind !== 'answer') throw new LinkError('kind', tr('shareLink.codeFormat'))
  const raw = new TextEncoder().encode(sdp)
  if (raw.length > MAX_SDP_BYTES) throw new LinkError('tooBig', tr('shareLink.codeTooBig'))
  const squeezed = await through(raw, new CompressionStream('deflate-raw'))
  return `${CODE_PREFIX}-${kind === 'offer' ? 'O' : 'A'}-${crc16(squeezed)}-${toBase64Url(squeezed)}`
}

/**
 * The kind and description in a code, as pasted (spaces and line breaks in it are ignored).
 * @param {string} text
 * @param {'offer'|'answer'} [expect] the kind that is wanted: the other kind is refused with a sentence that says so
 * @returns {Promise<{ kind: 'offer'|'answer', sdp: string }>}
 */
export async function unpackCode(text, expect) {
  const code = String(text ?? '').replace(/\s+/g, '')
  if (code.length > MAX_CODE_CHARS) throw new LinkError('tooBig', tr('shareLink.codeTooBig'))
  const m = /^SPW1-([OA])-([0-9A-F]{4})-([A-Za-z0-9_-]+)$/.exec(code)
  if (!m) throw new LinkError('format', tr('shareLink.codeFormat'))
  const kind = m[1] === 'O' ? 'offer' : 'answer'
  if (expect && kind !== expect) throw new LinkError('kind', expect === 'offer' ? tr('shareLink.codeNotInvitation') : tr('shareLink.codeNotAnswer'))
  let squeezed
  try { squeezed = fromBase64Url(m[3]) } catch { throw new LinkError('format', tr('shareLink.codeFormat')) }
  if (crc16(squeezed) !== m[2]) throw new LinkError('checksum', tr('shareLink.codeChecksum'))
  let sdp
  try { sdp = new TextDecoder('utf-8', { fatal: true }).decode(await through(squeezed, new DecompressionStream('deflate-raw'), MAX_SDP_BYTES)) }
  catch (err) { throw err instanceof LinkError ? err : new LinkError('format', tr('shareLink.codeFormat')) }
  if (!sdp.startsWith('v=0')) throw new LinkError('format', tr('shareLink.codeFormat'))
  return { kind, sdp }
}
