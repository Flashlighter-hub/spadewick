/**
 * The starter icons that ship with the application (PRD §16.4): original shapes, free to use, so that `{star}` and
 * `{icon:heart}` work on first open. The project's own icon library (a later step) adds icons by name and may
 * override these.
 *
 * Every icon is a single-colour shape in a 0..100 box, y pointing down, as path commands [type, ...numbers]
 * (M, L, C, Z, all absolute). All sub-shapes of one icon run in the same direction, so overlaps merge under the
 * non-zero fill rule.
 */

const circle = (cx, cy, r) => {
  const k = r * 0.5523
  return [['M', cx + r, cy], ['C', cx + r, cy + k, cx + k, cy + r, cx, cy + r], ['C', cx - k, cy + r, cx - r, cy + k, cx - r, cy], ['C', cx - r, cy - k, cx - k, cy - r, cx, cy - r], ['C', cx + k, cy - r, cx + r, cy - k, cx + r, cy], ['Z']]
}
/** The same circle run the other way round: a hole where it lies inside a shape of the usual direction. */
const hole = (cx, cy, r) => { const k = r * 0.5523; return [['M', cx + r, cy], ['C', cx + r, cy - k, cx + k, cy - r, cx, cy - r], ['C', cx - k, cy - r, cx - r, cy - k, cx - r, cy], ['C', cx - r, cy + k, cx - k, cy + r, cx, cy + r], ['C', cx + k, cy + r, cx + r, cy + k, cx + r, cy], ['Z']] }
const holePolygon = pts => polygon([...pts].reverse())
const polygon = pts => [['M', ...pts[0]], ...pts.slice(1).map(p => ['L', ...p]), ['Z']]
const map = (cmds, f) => cmds.map(([t, ...n]) => { if (t === 'Z') return [t]; const out = []; for (let i = 0; i < n.length; i += 2) out.push(...f(n[i], n[i + 1])); return [t, ...out] })

const star = polygon(Array.from({ length: 10 }, (_, i) => {
  const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 === 0 ? 48 : 20
  return [Math.round((50 + r * Math.cos(a)) * 100) / 100, Math.round((53 + r * Math.sin(a)) * 100) / 100]
}))
const arrowRight = polygon([[4, 38], [58, 38], [58, 16], [96, 50], [58, 84], [58, 62], [4, 62]])

