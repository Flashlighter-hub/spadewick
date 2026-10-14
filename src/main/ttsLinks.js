/**
 * The image addresses written into a Tabletop Simulator saved object (PRD §10.2.1).
 *
 * TTS reads `FaceURL` and `BackURL` as addresses: a web address, or a `file:///` path. A bare file name is
 * taken for a web host name ("WWW Image Error: Cannot resolve destination host"), so by default the JSON
 * gets the full local path of each sheet, written as a file link.
 */
import { win32, posix } from 'path'
import { tr } from '../shared/i18n.js'

/**
 * The ways to write the links (the `tts_image_links` setting, PRD §12.3). 'cloud' writes local links like 'local' does;
 * the Steam Cloud addresses are added afterwards (PRD §10.2.4, ttsCloud.js).
 */
export const IMAGE_LINK_MODES = ['local', 'names', 'cloud']

/** Only characters that would change the meaning of a link are encoded; spaces and letters stay as they are. */
const escapeSpecial = s => s.replace(/%/g, '%25').replace(/#/g, '%23').replace(/\?/g, '%3F')

const forwardSlashes = p => p.replace(/\\/g, '/')

/**
 * A file link for an absolute path, in the form TTS reads:
 *   C:\Users\me\My Game\a.png          ->  file:///C:/Users/me/My Game/a.png
 *   \\server\share\a.png               ->  file://server/share/a.png
 *   /Users/me/exports/a.png            ->  file:///Users/me/exports/a.png
 * `platform` is 'win32' for a Windows path and anything else for a macOS or Linux path.
 */
export function fileLink(absPath, platform = process.platform) {
  const p = String(absPath ?? '')
  if (platform === 'win32') {
    if (/^[A-Za-z]:[\\/]/.test(p)) return `file:///${escapeSpecial(forwardSlashes(p))}`
    if (/^[\\/]{2}[^\\/]+[\\/]/.test(p)) return `file:${escapeSpecial(forwardSlashes(p))}`
  } else if (p.startsWith('/')) {
    return `file://${escapeSpecial(p)}`
  }
  throw new Error(tr('errors.ttsLinkNotAbsolute', { path: p }))
}

/**
 * The address to write for the exported file `name` in `dir`, in `mode`:
 * 'local' (default) and 'cloud' the full file link; 'names' the bare file name.
 */
export function ttsImageLink(mode, dir, name, platform = process.platform) {
  if (mode === 'names') return name
  const abs = (platform === 'win32' ? win32 : posix).resolve(dir, name)
  return fileLink(abs, platform)
}

/** A setting value as a mode: anything unknown is the default, local. */
export const normalizeLinkMode = v => (IMAGE_LINK_MODES.includes(v) ? v : 'local')
