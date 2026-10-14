/**
 * Starter templates (PRD §7.7.1): read-only designs that ship with the application. They are
 * defined here, in code, in the same shape as a template package folder, so they travel with the
 * program, need no separate files and are exercised by the same clone code as every other template.
 *
 * Blank frames exist for every card size (PRD §10.6). Each draws its trim and safe lines in a
 * group that is hidden whenever a card is rendered, so the guides help while designing and never
 * reach an export. (Canvases that include bleed arrive with the production PDF, PRD §17.4.)
 */
import { CARD_SIZES } from '../shared/cardSizes.js'
import { tr } from '../shared/i18n.js'
import { wrapChildFragment } from '../shared/templateChild.js'
import { guides } from '../shared/starterGuides.js'
import { backSvg } from '../shared/backDesigns.js'

const WIDTH = 500                 // template pixels across, as for every new project (PRD §10.6)
const heightFor = ({ w, h }) => Math.round(WIDTH * h / w)

const xml = '<svg xmlns="http://www.w3.org/2000/svg"'

/** The blank frame for one card size. */
export function blankFrame(size) {
  const w = WIDTH, h = heightFor(size)
  const svg = `${xml} width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="#ffffff"/>
${guides(w, h, size.w)}
  <text data-spadewick-id="title" x="${w / 2}" y="${Math.round(h * 0.1)}" text-anchor="middle" font-size="32" font-weight="bold" fill="#222222">{{display_name}}</text>
</svg>`
  return {
    manifest: {
      format: 1, id: `blank-${size.id}`, version: 1, name: tr('starters.blankName', { size: tr(`cardSizes.${size.id}`) }),
      description: tr('starters.blank'),
      author: 'Spadewick', license: 'Free to use', cardSize: { id: size.id, mmW: size.w, mmH: size.h },
      templates: [{ file: 'templates/main.svg', name: `Blank ${size.id.replace(/_/g, ' ')}`, role: 'main' }],
      fonts: [], assets: [], icons: [], palette: [], fields: [], mockup: { cards: null, previews: [] }
    },
    files: { 'templates/main.svg': svg },
    mockupCards: []
  }
}

// ---------------------------------------------------------------------------
// Example designs
// ---------------------------------------------------------------------------

const poker = CARD_SIZES.find(s => s.id === 'poker')
const tarot = CARD_SIZES.find(s => s.id === 'tarot')

const field = (name, slug, type, extra = {}) => ({ name, slug, type, default_value: null, formula: null, validation: null, ...extra })

