/**
 * The guides every starter canvas draws: the trim line and the safe line, labelled in words, in a group that is hidden whenever a card
 * is rendered, so they help while designing and never reach an export (PRD §10.6).
 */
export const GUIDE_WIDTH = 500           // template pixels across, as for every new project
const SAFE_MM = 3                         // the safe line sits this far inside the trim edge

/** Guides for a canvas of `w` × `h` template pixels for a card `mmW` millimetres wide. */
export function guides(w, h, mmW) {
  const safe = Math.round(SAFE_MM / mmW * GUIDE_WIDTH * 10) / 10
  return `  <g id="guides" data-spadewick-hide-if="1" fill="none" stroke-width="1" stroke-dasharray="6 4">
    <rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" stroke="#d6336c"/>
    <rect x="${safe}" y="${safe}" width="${w - 2 * safe}" height="${h - 2 * safe}" stroke="#1c7ed6"/>
    <text x="${safe + 4}" y="${safe + 12}" font-size="10" fill="#1c7ed6" stroke="none">Safe line</text>
    <text x="4" y="${h - 4}" font-size="10" fill="#d6336c" stroke="none">Trim edge</text>
  </g>`
}
