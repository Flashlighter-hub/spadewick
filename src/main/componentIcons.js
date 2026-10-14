/**
 * Built-in icon components: thirty original icons, ten fantasy, ten science fiction and ten markers, in the component library from the first
 * start (PRD §7.10). Each is drawn on a 64 × 64 square from a few named parts (a blade, a hilt, a glow), so the panel of a placed icon can
 * recolour each part, and each part is a layer of its own that can be moved and resized. They show no card data: they are artwork to put
 * on a card or beside a rule, large or as small as a line of text. Free to use; none is taken from anywhere.
 *
 * Every icon has the same look so a card can mix them: a dark outline, a two-tone fill and one small highlight.
 */
const NS = 'xmlns="http://www.w3.org/2000/svg"'
const INK = '#1c1e2b'
const ID = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const BOX = { x: 0, y: 0, w: 64, h: 64 }
const r = n => Math.round(n * 100) / 100

// ---- drawing helpers ------------------------------------------------------------------------------------------------------------------

/** A path part. `o.stroke` false for no outline, or a colour; `o.sw` the outline width; `o.extra` more attributes. */
const path = (id, d, fill, o = {}) =>
  `<path ${NS} data-spadewick-id="${id}" d="${d}" fill="${fill}"` +
  (o.stroke === false ? '' : ` stroke="${o.stroke ?? INK}" stroke-width="${o.sw ?? 2.5}" stroke-linejoin="round" stroke-linecap="round"`) + (o.extra ?? '') + '/>'
const circle = (id, cx, cy, rad, fill, o = {}) =>
  `<circle ${NS} data-spadewick-id="${id}" cx="${cx}" cy="${cy}" r="${rad}" fill="${fill}"` + (o.stroke === false ? '' : ` stroke="${o.stroke ?? INK}" stroke-width="${o.sw ?? 2.5}"`) + (o.extra ?? '') + '/>'
const rect = (id, x, y, w, h, rx, fill, o = {}) =>
  `<rect ${NS} data-spadewick-id="${id}" x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}"` + (o.stroke === false ? '' : ` stroke="${o.stroke ?? INK}" stroke-width="${o.sw ?? 2.5}" stroke-linejoin="round"`) + (o.extra ?? '') + '/>'
const ellipse = (id, cx, cy, rx, ry, fill, o = {}) =>
  `<ellipse ${NS} data-spadewick-id="${id}" cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}"` + (o.stroke === false ? '' : ` stroke="${o.stroke ?? INK}" stroke-width="${o.sw ?? 2.5}"`) + (o.extra ?? '') + '/>'
/** A line drawn as a stroke only (a shine, a crack, a rung). */
const stroke = (id, d, colour, w, o = {}) =>
  `<path ${NS} data-spadewick-id="${id}" d="${d}" fill="none" stroke="${colour}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"` + (o.opacity ? ` stroke-opacity="${o.opacity}"` : '') + (o.extra ?? '') + '/>'
const shine = (id, d) => stroke(id, d, '#ffffff', 2.6, { opacity: 0.7 })

const linear = (id, a, b, x1 = 0, y1 = 0, x2 = 0, y2 = 1) =>
  `<linearGradient ${NS} id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"><stop offset="0%" stop-color="${a}"/><stop offset="100%" stop-color="${b}"/></linearGradient>`
const radial = (id, a, b) =>
  `<radialGradient ${NS} id="${id}" cx="38%" cy="32%" r="78%"><stop offset="0%" stop-color="${a}"/><stop offset="100%" stop-color="${b}"/></radialGradient>`

/** A star of `n` points: outer radius R, inner radius rad, one point up. */
const star = (cx, cy, R, rad, n = 5) => {
  const pts = []
  for (let i = 0; i < n * 2; i++) {
    const a = (Math.PI * i) / n - Math.PI / 2, k = i % 2 ? rad : R
    pts.push(`${r(cx + k * Math.cos(a))} ${r(cy + k * Math.sin(a))}`)
  }
  return `M${pts.join('L')}Z`
}
/** A cog: `n` teeth between an inner and an outer radius. */
const cog = (cx, cy, outer, inner, n) => {
  const pts = [], step = (Math.PI * 2) / n
  for (let i = 0; i < n; i++) {
    const a = i * step - Math.PI / 2, w = step * 0.2, t = step * 0.34
    for (const [k, da] of [[inner, -t], [outer, -w], [outer, w], [inner, t]]) pts.push(`${r(cx + k * Math.cos(a + da))} ${r(cy + k * Math.sin(a + da))}`)
  }
  return `M${pts.join('L')}Z`
}