function creature() {
  const w = WIDTH, h = heightFor(poker)
  const base = `${xml} width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" rx="22" fill="#3b2f2f"/>
  <rect x="18" y="18" width="${w - 36}" height="${h - 36}" rx="12" fill="#fdf6e3"/>
  <rect x="18" y="18" width="${w - 36}" height="62" rx="12" fill="#a61e4d"/>
  <g id="slot_body"><!-- spadewick:slot="body" --></g>
${guides(w, h, poker.w)}
</svg>`
  const child = `<!-- spadewick:parent="Creature frame" -->
<!-- spadewick:fills="body" -->
<text data-spadewick-id="title" x="34" y="60" font-size="32" font-weight="bold" fill="#ffffff">{{name}}</text>
<text data-spadewick-id="cost" x="${w - 34}" y="60" text-anchor="end" font-size="32" font-weight="bold" fill="#ffffff">{{cost}}</text>
<rect x="34" y="96" width="${w - 68}" height="270" rx="6" fill="#d8cfb8"/>
<clipPath id="art_clip"><rect x="34" y="96" width="${w - 68}" height="270" rx="6"/></clipPath>
<image data-spadewick-id="art" x="34" y="96" width="${w - 68}" height="270" href="" preserveAspectRatio="xMidYMid slice" clip-path="url(#art_clip)"/>
<text data-spadewick-id="type" x="34" y="402" font-size="22" font-style="italic" fill="#333333">{{type}}</text>
<text data-spadewick-id="rules" data-spadewick-field="rules" data-spadewick-text-fit="shrink" data-spadewick-text-max-size="22" data-spadewick-text-min-size="12" x="34" y="418" width="${w - 68}" height="130" font-size="22" fill="#222222">{{rules}}</text>
<text data-spadewick-id="stats" x="${w - 34}" y="${h - 50}" text-anchor="end" font-size="30" font-weight="bold" fill="#222222">{{power}} / {{toughness}}</text>
<text data-spadewick-id="number" x="34" y="${h - 50}" font-size="16" fill="#555555">{{@card.id}} · {{@card.number}}/{{@card.count}}</text>`
  return {
    manifest: {
      format: 1, id: 'example-creature', version: 1, name: 'Creature card (with a shared frame)',
      description: tr('starters.creature'),
      author: 'Spadewick', license: 'Free to use', cardSize: { id: 'poker', mmW: poker.w, mmH: poker.h },
      templates: [
        { file: 'templates/main.svg', name: 'Creature', role: 'main' },
        { file: 'templates/parent.svg', name: 'Creature frame', role: 'parent' }
      ],
      fonts: [], assets: [], icons: [],
      palette: [],
      fields: [field('Name', 'name', 'text'), field('Cost', 'cost', 'number', { validation: '{"min":0,"max":20}' }), field('Type', 'type', 'text'),
        field('Rules', 'rules', 'text'), field('Power', 'power', 'number'), field('Toughness', 'toughness', 'number')],
      mockup: { cards: 'mockup/cards.json', previews: [] }
    },
    files: { 'templates/main.svg': wrapChildFragment(child, base), 'templates/parent.svg': base },
    mockupCards: [
      { display_name: 'Ember Wolf', quantity: 2, fields: { name: 'Ember Wolf', cost: '3', type: 'Creature — Beast', rules: 'Haste. When Ember Wolf attacks, it deals 1 damage to each opposing creature.', power: '3', toughness: '2' } },
      { display_name: 'Moss Golem', quantity: 1, fields: { name: 'Moss Golem', cost: '5', type: 'Creature — Golem', rules: 'Heals 2 at the start of your turn.', power: '4', toughness: '6' } },
      { display_name: 'Quick Sprite', quantity: 3, fields: { name: 'Quick Sprite', cost: '1', type: 'Creature — Fey', rules: 'Flying.', power: '1', toughness: '1' } }
    ]
  }
}

function playing() {
  const w = WIDTH, h = heightFor(poker)
  const svg = `${xml} width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" rx="22" fill="#ffffff"/>
  <rect x="10" y="10" width="${w - 20}" height="${h - 20}" rx="16" fill="none" stroke="#adb5bd" stroke-width="3"/>
  <text data-spadewick-id="rank" x="40" y="90" font-size="72" font-weight="bold" fill="{{ink}}">{{rank}}</text>
  <text data-spadewick-id="suit" x="${w / 2}" y="${h / 2 + 80}" text-anchor="middle" font-size="220" fill="{{ink}}">{{suit}}</text>
  <text data-spadewick-id="rank-bottom" x="${w - 40}" y="${h - 40}" text-anchor="end" font-size="72" font-weight="bold" fill="{{ink}}">{{rank}}</text>
${guides(w, h, poker.w)}
</svg>`
  return {
    manifest: {
      format: 1, id: 'example-playing-card', version: 1, name: 'Playing card',
      description: tr('starters.playing'),
      author: 'Spadewick', license: 'Free to use', cardSize: { id: 'poker', mmW: poker.w, mmH: poker.h },
      templates: [{ file: 'templates/main.svg', name: 'Playing card', role: 'main' }],
      fonts: [], assets: [], icons: [], palette: [],
      fields: [field('Rank', 'rank', 'text'), field('Suit', 'suit', 'text'), field('Ink', 'ink', 'color', { default_value: '#212529' })],
      mockup: { cards: 'mockup/cards.json', previews: [] }
    },
    files: { 'templates/main.svg': svg },
    mockupCards: [
      { display_name: 'Ace of Spades', quantity: 1, fields: { rank: 'A', suit: '♠', ink: '#212529' } },
      { display_name: 'Queen of Hearts', quantity: 1, fields: { rank: 'Q', suit: '♥', ink: '#c92a2a' } },
      { display_name: 'Ten of Diamonds', quantity: 1, fields: { rank: '10', suit: '♦', ink: '#c92a2a' } }
    ]
  }
}

