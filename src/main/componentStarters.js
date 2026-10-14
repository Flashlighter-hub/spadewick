/**
 * The components that ship with the application (PRD §7.10): original shapes, free to use, in the component library from the first
 * start: round and square digit slots, name banners and text field blocks, three of each, and thirty icons (fantasy, science fiction, markers). They are read-only; using one copies its
 * parts into the template, as with any component, and "Save changes to library" on one makes a component of the person's own.
 *
 * Digit slots show `{{cost}}` and `{{power}}`-style fields, banners show `{{name}}`, text blocks `{{rules}}`: a set without such a field
 * is told so when one is put in, and the binding is changed in the panel like any other.
 */
import { iconComponents } from './componentIcons.js'
const NS = 'xmlns="http://www.w3.org/2000/svg"'
const ID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
export const isStarterComponentId = id => /^00000000-0000-4000-8000-0000000000\d\d$/.test(String(id))

/** A single line of words in a box, centred: it shrinks to fit. */
const line = (id, field, x, y, w, h, size, fill, extra = '') =>
  `<text ${NS} data-spadewick-id="${id}" data-spadewick-field="${field}" data-spadewick-text-fit="shrink" data-spadewick-text-max-size="${size}" data-spadewick-text-min-size="10" data-spadewick-valign="middle" x="${x}" y="${y}" width="${w}" height="${h}" font-size="${size}" font-weight="bold" text-anchor="middle" fill="${fill}"${extra}>{{${field}}}</text>`
const gradient = (id, a, b, radial = false) => radial
  ? `<radialGradient ${NS} id="${id}" cx="40%" cy="35%" r="75%"><stop offset="0%" stop-color="${a}"/><stop offset="100%" stop-color="${b}"/></radialGradient>`
  : `<linearGradient ${NS} id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${a}"/><stop offset="100%" stop-color="${b}"/></linearGradient>`

const component = (n, name, description, bounds, xml, defs = []) => ({ id: ID(n), name, description, version: 1, refWidth: 500, bounds, xml, defs, starter: true })

const SQUARE = { x: 0, y: 0, w: 64, h: 64 }
const BANNER = { x: 0, y: 0, w: 360, h: 56 }
const BLOCK = { x: 0, y: 0, w: 380, h: 160 }