export const STARTER_ICONS = {
  star,
  heart: [['M', 50, 92], ['C', 8, 62, 4, 30, 27, 17], ['C', 40, 10, 50, 19, 50, 30], ['C', 50, 19, 60, 10, 73, 17], ['C', 96, 30, 92, 62, 50, 92], ['Z']],
  shield: [['M', 50, 4], ['L', 91, 19], ['L', 91, 50], ['C', 91, 76, 71, 90, 50, 97], ['C', 29, 90, 9, 76, 9, 50], ['L', 9, 19], ['Z']],
  fire: [['M', 50, 4], ['C', 58, 30, 86, 40, 86, 66], ['C', 86, 85, 69, 97, 50, 97], ['C', 31, 97, 14, 85, 14, 66], ['C', 14, 48, 29, 40, 35, 24], ['C', 40, 36, 46, 32, 50, 4], ['Z']],
  diamond: polygon([[50, 4], [90, 50], [50, 96], [10, 50]]),
  club: [...circle(50, 29, 21), ...circle(27, 62, 21), ...circle(73, 62, 21), ...polygon([[43, 60], [57, 60], [64, 96], [36, 96]])],
  spade: [['M', 50, 4], ['C', 50, 4, 8, 38, 8, 62], ['C', 8, 82, 35, 86, 46, 70], ['C', 45, 86, 41, 92, 32, 96], ['L', 68, 96], ['C', 59, 92, 55, 86, 54, 70], ['C', 65, 86, 92, 82, 92, 62], ['C', 92, 38, 50, 4, 50, 4], ['Z']],
  circle: circle(50, 50, 44),
  'arrow-right': arrowRight,
  'arrow-left': map(arrowRight, (x, y) => [100 - x, y]),
  'arrow-up': map(arrowRight, (x, y) => [y, 100 - x]),
  'arrow-down': map(arrowRight, (x, y) => [100 - y, x]),

  // basic
  bolt: polygon([[62, 2], [18, 56], [46, 56], [34, 98], [84, 40], [54, 40]]),
  drop: [['M', 50, 4], ['C', 50, 4, 86, 46, 86, 64], ['C', 86, 84, 70, 96, 50, 96], ['C', 30, 96, 14, 84, 14, 64], ['C', 14, 46, 50, 4, 50, 4], ['Z']],
  plus: polygon([[38, 8], [62, 8], [62, 38], [92, 38], [92, 62], [62, 62], [62, 92], [38, 92], [38, 62], [8, 62], [8, 38], [38, 38]]),
  check: polygon([[6, 54], [22, 38], [40, 56], [78, 14], [94, 30], [40, 90]]),
  coin: [...circle(50, 50, 45), ...hole(50, 50, 36), ...circle(50, 50, 24), ...hole(50, 50, 15)],
  sword: [...polygon([[45, 3], [55, 3], [58, 62], [42, 62]]), ...polygon([[22, 62], [78, 62], [78, 73], [22, 73]]), ...polygon([[44, 73], [56, 73], [56, 90], [44, 90]]), ...circle(50, 93, 6)],

  // fantasy
  crown: polygon([[6, 86], [6, 28], [30, 52], [50, 12], [70, 52], [94, 28], [94, 86]]),
  skull: [...circle(50, 42, 36), ...polygon([[30, 62], [70, 62], [66, 94], [34, 94]]), ...hole(35, 44, 10), ...hole(65, 44, 10), ...holePolygon([[50, 54], [44, 66], [56, 66]])],
  gem: polygon([[28, 10], [72, 10], [96, 38], [50, 94], [4, 38]]),
  moon: [['M', 62, 4], ['C', 30, 12, 10, 36, 14, 62], ['C', 18, 84, 40, 98, 66, 94], ['C', 40, 88, 30, 64, 38, 40], ['C', 42, 26, 50, 14, 62, 4], ['Z']],
  potion: [['M', 40, 4], ['L', 60, 4], ['L', 60, 34], ['L', 88, 82], ['C', 93, 91, 88, 96, 79, 96], ['L', 21, 96], ['C', 12, 96, 7, 91, 12, 82], ['L', 40, 34], ['Z']],
  tower: [...polygon([[24, 96], [24, 34], [14, 34], [14, 8], [28, 8], [28, 20], [42, 20], [42, 8], [58, 8], [58, 20], [72, 20], [72, 8], [86, 8], [86, 34], [76, 34], [76, 96]]), ...holePolygon([[45, 46], [55, 46], [55, 64], [45, 64]]), ...holePolygon([[44, 96], [44, 78], [56, 78], [56, 96]])],
  wand: [...polygon([[14, 86], [22, 94], [64, 52], [56, 44]]), ...polygon([[74, 4], [80, 22], [98, 28], [80, 34], [74, 52], [68, 34], [50, 28], [68, 22]])]
}

export const starterIconNames = () => Object.keys(STARTER_ICONS)

/** Path commands of a starter icon in the 0..100 box, or null when there is none of that name. */
export const starterIcon = name => STARTER_ICONS[name] ?? null

/** The same shape as SVG path data, for showing an icon in the interface. */
export function iconPathData(commands) {
  return commands.map(([t, ...n]) => (t === 'Z' ? 'Z' : `${t}${n.join(' ')}`)).join('')
}

/** What is drawn for an icon that does not exist: a hollow square, so the gap is visible and never silently dropped (PRD §16.9). */
export const PLACEHOLDER_ICON = [
  ['M', 4, 4], ['L', 96, 4], ['L', 96, 96], ['L', 4, 96], ['Z'],
  ['M', 14, 14], ['L', 14, 86], ['L', 86, 86], ['L', 86, 14], ['Z']
]