function tarotCard() {
  const w = WIDTH, h = heightFor(tarot)
  const svg = `${xml} width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" rx="18" fill="#1b1b3a"/>
  <rect x="16" y="16" width="${w - 32}" height="${h - 32}" rx="10" fill="none" stroke="#e8c15a" stroke-width="4"/>
  <text data-spadewick-id="title" x="${w / 2}" y="82" text-anchor="middle" font-size="34" font-weight="bold" fill="#e8c15a">{{name}}</text>
  <rect x="46" y="110" width="${w - 92}" height="${h - 360}" rx="6" fill="#2e2e5e"/>
  <clipPath id="art_clip"><rect x="46" y="110" width="${w - 92}" height="${h - 360}" rx="6"/></clipPath>
  <image data-spadewick-id="art" x="46" y="110" width="${w - 92}" height="${h - 360}" href="" preserveAspectRatio="xMidYMid slice" clip-path="url(#art_clip)"/>
  <text data-spadewick-id="body" data-spadewick-field="body" data-spadewick-text-fit="wrap" x="46" y="${h - 230}" width="${w - 92}" height="150" font-size="22" fill="#e9ecef">{{body}}</text>
  <text data-spadewick-id="footer" x="${w / 2}" y="${h - 36}" text-anchor="middle" font-size="18" fill="#e8c15a">{{@card.number}} / {{@card.count}} · {{@card.id}}</text>
${guides(w, h, tarot.w)}
</svg>`
  return {
    manifest: {
      format: 1, id: 'example-tarot', version: 1, name: 'Tarot card with collector number',
      description: tr('starters.tarot'),
      author: 'Spadewick', license: 'Free to use', cardSize: { id: 'tarot', mmW: tarot.w, mmH: tarot.h },
      templates: [{ file: 'templates/main.svg', name: 'Tarot', role: 'main' }],
      fonts: [], assets: [], icons: [],
      palette: [],
      fields: [field('Name', 'name', 'text'), field('Body', 'body', 'text')],
      mockup: { cards: 'mockup/cards.json', previews: [] }
    },
    files: { 'templates/main.svg': svg },
    mockupCards: [
      { display_name: 'The Fool', quantity: 1, fields: { name: 'The Fool', body: 'A traveller steps off the edge of a cliff without looking down. New beginnings, a leap of faith.' } },
      { display_name: 'The Tower', quantity: 1, fields: { name: 'The Tower', body: 'Sudden change brings down what was built on weak ground.' } }
    ]
  }
}