export function starterComponents() {
  return [
    // ---- round digit slots ----
    component(1, 'Round gem digit', 'A round jewel with a gold rim and one number (cost).', SQUARE, [
      `<circle ${NS} data-spadewick-id="gem" cx="32" cy="32" r="29" fill="url(#gem_fill)" stroke="#e8c15a" stroke-width="4"/>`,
      `<ellipse ${NS} data-spadewick-id="shine" cx="24" cy="18" rx="14" ry="7" fill="#ffffff" fill-opacity="0.28"/>`,
      line('value', 'cost', 8, 12, 48, 40, 34, '#ffffff')
    ], [gradient('gem_fill', '#6c5ce7', '#2b1f8a', true)]),
    component(2, 'Round ring digit', 'A white disc with a dark ring and one number (cost).', SQUARE, [
      `<circle ${NS} data-spadewick-id="disc" cx="32" cy="32" r="29" fill="#ffffff" stroke="#212529" stroke-width="5"/>`,
      `<circle ${NS} data-spadewick-id="inner" cx="32" cy="32" r="23" fill="none" stroke="#212529" stroke-width="1.5" stroke-opacity="0.5"/>`,
      line('value', 'cost', 8, 12, 48, 40, 32, '#212529')
    ]),
    component(3, 'Round glow digit', 'A dark disc with a bright edge and a number (power).', SQUARE, [
      `<circle ${NS} data-spadewick-id="halo" cx="32" cy="32" r="31" fill="#ff6b6b" fill-opacity="0.35"/>`,
      `<circle ${NS} data-spadewick-id="disc" cx="32" cy="32" r="26" fill="#1e2130" stroke="#ff6b6b" stroke-width="3"/>`,
      line('value', 'power', 8, 12, 48, 40, 30, '#ffffff')
    ]),
    // ---- square digit slots ----
    component(4, 'Square plate digit', 'A dark rounded plate with a gold border and a number (power).', SQUARE, [
      `<rect ${NS} data-spadewick-id="plate" x="2" y="2" width="60" height="60" rx="10" fill="#1e2130" stroke="#e8c15a" stroke-width="3"/>`,
      line('value', 'power', 8, 12, 48, 40, 32, '#ffffff')
    ]),
    component(5, 'Square cut-corner digit', 'An octagon plate with an accent colour and a number (toughness).', SQUARE, [
      `<path ${NS} data-spadewick-id="plate" d="M16 2H48L62 16V48L48 62H16L2 48V16Z" fill="#a61e4d" stroke="#ffffff" stroke-width="3" stroke-linejoin="round"/>`,
      line('value', 'toughness', 8, 12, 48, 40, 32, '#ffffff')
    ]),
    component(6, 'Square outline digit', 'A white square with a thick outline, a shadow, and a number (cost).', SQUARE, [
      `<rect ${NS} data-spadewick-id="shadow" x="6" y="6" width="56" height="56" rx="6" fill="#000000" fill-opacity="0.25"/>`,
      `<rect ${NS} data-spadewick-id="plate" x="2" y="2" width="56" height="56" rx="6" fill="#ffffff" stroke="#212529" stroke-width="4"/>`,
      line('value', 'cost', 6, 10, 48, 40, 32, '#212529')
    ]),
    // ---- name banners ----
    component(7, 'Ribbon name banner', 'A ribbon with folded ends for the name.', BANNER, [
      `<path ${NS} data-spadewick-id="tail_left" d="M0 14H28V56H0L14 35Z" fill="#7b2d26"/>`,
      `<path ${NS} data-spadewick-id="tail_right" d="M360 14H332V56H360L346 35Z" fill="#7b2d26"/>`,
      `<rect ${NS} data-spadewick-id="ribbon" x="20" y="0" width="320" height="46" fill="#a61e4d" stroke="#f6e8c6" stroke-width="2"/>`,
      line('title', 'name', 36, 4, 288, 38, 28, '#ffffff')
    ]),
    component(8, 'Plate name banner', 'A dark rounded bar with a gold underline for the name.', BANNER, [
      `<rect ${NS} data-spadewick-id="plate" x="0" y="0" width="360" height="52" rx="10" fill="url(#plate_fill)"/>`,
      `<rect ${NS} data-spadewick-id="underline" x="14" y="46" width="332" height="3" rx="1.5" fill="#e8c15a"/>`,
      line('title', 'name', 16, 4, 328, 38, 28, '#ffffff')
    ], [gradient('plate_fill', '#2a2e44', '#14161f')]),
    component(9, 'Scroll name banner', 'A parchment scroll with curled ends for the name.', BANNER, [
      `<rect ${NS} data-spadewick-id="paper" x="14" y="4" width="332" height="44" fill="#f6e8c6" stroke="#8a6a2a" stroke-width="2"/>`,
      `<circle ${NS} data-spadewick-id="curl_left" cx="14" cy="26" r="14" fill="#e0c68f" stroke="#8a6a2a" stroke-width="2"/>`,
      `<circle ${NS} data-spadewick-id="curl_right" cx="346" cy="26" r="14" fill="#e0c68f" stroke="#8a6a2a" stroke-width="2"/>`,
      line('title', 'name', 36, 6, 288, 40, 28, '#3b2412')
    ]),
    // ---- text field blocks ----
    component(10, 'Parchment text block', 'A parchment box for rules text that shrinks to fit.', BLOCK, [
      `<rect ${NS} data-spadewick-id="paper" x="1" y="1" width="378" height="158" rx="10" fill="#f6e8c6" stroke="#8a6a2a" stroke-width="2"/>`,
      `<text ${NS} data-spadewick-id="text" data-spadewick-field="rules" data-spadewick-text-fit="shrink" data-spadewick-text-max-size="22" data-spadewick-text-min-size="11" x="16" y="12" width="348" height="136" font-size="22" fill="#2b1a0b">{{rules}}</text>`
    ]),
    component(11, 'Dark text panel', 'A translucent dark panel with light text for the rules.', BLOCK, [
      `<rect ${NS} data-spadewick-id="panel" x="0" y="0" width="380" height="160" rx="12" fill="#0b0620" fill-opacity="0.78"/>`,
      `<text ${NS} data-spadewick-id="text" data-spadewick-field="rules" data-spadewick-text-fit="shrink" data-spadewick-text-max-size="22" data-spadewick-text-min-size="11" x="16" y="12" width="348" height="136" font-size="22" fill="#e9ecef">{{rules}}</text>`
    ]),
    component(12, 'Framed text block', 'A white box with a double frame and a rules text.', BLOCK, [
      `<rect ${NS} data-spadewick-id="frame_outer" x="1" y="1" width="378" height="158" rx="4" fill="#ffffff" stroke="#212529" stroke-width="3"/>`,
      `<rect ${NS} data-spadewick-id="frame_inner" x="8" y="8" width="364" height="144" rx="2" fill="none" stroke="#212529" stroke-width="1"/>`,
      `<text ${NS} data-spadewick-id="text" data-spadewick-field="rules" data-spadewick-text-fit="shrink" data-spadewick-text-max-size="22" data-spadewick-text-min-size="11" x="18" y="16" width="344" height="128" font-size="22" fill="#212529">{{rules}}</text>`
    ]),
    // ---- thirty icons: fantasy, science fiction and markers (componentIcons.js) ----
    ...iconComponents()
  ]
}