const make = (n, name, description, xml, defs = []) => ({ id: ID(n), name, description, version: 1, refWidth: 500, bounds: BOX, xml, defs, starter: true })

// ---- the icons --------------------------------------------------------------------------------------------------------------------------

export function iconComponents() {
  return [
    // ============================================ fantasy ============================================
    make(13, 'Sword icon', 'Fantasy: a straight sword with a golden guard and pommel.', [
      path('blade', 'M32 2L39 10V38H25V10Z', 'url(#sword_steel)'),
      stroke('fuller', 'M32 11V35', '#ffffff', 2.4, { opacity: 0.65 }),
      rect('guard', 14, 38, 36, 7, 3.5, 'url(#sword_gold)'),
      rect('grip', 28.5, 45, 7, 11, 2, '#6b3f23'),
      circle('pommel', 32, 59, 4.5, 'url(#sword_gold)')
    ], [linear('sword_steel', '#f3f6fb', '#8a96ab', 0, 0, 1, 0), linear('sword_gold', '#ffe08a', '#c58a1c')]),

    make(14, 'Shield icon', 'Fantasy: a heater shield with a golden rim and a cross.', [
      path('body', 'M32 3C41 8 50 9 57 8V30C57 46 47 56 32 62C17 56 7 46 7 30V8C14 9 23 8 32 3Z', 'url(#shield_blue)'),
      path('rim', 'M32 8.5C40 12.5 47 13.5 52 13V30C52 43 44 51.5 32 56.5C20 51.5 12 43 12 30V13C17 13.5 24 12.5 32 8.5Z', 'none', { stroke: '#f2c14e', sw: 2.2 }),
      stroke('cross', 'M32 15V50M19.5 29H44.5', '#f2c14e', 4.5),
      circle('boss', 32, 29, 5.5, 'url(#shield_gold)'),
      shine('shine', 'M13 14V26')
    ], [linear('shield_blue', '#4c7bd9', '#1d2f6b'), linear('shield_gold', '#ffe08a', '#c58a1c')]),

    make(15, 'Potion icon', 'Fantasy: a round flask with a cork and a glowing purple potion.', [
      path('glass', 'M25 8H39V20C51 26 55 38 50 49C46 57 39 61 32 61C25 61 18 57 14 49C9 38 13 26 25 20Z', '#dff3ff', { extra: ' fill-opacity="0.45"' }),
      path('liquid', 'M15.5 40C21 37 26.5 43 32 40C37.5 37 43 43 48.5 40C50 47 46 56 40 58.5C36 60 28 60 24 58.5C18 56 14 47 15.5 40Z', 'url(#potion_fill)', { stroke: false }),
      rect('cork', 25, 2, 14, 8, 2.5, '#a8743f'),
      circle('bubble_a', 27, 50, 2.6, '#ffffff', { stroke: false, extra: ' fill-opacity="0.7"' }),
      circle('bubble_b', 38, 53, 1.9, '#ffffff', { stroke: false, extra: ' fill-opacity="0.7"' }),
      shine('shine', 'M19 35C20 30 23 27 27 25')
    ], [linear('potion_fill', '#c45cff', '#5b1f9e')]),

    make(16, 'Crown icon', 'Fantasy: a golden crown with three jewels.', [
      path('crown', 'M8 47L5 17L20 30L32 11L44 30L59 17L56 47Z', 'url(#crown_gold)'),
      rect('band', 8, 47, 48, 9, 2.5, 'url(#crown_gold_dark)'),
      circle('tip_left', 5, 15, 3.2, '#ffe08a'), circle('tip_mid', 32, 9, 3.2, '#ffe08a'), circle('tip_right', 59, 15, 3.2, '#ffe08a'),
      path('jewel', 'M32 31L37 38L32 45L27 38Z', 'url(#crown_ruby)'),
      circle('stone_left', 17, 51.5, 2.4, '#4fc3f7', { sw: 1.5 }), circle('stone_right', 47, 51.5, 2.4, '#4fc3f7', { sw: 1.5 })
    ], [linear('crown_gold', '#ffe08a', '#d79a1f'), linear('crown_gold_dark', '#e3a928', '#9a6a0c'), radial('crown_ruby', '#ff8a8a', '#a31212')]),

    make(17, 'Skull icon', 'Fantasy: a bone-white skull with dark eye sockets.', [
      path('skull', 'M32 4C18 4 9 13 9 26C9 34 13 40 19 43V53H45V43C51 40 55 34 55 26C55 13 46 4 32 4Z', 'url(#skull_bone)'),
      ellipse('eye_left', 22.5, 29, 6.5, 7.5, INK, { stroke: false }),
      ellipse('eye_right', 41.5, 29, 6.5, 7.5, INK, { stroke: false }),
      path('nose', 'M32 36L27.5 45H36.5Z', INK, { stroke: false }),
      stroke('teeth', 'M26 53V47M32 53V47M38 53V47', INK, 2.3),
      shine('shine', 'M14 18C15 13 19 10 24 9')
    ], [linear('skull_bone', '#fffaf0', '#d9ceb4')]),

    make(18, 'Spellbook icon', 'Fantasy: a leather spellbook with a gold star and a clasp.', [
      rect('cover', 9, 6, 46, 53, 5, 'url(#book_leather)'),
      rect('spine', 9, 6, 8, 53, 4, '#4a1d6e'),
      path('pages', 'M17 9H52V56H17', 'none', { stroke: '#f6e8c6', sw: 2, extra: ' stroke-opacity="0.9"' }),
      path('emblem', 'M35 17L38.4 27.6L49 31L38.4 34.4L35 45L31.6 34.4L21 31L31.6 27.6Z', 'url(#book_gold)'),
      rect('clasp', 50, 27, 9, 12, 3, 'url(#book_gold)'),
      circle('gem', 35, 31, 2.2, '#7be0ff', { stroke: false })
    ], [linear('book_leather', '#8a3fc2', '#3d1466', 0, 0, 1, 1), linear('book_gold', '#ffe08a', '#c58a1c')]),

    make(19, 'Key icon', 'Fantasy: an ornate golden key.', [
      path('bow', 'M14 20A13 13 0 1 1 13.99 20ZM14 26.5A6.5 6.5 0 1 0 14.01 26.5Z', 'url(#key_gold)', { extra: ' fill-rule="evenodd"', sw: 2.4, stroke: INK }),
      rect('shaft', 25, 28.5, 34, 7, 3, 'url(#key_gold)'),
      rect('tooth_a', 44, 35.5, 6, 11, 1.8, 'url(#key_gold)'),
      rect('tooth_b', 53, 35.5, 5, 8, 1.8, 'url(#key_gold)'),
      circle('collar', 30, 32, 3.4, '#ffe9a8', { sw: 2 })
    ], [linear('key_gold', '#ffe08a', '#c58a1c')]),

    make(20, 'Magic wand icon', 'Fantasy: a wooden wand topped with a bright star and sparkles.', [
      path('shaft', 'M7 56L38 25L44 31L13 62Z', 'url(#wand_wood)'),
      path('tip', 'M36 27L41.5 21.5L47 27L41.5 32.5Z', 'url(#wand_gold)', { sw: 2 }),
      path('star', 'M48 5L51.4 14.6L61 18L51.4 21.4L48 31L44.6 21.4L35 18L44.6 14.6Z', 'url(#wand_gold)'),
      path('sparkle_a', 'M17 13L18.6 18L23.5 19.5L18.6 21L17 26L15.4 21L10.5 19.5L15.4 18Z', '#7be0ff', { sw: 1.5 }),
      circle('dot_a', 56, 38, 2.4, '#ffe08a', { sw: 1.5 }), circle('dot_b', 26, 8, 2, '#ffe08a', { sw: 1.5 })
    ], [linear('wand_wood', '#9c6a3a', '#5a371a', 0, 0, 1, 1), radial('wand_gold', '#fffbe0', '#e8a91a')]),

    make(21, 'Rune stone icon', 'Fantasy: a grey stone carved with a glowing blue rune.', [
      path('stone', 'M32 3C46 3 55 13 55 28C55 44 49 58 32 61C15 58 9 44 9 28C9 13 18 3 32 3Z', 'url(#rune_rock)'),
      stroke('glow', 'M26 17V46M26 24L39 15M26 35L39 26', '#4fc3f7', 9, { opacity: 0.3 }),
      stroke('rune', 'M26 17V46M26 24L39 15M26 35L39 26', '#b9f0ff', 3.6),
      stroke('crack', 'M44 9L40 17L45 22', INK, 1.8, { opacity: 0.7 }),
      shine('shine', 'M15 21C16 14 21 9 27 7')
    ], [linear('rune_rock', '#9aa3b2', '#4b5262', 0, 0, 1, 1)]),

    make(22, 'Flame icon', 'Fantasy: a three-layer flame from red to yellow.', [
      path('outer', 'M32 2C34 14 49 20 49 38C49 52 42 62 32 62C22 62 15 52 15 38C15 30 19 25 22 22C23 28 26 30 29 30C26 20 27 9 32 2Z', 'url(#flame_outer)'),
      path('inner', 'M32 26C34 33 41 37 41 46C41 54 37 59 32 59C27 59 23 54 23 46C23 39 29 35 32 26Z', 'url(#flame_inner)', { stroke: false }),
      ellipse('core', 32, 52, 4.5, 6, '#fffbe0', { stroke: false, extra: ' fill-opacity="0.85"' })
    ], [linear('flame_outer', '#ff9a3c', '#d11f1f'), linear('flame_inner', '#fff08a', '#ff9a3c')]),

    // ============================================ science fiction ============================================
    make(23, 'Rocket icon', 'Science fiction: a rocket with red fins and a flame.', [
      path('flame', 'M26 48H38L35 58L32 63L29 58Z', 'url(#rocket_flame)'),
      path('fin_left', 'M19 34L7 50V57L19 50Z', '#e2483d'),
      path('fin_right', 'M45 34L57 50V57L45 50Z', '#e2483d'),
      path('body', 'M32 2C43 10 47 22 47 36V49H17V36C17 22 21 10 32 2Z', 'url(#rocket_body)'),
      path('nose', 'M32 2C37 6 41 11 43 16H21C23 11 27 6 32 2Z', '#e2483d'),
      circle('window', 32, 28, 6.5, '#7be0ff', { sw: 2.5 }),
      shine('shine', 'M22 26V38')
    ], [linear('rocket_body', '#ffffff', '#aeb8c9', 0, 0, 1, 0), linear('rocket_flame', '#fff08a', '#ff7a1a')]),

    make(24, 'Planet icon', 'Science fiction: a ringed planet with a small moon.', [
      path('ring_back', 'M4 32A28 8 0 0 1 60 32', 'none', { stroke: '#f2c14e', sw: 3.5, extra: ' transform="rotate(-18 32 32)"' }),
      circle('planet', 32, 32, 18, 'url(#planet_fill)'),
      stroke('band_a', 'M16 27C24 31 40 31 48 27', '#ffffff', 2.6, { opacity: 0.35 }),
      stroke('band_b', 'M15 36C24 40 40 40 49 36', '#ffffff', 2.2, { opacity: 0.25 }),
      path('ring_front', 'M4 32A28 8 0 0 0 60 32', 'none', { stroke: '#f2c14e', sw: 3.5, extra: ' transform="rotate(-18 32 32)"' }),
      circle('moon', 53, 9, 4.5, '#cfd6e4', { sw: 2 })
    ], [radial('planet_fill', '#9a7bff', '#2a1a7a')]),

    make(25, 'Atom icon', 'Science fiction: a nucleus with three electron orbits.', [
      ellipse('orbit_a', 32, 32, 27, 10, 'none', { stroke: '#4fc3f7', sw: 2.6 }),
      ellipse('orbit_b', 32, 32, 27, 10, 'none', { stroke: '#4fc3f7', sw: 2.6, extra: ' transform="rotate(60 32 32)"' }),
      ellipse('orbit_c', 32, 32, 27, 10, 'none', { stroke: '#4fc3f7', sw: 2.6, extra: ' transform="rotate(120 32 32)"' }),
      circle('nucleus', 32, 32, 6.5, 'url(#atom_core)'),
      circle('electron_a', 59, 32, 3.4, '#ffe08a', { sw: 1.8 }),
      circle('electron_b', 45.5, 55.4, 3.4, '#ffe08a', { sw: 1.8 }),
      circle('electron_c', 18.5, 55.4, 3.4, '#ffe08a', { sw: 1.8 })
    ], [radial('atom_core', '#fffbe0', '#e8531a')]),

    make(26, 'Robot head icon', 'Science fiction: a friendly robot head with glowing eyes and an antenna.', [
      stroke('antenna', 'M32 12V5', INK, 3),
      circle('bulb', 32, 5, 3.4, '#ff5a5a', { sw: 2 }),
      rect('ear_left', 3, 24, 7, 14, 2.5, '#8d99ae'), rect('ear_right', 54, 24, 7, 14, 2.5, '#8d99ae'),
      rect('head', 9, 12, 46, 38, 9, 'url(#robot_metal)'),
      circle('eye_left', 22.5, 29, 6, '#4fc3f7', { sw: 2.2 }), circle('eye_right', 41.5, 29, 6, '#4fc3f7', { sw: 2.2 }),
      circle('pupil_left', 24, 28, 2.2, '#ffffff', { stroke: false }), circle('pupil_right', 43, 28, 2.2, '#ffffff', { stroke: false }),
      rect('mouth', 20, 40, 24, 6, 2.5, INK, { stroke: false }),
      stroke('teeth', 'M26 40V46M32 40V46M38 40V46', '#8d99ae', 1.6),
      rect('neck', 25, 50, 14, 7, 1.5, '#8d99ae'), rect('shoulders', 12, 57, 40, 6, 3, 'url(#robot_metal)')
    ], [linear('robot_metal', '#dfe5f0', '#8493ab')]),

    make(27, 'Energy cell icon', 'Science fiction: a battery cell showing charge, green at the bottom.', [
      rect('cap', 25, 3, 14, 7, 2.5, '#8d99ae'),
      rect('cell', 15, 9, 34, 53, 7, '#232638'),
      rect('level_4', 21, 14, 22, 8, 2.5, '#2b3a2f', { stroke: false }), rect('level_3', 21, 25, 22, 8, 2.5, '#2b3a2f', { stroke: false }),
      rect('level_2', 21, 36, 22, 8, 2.5, 'url(#cell_green)', { stroke: false }), rect('level_1', 21, 47, 22, 8, 2.5, 'url(#cell_green)', { stroke: false }),
      path('bolt', 'M35 14L27 29H32L29 40L37 25H32Z', '#e9fff0', { stroke: false, extra: ' fill-opacity="0.9"' }),
      shine('shine', 'M17.5 15V50')
    ], [linear('cell_green', '#9affb0', '#1fb457')]),

    make(28, 'Blaster icon', 'Science fiction: a ray gun with a glowing barrel.', [
      path('grip', 'M16 30H29L25 54H13Z', '#4b3b52'),
      path('guard', 'M29 30V39H38V30', 'none', { sw: 2.4 }),
      rect('body', 5, 15, 46, 16, 5, 'url(#blaster_metal)'),
      rect('emitter', 49, 18, 10, 10, 3, 'url(#blaster_glow)'),
      rect('sight', 9, 10, 8, 5, 1.5, '#8d99ae'),
      rect('charge', 14, 20, 24, 5, 2.5, '#4fc3f7', { stroke: false }),
      circle('indicator', 43, 23, 2.4, '#ff5a5a', { stroke: false })
    ], [linear('blaster_metal', '#dfe5f0', '#6e7c96'), radial('blaster_glow', '#e9fbff', '#17a5ee')]),

    make(29, 'Targeting reticle icon', 'Science fiction: a red crosshair in two rings.', [
      circle('field', 32, 32, 23, '#ff4d4d', { stroke: false, extra: ' fill-opacity="0.14"' }),
      circle('ring_outer', 32, 32, 23, 'none', { stroke: '#ff4d4d', sw: 3 }),
      circle('ring_inner', 32, 32, 10, 'none', { stroke: '#ff4d4d', sw: 2.4 }),
      stroke('ticks', 'M32 3V17M32 47V61M3 32H17M47 32H61', '#ff4d4d', 3.4),
      circle('dot', 32, 32, 3, '#ffffff', { stroke: '#ff4d4d', sw: 2 })
    ]),

    make(30, 'Cog icon', 'Science fiction: a metal gear wheel.', [
      path('gear', `${cog(32, 32, 29, 22, 10)}M32 22A10 10 0 1 0 32.01 22Z`, 'url(#cog_metal)', { extra: ' fill-rule="evenodd"' }),
      circle('ring', 32, 32, 16, 'none', { stroke: '#ffffff', sw: 2, extra: ' stroke-opacity="0.45"' }),
      circle('hub', 32, 32, 4, '#232638', { stroke: false })
    ], [linear('cog_metal', '#d7deeb', '#6e7c96', 0, 0, 1, 1)]),

    make(31, 'Circuit chip icon', 'Science fiction: a microchip with gold pins and a glowing core.', [
      path('pins', (() => {
        const out = []
        for (const i of [0, 1, 2, 3]) {
          const p = 17 + i * 9
          out.push(`M5 ${p}H14V${p + 3.4}H5Z`, `M50 ${p}H59V${p + 3.4}H50Z`, `M${p} 5H${p + 3.4}V14H${p}Z`, `M${p} 50H${p + 3.4}V59H${p}Z`)
        }
        return out.join('')
      })(), '#f2c14e', { sw: 1.4 }),
      rect('body', 13, 13, 38, 38, 5, 'url(#chip_body)'),
      rect('die', 21, 21, 22, 22, 3, '#101420', { stroke: '#4fc3f7', sw: 1.8 }),
      stroke('traces', 'M21 28H17M21 36H17M43 28H47M43 36H47M28 21V17M36 21V17', '#4fc3f7', 1.6),
      circle('core', 32, 32, 5, '#7be0ff', { stroke: false }),
      circle('mark', 18, 18, 1.8, '#ffffff', { stroke: false })
    ], [linear('chip_body', '#2f5a45', '#173225')]),

    make(32, 'DNA helix icon', 'Science fiction: a double helix with golden rungs.', [
      stroke('rung_a', 'M24.5 18.75H39.5', '#ffe08a', 2.4), stroke('rung_b', 'M25.4 25.6H38.6', '#ffe08a', 2.4),
      stroke('rung_c', 'M25.4 38.4H38.6', '#ffe08a', 2.4), stroke('rung_d', 'M24.5 45.25H39.5', '#ffe08a', 2.4),
      stroke('strand_a', 'M20 4C44 14 44 24 32 32C20 40 20 50 44 60', '#4fc3f7', 4.6),
      stroke('strand_b', 'M44 4C20 14 20 24 32 32C44 40 44 50 20 60', '#ff6bd6', 4.6),
      circle('node_a', 20, 5, 3.2, '#4fc3f7', { sw: 1.6 }), circle('node_b', 44, 5, 3.2, '#ff6bd6', { sw: 1.6 }),
      circle('node_c', 44, 59, 3.2, '#4fc3f7', { sw: 1.6 }), circle('node_d', 20, 59, 3.2, '#ff6bd6', { sw: 1.6 })
    ]),

    // ============================================ markers ============================================
    make(33, 'Heart icon', 'Marker: a red heart, for life or health.', [
      path('heart', 'M32 60C10 44 3 32 3 22C3 12 10 5 19 5C25 5 30 8 32 13C34 8 39 5 45 5C54 5 61 12 61 22C61 32 54 44 32 60Z', 'url(#heart_fill)'),
      shine('shine', 'M12 19C12 14 15 11 20 10')
    ], [linear('heart_fill', '#ff6b6b', '#b3122e')]),

    make(34, 'Lightning bolt icon', 'Marker: a yellow lightning bolt, for energy or speed.', [
      path('bolt', 'M40 2L11 36H27L22 62L53 26H37Z', 'url(#bolt_fill)'),
      shine('shine', 'M38 9L21 30')
    ], [linear('bolt_fill', '#fff08a', '#ffa41a')]),

    make(35, 'Hourglass icon', 'Marker: an hourglass with golden sand, for time or turns.', [
      rect('cap_top', 9, 3, 46, 7, 2.5, 'url(#glass_wood)'), rect('cap_bottom', 9, 54, 46, 7, 2.5, 'url(#glass_wood)'),
      path('glass', 'M15 10H49C49 24 39 28 35 32C39 36 49 40 49 54H15C15 40 25 36 29 32C25 28 15 24 15 10Z', '#dff3ff', { extra: ' fill-opacity="0.4"' }),
      path('sand_top', 'M19 12H45C44 19 38 24 32 28C26 24 20 19 19 12Z', 'url(#sand_fill)', { stroke: false }),
      path('sand_bottom', 'M18 52C20 45 26 40 32 40C38 40 44 45 46 52Z', 'url(#sand_fill)', { stroke: false }),
      stroke('stream', 'M32 28V41', '#e8a91a', 1.8)
    ], [linear('glass_wood', '#c18a4d', '#6b3f23'), linear('sand_fill', '#ffe08a', '#e0a31a')]),

    make(36, 'Flag icon', 'Marker: a red flag on a pole, for an objective.', [
      ellipse('base', 12, 60, 8, 3, '#000000', { stroke: false, extra: ' fill-opacity="0.25"' }),
      rect('pole', 9, 3, 4.5, 57, 2, '#9aa3b2'),
      path('flag', 'M13.5 8C24 4 30 12 40 8C46 6 51 7 56 9V33C51 31 46 30 40 32C30 36 24 28 13.5 32Z', 'url(#flag_fill)'),
      path('emblem', star(34, 20, 6.5, 2.8, 5), '#fff2c2', { stroke: false }),
      circle('finial', 11.25, 3, 3, '#ffe08a', { sw: 1.8 })
    ], [linear('flag_fill', '#ef5350', '#a01216')]),

    make(37, 'Coin icon', 'Marker: a gold coin with a star, for money or rewards.', [
      circle('coin', 32, 32, 28, 'url(#coin_gold)'),
      circle('ring', 32, 32, 21, 'none', { stroke: '#a8700f', sw: 2.4 }),
      path('star', star(32, 33, 13, 5.5, 5), 'url(#coin_star)', { stroke: '#a8700f', sw: 1.6 }),
      shine('shine', 'M13 22C16 15 22 10 29 8')
    ], [radial('coin_gold', '#fff1a8', '#d79a1f'), linear('coin_star', '#ffd24a', '#c98a14')]),

    make(38, 'Eye icon', 'Marker: an open eye with a golden iris, for vision or reveal.', [
      path('lid', 'M2 32C12 16 22 11 32 11C42 11 52 16 62 32C52 48 42 53 32 53C22 53 12 48 2 32Z', '#fdfdfd'),
      circle('iris', 32, 32, 13, 'url(#eye_iris)'),
      circle('pupil', 32, 32, 6, INK, { stroke: false }),
      circle('glint', 36.5, 27.5, 3.2, '#ffffff', { stroke: false })
    ], [radial('eye_iris', '#ffe08a', '#c47a12')]),

    make(39, 'Padlock icon', 'Marker: a closed padlock, for locked or protected.', [
      path('shackle', 'M19 30V21C19 12 24.5 7 32 7C39.5 7 45 12 45 21V30', 'none', { stroke: '#9aa3b2', sw: 6.5 }),
      path('shackle_edge', 'M19 30V21C19 12 24.5 7 32 7C39.5 7 45 12 45 21V30', 'none', { stroke: INK, sw: 1.4 }),
      rect('body', 11, 28, 42, 32, 7, 'url(#lock_gold)'),
      circle('keyhole', 32, 41, 5, INK, { stroke: false }),
      path('slot', 'M30 44H34L35.5 52H28.5Z', INK, { stroke: false })
    ], [linear('lock_gold', '#ffe08a', '#c58a1c')]),

    make(40, 'Star badge icon', 'Marker: a golden star with a lighter star inside, for rank or favourite.', [
      path('star', star(32, 33, 30, 13, 5), 'url(#star_gold)'),
      path('inner', star(32, 34, 16, 7, 5), '#fff4b8', { stroke: false, extra: ' fill-opacity="0.85"' })
    ], [linear('star_gold', '#ffe08a', '#d79a1f')]),

    make(41, 'Warning icon', 'Marker: a yellow warning triangle with an exclamation mark.', [
      path('triangle', 'M32 4L61 54C62.5 57 60.5 60 57.5 60H6.5C3.5 60 1.5 57 3 54Z', 'url(#warn_fill)'),
      rect('bar', 29.5, 22, 5, 19, 2.5, INK, { stroke: false }),
      circle('dot', 32, 49, 3.2, INK, { stroke: false })
    ], [linear('warn_fill', '#ffe45c', '#f0a30a')]),

    make(42, 'Location pin icon', 'Marker: a teal map pin, for a place or a target.', [
      ellipse('shadow', 32, 61, 11, 2.6, '#000000', { stroke: false, extra: ' fill-opacity="0.25"' }),
      path('pin', 'M32 60C32 60 11 41 11 26C11 14 20 4 32 4C44 4 53 14 53 26C53 41 32 60 32 60Z', 'url(#pin_fill)'),
      circle('hole', 32, 26, 9.5, '#ffffff'),
      shine('shine', 'M17 20C18 14 22 9 28 7')
    ], [linear('pin_fill', '#2ad1c4', '#0b6f8f')])
  ]
}