/** Poker size: a parchment quest card with a cost badge, art, a type ribbon, rules, flavour text and a reward bar. */
function questCard() {
  const w = WIDTH, h = heightFor(poker)
  const svg = `${xml} width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="parchment" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#f6e8c6"/><stop offset="100%" stop-color="#e0c68f"/></linearGradient>
  </defs>
  <rect width="${w}" height="${h}" rx="22" fill="#5c3d1e"/>
  <rect x="12" y="12" width="${w - 24}" height="${h - 24}" rx="14" fill="url(#parchment)"/>
  <circle cx="68" cy="68" r="34" fill="#7b2d26" stroke="#e8c15a" stroke-width="4"/>
  <text data-spadewick-id="cost" x="68" y="80" text-anchor="middle" font-size="34" font-weight="bold" fill="#f6e8c6">{{cost}}</text>
  <text data-spadewick-id="title" x="120" y="80" font-size="32" font-weight="bold" fill="#3b2412">{{name}}</text>
  <rect x="34" y="122" width="${w - 68}" height="246" rx="8" fill="#cdb78c" stroke="#5c3d1e" stroke-width="3"/>
  <clipPath id="art_clip"><rect x="34" y="122" width="${w - 68}" height="246" rx="8"/></clipPath>
  <image data-spadewick-id="art" x="34" y="122" width="${w - 68}" height="246" href="" preserveAspectRatio="xMidYMid slice" clip-path="url(#art_clip)"/>
  <rect x="34" y="382" width="${w - 68}" height="36" fill="#5c3d1e"/>
  <text data-spadewick-id="type" x="${w / 2}" y="407" text-anchor="middle" font-size="20" font-style="italic" fill="#f6e8c6">{{type}}</text>
  <text data-spadewick-id="rules" data-spadewick-field="rules" data-spadewick-text-fit="shrink" data-spadewick-text-max-size="22" data-spadewick-text-min-size="12" x="40" y="432" width="${w - 80}" height="130" font-size="22" fill="#2b1a0b">{{rules}}</text>
  <text data-spadewick-id="flavor" data-spadewick-field="flavor" data-spadewick-text-fit="wrap" x="40" y="570" width="${w - 80}" height="56" font-size="16" font-style="italic" fill="#6b5a44">{{flavor}}</text>
  <rect x="34" y="${h - 76}" width="${w - 68}" height="38" rx="8" fill="#7b2d26"/>
  <text data-spadewick-id="reward" x="${w / 2}" y="${h - 51}" text-anchor="middle" font-size="20" font-weight="bold" fill="#f6e8c6">{{reward}}</text>
${guides(w, h, poker.w)}
</svg>`
  return {
    manifest: {
      format: 1, id: 'example-quest', version: 1, name: 'Quest card',
      description: tr('starters.quest'),
      author: 'Spadewick', license: 'Free to use', cardSize: { id: 'poker', mmW: poker.w, mmH: poker.h },
      templates: [{ file: 'templates/main.svg', name: 'Quest card', role: 'main' }],
      fonts: [], assets: [], icons: [], palette: [],
      fields: [field('Name', 'name', 'text'), field('Cost', 'cost', 'number', { validation: '{"min":0,"max":20}' }), field('Type', 'type', 'text'),
        field('Rules', 'rules', 'text'), field('Flavor', 'flavor', 'text'), field('Reward', 'reward', 'text')],
      mockup: { cards: 'mockup/cards.json', previews: [] }
    },
    files: { 'templates/main.svg': svg },
    mockupCards: [
      { display_name: 'Escort the Caravan', quantity: 2, fields: { name: 'Escort the Caravan', cost: '2', type: 'Quest — Journey', rules: 'Place 3 progress tokens here. Remove one at the start of each round. When the last is gone, the quest is complete.', flavor: 'The road is long, and the bandits are patient.', reward: 'Reward: draw 2 cards' } },
      { display_name: 'Slay the Wyrm', quantity: 1, fields: { name: 'Slay the Wyrm', cost: '6', type: 'Quest — Battle', rules: 'The Wyrm has 10 health. Heroes may attack it once per turn.', flavor: 'No one remembers who woke it.', reward: 'Reward: +3 gold' } }
    ]
  }
}

/** Poker size: a dark, modern action card with a big value, a colour field for the accent, and a footer. */
function actionCard() {
  const w = WIDTH, h = heightFor(poker)
  const svg = `${xml} width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" rx="22" fill="#14161f"/>
  <rect x="16" y="16" width="${w - 32}" height="${h - 32}" rx="14" fill="#1e2130"/>
  <rect x="34" y="40" width="8" height="150" rx="4" fill="{{accent}}"/>
  <text data-spadewick-id="value" x="62" y="150" font-size="112" font-weight="bold" fill="{{accent}}">{{value}}</text>
  <text data-spadewick-id="title" x="62" y="188" font-size="32" font-weight="bold" fill="#ffffff">{{name}}</text>
  <text data-spadewick-id="category" x="${w - 34}" y="70" text-anchor="end" font-size="18" letter-spacing="0.12em" fill="#9aa0b4">{{category}}</text>
  <rect x="34" y="214" width="${w - 68}" height="2" fill="#3a3f55"/>
  <rect x="34" y="234" width="${w - 68}" height="190" rx="8" fill="#2a2e44"/>
  <clipPath id="art_clip"><rect x="34" y="234" width="${w - 68}" height="190" rx="8"/></clipPath>
  <image data-spadewick-id="art" x="34" y="234" width="${w - 68}" height="190" href="" preserveAspectRatio="xMidYMid slice" clip-path="url(#art_clip)"/>
  <text data-spadewick-id="rules" data-spadewick-field="rules" data-spadewick-text-fit="shrink" data-spadewick-text-max-size="24" data-spadewick-text-min-size="12" x="40" y="446" width="${w - 80}" height="160" font-size="24" fill="#e9ecef">{{rules}}</text>
  <text data-spadewick-id="id" x="34" y="${h - 40}" font-size="14" fill="#6c738c">{{@card.id}}</text>
  <text data-spadewick-id="number" x="${w - 34}" y="${h - 40}" text-anchor="end" font-size="14" fill="#6c738c">{{@card.number}} / {{@card.count}}</text>
${guides(w, h, poker.w)}
</svg>`
  return {
    manifest: {
      format: 1, id: 'example-action-card', version: 1, name: 'Action card (modern)',
      description: tr('starters.action'),
      author: 'Spadewick', license: 'Free to use', cardSize: { id: 'poker', mmW: poker.w, mmH: poker.h },
      templates: [{ file: 'templates/main.svg', name: 'Action card', role: 'main' }],
      fonts: [], assets: [], icons: [], palette: [],
      fields: [field('Name', 'name', 'text'), field('Value', 'value', 'number'), field('Category', 'category', 'text'),
        field('Rules', 'rules', 'text'), field('Accent', 'accent', 'color', { default_value: '#ff6b6b' })],
      mockup: { cards: 'mockup/cards.json', previews: [] }
    },
    files: { 'templates/main.svg': svg },
    mockupCards: [
      { display_name: 'Sprint', quantity: 3, fields: { name: 'Sprint', value: '4', category: 'MOVE', rules: 'Move up to 4 spaces. You may pass through other players.', accent: '#ff6b6b' } },
      { display_name: 'Shield Up', quantity: 2, fields: { name: 'Shield Up', value: '2', category: 'DEFEND', rules: 'Prevent up to 2 damage until the start of your next turn.', accent: '#4dabf7' } },
      { display_name: 'Overcharge', quantity: 1, fields: { name: 'Overcharge', value: '7', category: 'ATTACK', rules: 'Deal 7 damage to one target. Discard 2 cards.', accent: '#fcc419' } }
    ]
  }
}

/** Tarot size: a cream card with a numeral, an arched art window, a name banner and keywords. */
function tarotArch() {
  const w = WIDTH, h = heightFor(tarot)
  const svg = `${xml} width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" rx="18" fill="#f3ead7"/>
  <rect x="14" y="14" width="${w - 28}" height="${h - 28}" rx="10" fill="none" stroke="#8a6a2a" stroke-width="3"/>
  <rect x="24" y="24" width="${w - 48}" height="${h - 48}" rx="6" fill="none" stroke="#8a6a2a" stroke-width="1"/>
  <text data-spadewick-id="numeral" x="${w / 2}" y="80" text-anchor="middle" font-size="36" fill="#6b4c1e">{{numeral}}</text>
  <path d="M60 560 V300 A190 190 0 0 1 440 300 V560 Z" fill="#d9c9a0"/>
  <clipPath id="art_clip"><path d="M60 560 V300 A190 190 0 0 1 440 300 V560 Z"/></clipPath>
  <image data-spadewick-id="art" x="60" y="110" width="380" height="450" href="" preserveAspectRatio="xMidYMid slice" clip-path="url(#art_clip)"/>
  <path d="M60 560 V300 A190 190 0 0 1 440 300 V560 Z" fill="none" stroke="#8a6a2a" stroke-width="3"/>
  <rect x="60" y="590" width="380" height="56" fill="#8a6a2a"/>
  <text data-spadewick-id="title" x="${w / 2}" y="628" text-anchor="middle" font-size="30" font-weight="bold" fill="#f3ead7">{{name}}</text>
  <text data-spadewick-id="keywords" x="${w / 2}" y="676" text-anchor="middle" font-size="20" font-style="italic" fill="#6b4c1e">{{keywords}}</text>
  <text data-spadewick-id="body" data-spadewick-field="body" data-spadewick-text-fit="shrink" data-spadewick-text-max-size="20" data-spadewick-text-min-size="12" x="60" y="698" width="380" height="104" font-size="20" fill="#3b2c12">{{body}}</text>
  <text data-spadewick-id="footer" x="${w / 2}" y="${h - 36}" text-anchor="middle" font-size="16" fill="#8a6a2a">{{@card.number}} / {{@card.count}}</text>
${guides(w, h, tarot.w)}
</svg>`
  return {
    manifest: {
      format: 1, id: 'example-tarot-arch', version: 1, name: 'Tarot card (arched window)',
      description: tr('starters.tarotArch'),
      author: 'Spadewick', license: 'Free to use', cardSize: { id: 'tarot', mmW: tarot.w, mmH: tarot.h },
      templates: [{ file: 'templates/main.svg', name: 'Tarot arch', role: 'main' }],
      fonts: [], assets: [], icons: [], palette: [],
      fields: [field('Numeral', 'numeral', 'text'), field('Name', 'name', 'text'), field('Keywords', 'keywords', 'text'), field('Body', 'body', 'text')],
      mockup: { cards: 'mockup/cards.json', previews: [] }
    },
    files: { 'templates/main.svg': svg },
    mockupCards: [
      { display_name: 'The Magician', quantity: 1, fields: { numeral: 'I', name: 'The Magician', keywords: 'Will · Skill · Action', body: 'All the tools lie on the table. What you focus on, you can make real.' } },
      { display_name: 'The Star', quantity: 1, fields: { numeral: 'XVII', name: 'The Star', keywords: 'Hope · Renewal · Calm', body: 'After the storm, a quiet light. Trust that healing has already begun.' } }
    ]
  }
}

/** Tarot size: a night-sky oracle card with a gradient, a large art area and a translucent text panel. */
function tarotOracle() {
  const w = WIDTH, h = heightFor(tarot)
  const svg = `${xml} width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#2b1055"/><stop offset="100%" stop-color="#5a6fc4"/></linearGradient>
  </defs>
  <rect width="${w}" height="${h}" rx="18" fill="url(#sky)"/>
  <circle cx="${w / 2}" cy="290" r="150" fill="#ffffff" fill-opacity="0.08"/>
  <circle cx="${w / 2}" cy="290" r="100" fill="#ffffff" fill-opacity="0.1"/>
  <rect x="30" y="30" width="${w - 60}" height="520" rx="12" fill="#ffffff" fill-opacity="0.06" stroke="#ffffff" stroke-opacity="0.5" stroke-width="2"/>
  <clipPath id="art_clip"><rect x="30" y="30" width="${w - 60}" height="520" rx="12"/></clipPath>
  <image data-spadewick-id="art" x="30" y="30" width="${w - 60}" height="520" href="" preserveAspectRatio="xMidYMid slice" clip-path="url(#art_clip)"/>
  <rect x="30" y="576" width="${w - 60}" height="${h - 576 - 30}" rx="12" fill="#0b0620" fill-opacity="0.72"/>
  <text data-spadewick-id="title" x="52" y="626" font-size="32" font-weight="bold" fill="#ffffff">{{name}}</text>
  <text data-spadewick-id="element" x="52" y="656" font-size="18" letter-spacing="0.1em" fill="#b8c4ff">{{element}}</text>
  <text data-spadewick-id="body" data-spadewick-field="body" data-spadewick-text-fit="shrink" data-spadewick-text-max-size="20" data-spadewick-text-min-size="12" x="52" y="676" width="${w - 104}" height="104" font-size="20" fill="#e7eaff">{{body}}</text>
  <text data-spadewick-id="footer" x="${w / 2}" y="${h - 12}" text-anchor="middle" font-size="12" fill="#b8c4ff">{{@card.id}}</text>
${guides(w, h, tarot.w)}
</svg>`
  return {
    manifest: {
      format: 1, id: 'example-tarot-oracle', version: 1, name: 'Oracle card (night sky)',
      description: tr('starters.tarotOracle'),
      author: 'Spadewick', license: 'Free to use', cardSize: { id: 'tarot', mmW: tarot.w, mmH: tarot.h },
      templates: [{ file: 'templates/main.svg', name: 'Oracle', role: 'main' }],
      fonts: [], assets: [], icons: [], palette: [],
      fields: [field('Name', 'name', 'text'), field('Element', 'element', 'text'), field('Body', 'body', 'text')],
      mockup: { cards: 'mockup/cards.json', previews: [] }
    },
    files: { 'templates/main.svg': svg },
    mockupCards: [
      { display_name: 'Moonrise', quantity: 1, fields: { name: 'Moonrise', element: 'WATER', body: 'What was hidden by the day is gently revealed. Listen before you act.' } },
      { display_name: 'Ember Path', quantity: 1, fields: { name: 'Ember Path', element: 'FIRE', body: 'A small flame is enough to find the next step. Keep walking.' } }
    ]
  }
}

/** Poker or tarot size: a card back, to be the card back of a set (PRD §7.8). */
function backStarter({ id, name, size, design, primary, accent, description }) {
  return () => ({
    manifest: {
      format: 1, id, version: 1, name, description,
      author: 'Spadewick', license: 'Free to use', purpose: 'back', cardSize: { id: size.id, mmW: size.w, mmH: size.h },
      templates: [{ file: 'templates/main.svg', name, role: 'main' }],
      fonts: [], assets: [], icons: [], palette: [], fields: [], mockup: { cards: null, previews: [] }
    },
    files: { 'templates/main.svg': backSvg({ mmW: size.w, mmH: size.h }, { design, primary, accent }) },
    mockupCards: []
  })
}

const BACKS = [
  backStarter({ id: 'example-back-classic', name: 'Card back (classic lattice)', size: poker, design: 'classic', primary: '#1b1b3a', accent: '#e8c15a', description: tr('starters.backClassic') }),
  backStarter({ id: 'example-back-glow', name: 'Card back (glow)', size: poker, design: 'glow', primary: '#7b2d26', accent: '#f6e8c6', description: tr('starters.backGlow') }),
  backStarter({ id: 'example-back-tarot-classic', name: 'Tarot back (classic lattice)', size: tarot, design: 'classic', primary: '#2b1055', accent: '#e8c15a', description: tr('starters.backClassic') }),
  backStarter({ id: 'example-back-tarot-plain', name: 'Tarot back (plain)', size: tarot, design: 'plain', primary: '#f3ead7', accent: '#8a6a2a', description: tr('starters.backPlain') })
]

const DESIGNS = [creature, playing, tarotCard, questCard, actionCard, tarotArch, tarotOracle, ...BACKS]

/** Every starter template as { manifest, files, mockupCards }. */
export function starterTemplates() {
  return [...CARD_SIZES.map(blankFrame), ...DESIGNS.map(d => d())]
}

export const starterById = id => starterTemplates().find(s => s.manifest.id === id) ?? null
