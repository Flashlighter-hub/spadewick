import Database from 'better-sqlite3'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { existsSync, mkdirSync } from 'fs'
import { writeSnapshot } from './snapshotCore.js'
import { DEFAULT_PATTERN, formatCardId, deriveSetCode, isReservedFieldName } from '../shared/cardIds.js'
import { renameSlugInSvg } from '../shared/svgTokens.js'
import { CARD_SIZES, CARD_SIZE_BY_ID } from '../shared/cardSizes.js'
import { tr } from '../shared/i18n.js'
import { logError } from './log.js'

// Schema version — increment whenever a migration is added
export const CURRENT_SCHEMA_VERSION = 15

/** A project written by a newer version of the application (PRD §24.2, phase 0.2): refused, never opened. */
export class SchemaTooNewError extends Error {
  constructor(found, supported) {
    super(tr('errors.projectTooNew', { found, supported }))
    this.name = 'SchemaTooNewError'
    this.code = 'SCHEMA_TOO_NEW'
  }
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS project_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sets (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  code        TEXT,   -- short code used in card IDs, unique in the project (PRD §5.8)
  card_size   TEXT,   -- NULL = inherit project default (PRD §10.6)
  card_mm_w   REAL,
  card_mm_h   REAL,
  default_template_id TEXT, -- cards without their own template use this one (PRD §5.2)
  default_back_template_id TEXT, -- the card back of the set: a template drawn with each card's own data (PRD §7.8)
  display_field    TEXT,   -- slug of the field that names a card; NULL = the set has no display name (UPDATES U10)
  identifier_field TEXT,   -- slug of the unique identifier column: the merge key of an import, the base of duplicate checks and edit propagation (UPDATES U9)
  template_rules   TEXT,   -- JSON list of { when, front, back }: which template a card gets from its data, before the set's default (UPDATES U24)
  status_mode      INTEGER NOT NULL DEFAULT 0   -- 0 = cards have no status, 1 = a status, 2 = a status and an art status (UPDATES U26)
);

CREATE TABLE IF NOT EXISTS fields (
  id            TEXT PRIMARY KEY,
  set_id        TEXT NOT NULL REFERENCES sets(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL,
  type          TEXT NOT NULL CHECK(type IN ('text','number','boolean','image_ref','color','formula','rich_text','choice','tags','lookup')),
  default_value TEXT,
  formula       TEXT,
  validation    TEXT,      -- JSON rules: min/max/regex/required; options for choice and tags; { from, set, match, show } for a lookup (UPDATES U23)
  display_order INTEGER NOT NULL DEFAULT 0,
  hidden        INTEGER NOT NULL DEFAULT 0,
  width_px      INTEGER,   -- column width in the card table; NULL = default
  created_at    INTEGER NOT NULL,
  propagate     INTEGER NOT NULL DEFAULT 0,   -- an edit of this column also changes the rows that share the identifier (UPDATES U9)
  UNIQUE(set_id, slug)
);

-- Icons that can be used by name in rich text (PRD §16.4). The picture itself is an asset; the icon adds what text needs.
CREATE TABLE IF NOT EXISTS icons (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,
  aliases      TEXT NOT NULL DEFAULT '[]',
  asset_id     TEXT NOT NULL,
  size         REAL NOT NULL DEFAULT 1,       -- multiple of the text size
  v_offset     REAL NOT NULL DEFAULT 0,       -- em, positive = up
  spacing      REAL NOT NULL DEFAULT 0,       -- em, before and after
  color_mode   TEXT NOT NULL DEFAULT 'follow' CHECK(color_mode IN ('follow','keep')),
  single_color INTEGER NOT NULL DEFAULT 0,
  aspect       REAL NOT NULL DEFAULT 1,       -- width / height
  tags         TEXT NOT NULL DEFAULT '[]',
  notes        TEXT NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL
);

-- Named bundles of text properties, used as {style:name} or by a keyword rule (PRD §16.5)
CREATE TABLE IF NOT EXISTS text_styles (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  props      TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

-- "Whenever the text contains X, show it as Y" (PRD §16.5)
CREATE TABLE IF NOT EXISTS keyword_rules (
  id          TEXT PRIMARY KEY,
  match       TEXT NOT NULL,
  whole_word  INTEGER NOT NULL DEFAULT 1,
  ignore_case INTEGER NOT NULL DEFAULT 0,
  is_pattern  INTEGER NOT NULL DEFAULT 0,
  mode        TEXT NOT NULL CHECK(mode IN ('style','icon','icon_text','replace')),
  action      TEXT NOT NULL DEFAULT '{}',
  scope       TEXT,                           -- NULL = all rich text, else a JSON list of field slugs
  enabled     INTEGER NOT NULL DEFAULT 1,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);

-- Output (CMYK) profiles for production PDFs (PRD §17.5, §17.8): the file is an asset tagged 'icc-profile'
CREATE TABLE IF NOT EXISTS icc_profiles (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,
  asset_id     TEXT NOT NULL,
  colour_space TEXT NOT NULL DEFAULT 'CMYK',
  description  TEXT NOT NULL DEFAULT '',
  licence_note TEXT NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL
);

-- Colours with exact ink values and/or a spot name (PRD §17.5, §28.3): matched to a design's colour by its screen colour
CREATE TABLE IF NOT EXISTS print_colors (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  rgb        TEXT NOT NULL,
  c          REAL,
  m          REAL,
  y          REAL,
  k          REAL,
  spot_name  TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- Saved export settings, used by the dialog and later the command line (PRD §17.8)
CREATE TABLE IF NOT EXISTS export_profiles (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  kind       TEXT NOT NULL DEFAULT 'production',
  options    TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cards (
  id           TEXT PRIMARY KEY,
  set_id       TEXT NOT NULL REFERENCES sets(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL DEFAULT '',
  template_id  TEXT,
  back_template_id TEXT,                    -- a back of this card's own; NULL = the set's card back (PRD §7.8)
  status       TEXT,                        -- idea | draft | playtest | final; NULL = not set (UPDATES U26)
  art_status   TEXT,                        -- needs_art | draft | final; NULL = not set (UPDATES U26)
  instance_json TEXT,                       -- the changes this card keeps of its template: a patch, NULL = it is drawn exactly as the template (UPDATES U29)
  card_code    TEXT,                        -- permanent, never-reused card ID such as FIRE-0042 (PRD §5.8)
  quantity     INTEGER NOT NULL DEFAULT 1,  -- copies of this card in print/TTS exports (PRD §6.5)
  fields_json  TEXT NOT NULL DEFAULT '{}',
  sort_order   INTEGER NOT NULL DEFAULT 0,
  deleted      INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS templates (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  parent_id   TEXT REFERENCES templates(id),
  svg_source  TEXT NOT NULL DEFAULT '',
  origin      TEXT,                         -- JSON: where this copy came from (PRD §7.7.6)
  card_size   TEXT,                         -- preset id or 'custom'; fixed when the template is created (PRD §10.6)
  card_mm_w   REAL,                         -- millimetres, for a custom size
  card_mm_h   REAL,
  bleed_mm    REAL NOT NULL DEFAULT 0,      -- bleed the template's canvas includes, when bleed_mode is 'included' (PRD §17.4)
  bleed_mode  TEXT NOT NULL DEFAULT 'extend', -- 'included' | 'extend' | 'fill'
  bleed_color TEXT,                         -- hex, for 'fill'
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- The rules of the game (PRD §7.11): pages of Markdown in a tree, part of the project and so of its snapshots
CREATE TABLE IF NOT EXISTS rules_pages (
  id         TEXT PRIMARY KEY,
  parent_id  TEXT,                          -- NULL = at the top
  title      TEXT NOT NULL DEFAULT '',
  body       TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,    -- among the pages with the same parent
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Named filters of the card table (UPDATES U25): a filter is an expression in the formula language, as the export filter is
CREATE TABLE IF NOT EXISTS saved_views (
  id         TEXT PRIMARY KEY,
  set_id     TEXT NOT NULL REFERENCES sets(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  filter     TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS id_counters (
  scope TEXT PRIMARY KEY,                   -- a set id, or '@project' (PRD §5.8)
  next  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS assets (
  id               TEXT PRIMARY KEY,
  filename         TEXT NOT NULL UNIQUE,
  original_name    TEXT NOT NULL,
  mime_type        TEXT NOT NULL,
  width_px         INTEGER,
  height_px        INTEGER,
  file_size_bytes  INTEGER,
  tags             TEXT NOT NULL DEFAULT '[]',
  notes            TEXT NOT NULL DEFAULT '',
  thumbnail_jpeg   BLOB,
  created_at       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS fonts (
  id           TEXT PRIMARY KEY,
  family_name  TEXT NOT NULL,
  style        TEXT NOT NULL DEFAULT 'Regular',
  filename     TEXT NOT NULL UNIQUE,
  created_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS undo_log (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  op_type    TEXT NOT NULL,
  payload    TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS redo_log (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  op_type    TEXT NOT NULL,
  payload    TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cards_set_id  ON cards(set_id, sort_order) WHERE deleted = 0;
CREATE INDEX IF NOT EXISTS idx_fields_set_id ON fields(set_id, display_order);
CREATE INDEX IF NOT EXISTS idx_undo_seq      ON undo_log(seq DESC);
CREATE INDEX IF NOT EXISTS idx_redo_seq      ON redo_log(seq DESC);
`

// Indexes on columns that older projects only gain through a migration, so they run afterwards
const POST_MIGRATION_SQL = `
CREATE UNIQUE INDEX IF NOT EXISTS idx_cards_code ON cards(card_code) WHERE card_code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sets_code  ON sets(code) WHERE code IS NOT NULL;

-- cards.display_name is no longer typed in: it is the value of the field the set names as its display field (UPDATES U10),
-- kept here so lists, exports and snapshots can read it without knowing the set. The triggers keep it right however a card is written
-- (editing, import, undo, a restored snapshot).
CREATE TRIGGER IF NOT EXISTS trg_cards_label_insert AFTER INSERT ON cards BEGIN
  UPDATE cards SET display_name = COALESCE((SELECT CASE WHEN s.display_field IS NULL THEN '' ELSE COALESCE(CAST(json_extract(NEW.fields_json, '$."' || s.display_field || '"') AS TEXT), '') END FROM sets s WHERE s.id = NEW.set_id), '') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_cards_label_update AFTER UPDATE OF fields_json, set_id ON cards BEGIN
  UPDATE cards SET display_name = COALESCE((SELECT CASE WHEN s.display_field IS NULL THEN '' ELSE COALESCE(CAST(json_extract(NEW.fields_json, '$."' || s.display_field || '"') AS TEXT), '') END FROM sets s WHERE s.id = NEW.set_id), '') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_sets_label_update AFTER UPDATE OF display_field ON sets BEGIN
  UPDATE cards SET display_name = CASE WHEN NEW.display_field IS NULL THEN '' ELSE COALESCE(CAST(json_extract(fields_json, '$."' || NEW.display_field || '"') AS TEXT), '') END WHERE set_id = NEW.id;
END;
`

// Migrations indexed by the schema_version they target
const MIGRATIONS = {
  2: (db) => {
    // Per-set card size override (PRD §10.6)
    const cols = db.prepare('PRAGMA table_info(sets)').all().map(c => c.name)
    if (!cols.includes('card_size')) db.exec('ALTER TABLE sets ADD COLUMN card_size TEXT')
    if (!cols.includes('card_mm_w')) db.exec('ALTER TABLE sets ADD COLUMN card_mm_w REAL')
    if (!cols.includes('card_mm_h')) db.exec('ALTER TABLE sets ADD COLUMN card_mm_h REAL')
  },
  3: (db) => {
    // Set-level default template (PRD §5.2)
    const cols = db.prepare('PRAGMA table_info(sets)').all().map(c => c.name)
    if (!cols.includes('default_template_id')) db.exec('ALTER TABLE sets ADD COLUMN default_template_id TEXT')
  },
  4: (db) => {
    // Persisted column widths (PRD §6.1)
    const cols = db.prepare('PRAGMA table_info(fields)').all().map(c => c.name)
    if (!cols.includes('width_px')) db.exec('ALTER TABLE fields ADD COLUMN width_px INTEGER')
  },
  5: (db) => {
    // Copies per card for exports (PRD §6.5)
    const cols = db.prepare('PRAGMA table_info(cards)').all().map(c => c.name)
    if (!cols.includes('quantity')) db.exec('ALTER TABLE cards ADD COLUMN quantity INTEGER NOT NULL DEFAULT 1')
  },
  6: (db) => {
    // Card IDs (PRD §5.8) and template origin (PRD §7.7.6)
    const has = (table, col) => db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col)
    if (!has('sets', 'code')) db.exec('ALTER TABLE sets ADD COLUMN code TEXT')
    if (!has('cards', 'card_code')) db.exec('ALTER TABLE cards ADD COLUMN card_code TEXT')
    if (!has('templates', 'origin')) db.exec('ALTER TABLE templates ADD COLUMN origin TEXT')
    db.exec('CREATE TABLE IF NOT EXISTS id_counters (scope TEXT PRIMARY KEY, next INTEGER NOT NULL)')
    const notices = []
    notices.push(...renameReservedFields(db))

    // A short code for every set, derived from its name
    const taken = new Set()
    const sets = db.prepare('SELECT id, name FROM sets ORDER BY sort_order, created_at').all()
    for (const set of sets) {
      const code = deriveSetCode(set.name, taken)
      taken.add(code)
      db.prepare('UPDATE sets SET code = ? WHERE id = ?').run(code, set.id)
    }

    // An ID for every card, in its current display order; deleted cards get one too so that undo can bring them back
    const setCode = new Map(db.prepare('SELECT id, code FROM sets').all().map(r => [r.id, r.code]))
    let assigned = 0
    for (const set of sets) {
      const cards = db.prepare('SELECT id FROM cards WHERE set_id = ? ORDER BY deleted, sort_order, created_at').all(set.id)
      let n = 1
      for (const card of cards) {
        db.prepare('UPDATE cards SET card_code = ? WHERE id = ?').run(formatCardId(DEFAULT_PATTERN, { set: setCode.get(set.id), n: n++ }), card.id)
        assigned++
      }
      db.prepare('INSERT OR REPLACE INTO id_counters (scope, next) VALUES (?, ?)').run(set.id, n)
    }
    if (assigned) notices.push(tr('cardIds.upgradeAssigned', { n: assigned }))
    return notices
  },
  7: (db) => {
    // Card size belongs to each set and each template; the project default and the project palette are gone (PRD §10.6, §7.5)
    const has = (table, col) => db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col)
    for (const [col, type] of [['card_size', 'TEXT'], ['card_mm_w', 'REAL'], ['card_mm_h', 'REAL']]) {
      if (!has('templates', col)) db.exec(`ALTER TABLE templates ADD COLUMN ${col} ${type}`)
    }
    const notices = []
    const meta = key => db.prepare('SELECT value FROM project_meta WHERE key = ?').get(key)?.value ?? null
    const poker = CARD_SIZE_BY_ID.poker
    // { id, mmW, mmH } from a preset id (or 'custom' with its millimetres); anything unknown is Poker
    const sizeOf = (id, w, h) => (CARD_SIZE_BY_ID[id] ? { id, mmW: CARD_SIZE_BY_ID[id].w, mmH: CARD_SIZE_BY_ID[id].h }
      : id === 'custom' && w > 0 && h > 0 ? { id: 'custom', mmW: w, mmH: h } : { id: 'poker', mmW: poker.w, mmH: poker.h })
    const projectSize = sizeOf(meta('card_size'), Number(meta('card_mm_w')), Number(meta('card_mm_h')))
    const columns = size => [size.id, size.id === 'custom' ? size.mmW : null, size.id === 'custom' ? size.mmH : null]

    // Every set gets a size of its own
    const setSize = new Map()
    let filled = 0
    for (const s of db.prepare('SELECT id, card_size, card_mm_w, card_mm_h FROM sets').all()) {
      let size = s.card_size ? sizeOf(s.card_size, s.card_mm_w, s.card_mm_h) : projectSize
      if (!s.card_size) { db.prepare('UPDATE sets SET card_size = ?, card_mm_w = ?, card_mm_h = ? WHERE id = ?').run(...columns(size), s.id); filled++ }
      setSize.set(s.id, size)
    }
    if (filled) notices.push(tr('upgrade.setSizes', { n: filled }))

    // Every template gets a size: from a set that uses it when the shapes agree, else the nearest preset, else the project's
    const svgShape = svg => {
      const vb = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(svg)
      if (vb) return Number(vb[1]) / Number(vb[2])
      const w = /<svg[^>]*\swidth\s*=\s*["']([\d.]+)/.exec(svg), h = /<svg[^>]*\sheight\s*=\s*["']([\d.]+)/.exec(svg)
      return w && h ? Number(w[1]) / Number(h[1]) : null
    }
    const near = (ratio, size) => Math.abs(ratio / (size.mmW / size.mmH) - 1)
    const templates = db.prepare('SELECT id, parent_id, svg_source FROM templates').all()
    const sizeOfTemplate = new Map()
    for (const t of templates.filter(t => !t.parent_id)) {
      const users = new Set([
        ...db.prepare('SELECT id FROM sets WHERE default_template_id = ?').all(t.id).map(r => r.id),
        ...db.prepare('SELECT DISTINCT set_id FROM cards WHERE template_id = ?').all(t.id).map(r => r.set_id)
      ])
      const ratio = svgShape(t.svg_source)
      const candidates = [...users].map(id => setSize.get(id)).filter(Boolean)
      let size = null
      if (ratio) {
        size = candidates.find(c => near(ratio, c) <= 0.03) ?? null
        if (!size) {
          const best = CARD_SIZES.map(p => ({ id: p.id, mmW: p.w, mmH: p.h })).sort((a, b) => near(ratio, a) - near(ratio, b))[0]
          if (near(ratio, best) <= 0.03) size = best
        }
      }
      size = size ?? candidates[0] ?? projectSize
      sizeOfTemplate.set(t.id, size)
    }
    // a child template is drawn inside its parent, so it has the parent's size
    for (const t of templates.filter(t => t.parent_id)) sizeOfTemplate.set(t.id, sizeOfTemplate.get(t.parent_id) ?? projectSize)
    for (const [id, size] of sizeOfTemplate) db.prepare('UPDATE templates SET card_size = ?, card_mm_w = ?, card_mm_h = ? WHERE id = ?').run(...columns(size), id)
    if (sizeOfTemplate.size) notices.push(tr('upgrade.templateSizes', { n: sizeOfTemplate.size }))

    // The project palette is gone: every use of a colour name becomes the colour itself
    const hasPalette = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'palette'").get()
    const palette = hasPalette ? Object.fromEntries(db.prepare('SELECT name, value FROM palette').all().map(r => [r.name, r.value])) : {}
    const inlinePalette = text => text
      .replace(/\{\{\s*@palette\.([^}\s]+)\s*\}\}/g, (_, n) => palette[n] ?? '')
      .replace(/palette\(\s*(["'])([^"']+)\1\s*\)/g, (_, _q, n) => `"${palette[n] ?? n}"`)
    let inlined = 0
    for (const t of templates) {
      const next = inlinePalette(t.svg_source)
      if (next !== t.svg_source) { db.prepare('UPDATE templates SET svg_source = ? WHERE id = ?').run(next, t.id); inlined++ }
    }
    for (const f of db.prepare("SELECT id, formula FROM fields WHERE formula IS NOT NULL AND formula LIKE '%palette%'").all()) {
      const next = inlinePalette(f.formula)
      if (next !== f.formula) { db.prepare('UPDATE fields SET formula = ? WHERE id = ?').run(next, f.id); inlined++ }
    }
    if (inlined) notices.push(tr('upgrade.paletteInlined', { n: inlined }))
    return notices
  },
  8: (db) => {
    // The Rich text field type (PRD §16.7). SQLite cannot change a CHECK constraint, so the fields table is rebuilt
    // with the longer list of types; nothing else refers to it, and every row is copied as it is.
    const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'fields'").get()?.sql ?? ''
    if (sql.includes("'rich_text'")) return
    db.exec('ALTER TABLE fields RENAME TO fields_v7')
    db.exec(`CREATE TABLE fields (
      id            TEXT PRIMARY KEY,
      set_id        TEXT NOT NULL REFERENCES sets(id) ON DELETE CASCADE,
      name          TEXT NOT NULL,
      slug          TEXT NOT NULL,
      type          TEXT NOT NULL CHECK(type IN ('text','number','boolean','image_ref','color','formula','rich_text')),
      default_value TEXT,
      formula       TEXT,
      validation    TEXT,
      display_order INTEGER NOT NULL DEFAULT 0,
      hidden        INTEGER NOT NULL DEFAULT 0,
      width_px      INTEGER,
      created_at    INTEGER NOT NULL,
      UNIQUE(set_id, slug)
    )`)
    db.exec('INSERT INTO fields (id, set_id, name, slug, type, default_value, formula, validation, display_order, hidden, width_px, created_at) ' +
      'SELECT id, set_id, name, slug, type, default_value, formula, validation, display_order, hidden, width_px, created_at FROM fields_v7')
    db.exec('DROP TABLE fields_v7')
    db.exec('CREATE INDEX IF NOT EXISTS idx_fields_set_id ON fields(set_id, display_order)')
  },
  9: () => {
    // Icons, text styles and keyword rules (PRD §16.8): the tables are created with the rest of the schema; nothing to move
  },
  10: (db) => {
    // Production PDF (PRD §17.8): the template's bleed; the tables for profiles, print colours and saved settings come with the schema
    const has = col => db.prepare('PRAGMA table_info(templates)').all().some(c => c.name === col)
    if (!has('bleed_mm')) db.exec('ALTER TABLE templates ADD COLUMN bleed_mm REAL NOT NULL DEFAULT 0')
    if (!has('bleed_mode')) db.exec("ALTER TABLE templates ADD COLUMN bleed_mode TEXT NOT NULL DEFAULT 'extend'")
    if (!has('bleed_color')) db.exec('ALTER TABLE templates ADD COLUMN bleed_color TEXT')
  },
  11: (db) => {
    // Card backs (PRD §7.8): a set's card back and a card's own back, both templates
    const has = (table, col) => db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col)
    if (!has('sets', 'default_back_template_id')) db.exec('ALTER TABLE sets ADD COLUMN default_back_template_id TEXT')
    if (!has('cards', 'back_template_id')) db.exec('ALTER TABLE cards ADD COLUMN back_template_id TEXT')
  },
  12: () => {
    // The rules pages (PRD §7.11): the table is created with the rest of the schema; nothing to move
  },
  13: (db) => {
    // No built-in Name column (UPDATES U10): each set names the field that is its display name. The old name of every card moves into a
    // normal text field (an existing "name" field is used when it already says the same), chosen as the display field, so nothing changes visibly.
    // Also the identifier column of a set and the "propagate edits" flag of a field (UPDATES U9).
    const has = (table, col) => db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col)
    if (!has('sets', 'display_field')) db.exec('ALTER TABLE sets ADD COLUMN display_field TEXT')
    if (!has('sets', 'identifier_field')) db.exec('ALTER TABLE sets ADD COLUMN identifier_field TEXT')
    if (!has('fields', 'propagate')) db.exec('ALTER TABLE fields ADD COLUMN propagate INTEGER NOT NULL DEFAULT 0')
    const notices = []
    let created = 0
    const now = Date.now()
    for (const set of db.prepare('SELECT id FROM sets WHERE display_field IS NULL').all()) {
      const fields = db.prepare('SELECT * FROM fields WHERE set_id = ? ORDER BY display_order').all(set.id)
      const cards = db.prepare('SELECT id, display_name, fields_json FROM cards WHERE set_id = ?').all(set.id)
      const parsed = cards.map(c => ({ ...c, values: JSON.parse(c.fields_json || '{}') }))
      const existing = fields.find(f => f.slug === 'name' && f.type === 'text')
      let slug
      if (existing && parsed.every(c => !c.display_name || c.display_name === c.values.name)) slug = existing.slug
      else {
        const used = new Set(fields.map(f => f.slug))
        slug = ['name', 'display_name', 'card_name'].find(s => !used.has(s))
        for (let i = 2; !slug; i++) if (!used.has(`name_${i}`)) slug = `name_${i}`
        const name = fields.some(f => f.name === 'Name') ? 'Display name' : 'Name'
        db.prepare('UPDATE fields SET display_order = display_order + 1 WHERE set_id = ?').run(set.id)
        db.prepare("INSERT INTO fields (id, set_id, name, slug, type, display_order, hidden, created_at) VALUES (?, ?, ?, ?, 'text', 0, 0, ?)")
          .run(randomUUID(), set.id, name, slug, now)
        for (const c of parsed) db.prepare('UPDATE cards SET fields_json = ? WHERE id = ?').run(JSON.stringify({ ...c.values, [slug]: c.display_name ?? '' }), c.id)
        created++
      }
      db.prepare('UPDATE sets SET display_field = ? WHERE id = ?').run(slug, set.id)
      for (const c of db.prepare('SELECT id, fields_json FROM cards WHERE set_id = ?').all(set.id)) {
        const v = JSON.parse(c.fields_json || '{}')[slug]
        db.prepare('UPDATE cards SET display_name = ? WHERE id = ?').run(v == null ? '' : String(v), c.id)
      }
    }
    if (created) notices.push(tr('upgrade.nameFields', { n: created }))
    return notices
  },
  14: (db) => {
    // Choice, tag and lookup fields, template rules, saved views and the card status (UPDATES U23 to U26). SQLite cannot change a CHECK
    // constraint, so the fields table is rebuilt with the longer list of types (as in version 8); every row is copied as it is.
    const has = (table, col) => db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col)
    const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'fields'").get()?.sql ?? ''
    if (!sql.includes("'lookup'")) {
      db.exec('ALTER TABLE fields RENAME TO fields_v13')
      db.exec(`CREATE TABLE fields (
        id            TEXT PRIMARY KEY,
        set_id        TEXT NOT NULL REFERENCES sets(id) ON DELETE CASCADE,
        name          TEXT NOT NULL,
        slug          TEXT NOT NULL,
        type          TEXT NOT NULL CHECK(type IN ('text','number','boolean','image_ref','color','formula','rich_text','choice','tags','lookup')),
        default_value TEXT,
        formula       TEXT,
        validation    TEXT,
        display_order INTEGER NOT NULL DEFAULT 0,
        hidden        INTEGER NOT NULL DEFAULT 0,
        width_px      INTEGER,
        created_at    INTEGER NOT NULL,
        propagate     INTEGER NOT NULL DEFAULT 0,
        UNIQUE(set_id, slug)
      )`)
      db.exec('INSERT INTO fields (id, set_id, name, slug, type, default_value, formula, validation, display_order, hidden, width_px, created_at, propagate) ' +
        'SELECT id, set_id, name, slug, type, default_value, formula, validation, display_order, hidden, width_px, created_at, propagate FROM fields_v13')
      db.exec('DROP TABLE fields_v13')
      db.exec('CREATE INDEX IF NOT EXISTS idx_fields_set_id ON fields(set_id, display_order)')
    }
    if (!has('sets', 'template_rules')) db.exec('ALTER TABLE sets ADD COLUMN template_rules TEXT')
    if (!has('sets', 'status_mode')) db.exec('ALTER TABLE sets ADD COLUMN status_mode INTEGER NOT NULL DEFAULT 0')
    if (!has('cards', 'status')) db.exec('ALTER TABLE cards ADD COLUMN status TEXT')
    if (!has('cards', 'art_status')) db.exec('ALTER TABLE cards ADD COLUMN art_status TEXT')
  },
  15: (db) => {
    // A card's own instance of its template (UPDATES U29): the patch of changes the card keeps
    const has = (table, col) => db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col)
    if (!has('cards', 'instance_json')) db.exec('ALTER TABLE cards ADD COLUMN instance_json TEXT')
  }
}

/** `card_id` is reserved for the built-in column; existing fields using the name become card_id_2 (PRD §5.8). */
function renameReservedFields(db) {
  const notices = []
  const slugOf = name => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
  for (const f of db.prepare('SELECT * FROM fields').all()) {
    const slugClash = f.slug === 'card_id'
    const nameClash = isReservedFieldName(f.name)
    if (!slugClash && !nameClash) continue
    let slug = f.slug, name = f.name
    if (nameClash) name = `${f.name} 2`
    if (slugClash) {
      const used = new Set(db.prepare('SELECT slug FROM fields WHERE set_id = ?').all(f.set_id).map(r => r.slug))
      let i = 2
      while (used.has(`card_id_${i}`)) i++
      slug = `card_id_${i}`
      for (const c of db.prepare('SELECT id, fields_json FROM cards WHERE set_id = ?').all(f.set_id)) {
        const data = JSON.parse(c.fields_json)
        if (!Object.hasOwn(data, 'card_id')) continue
        data[slug] = data.card_id
        delete data.card_id
        db.prepare('UPDATE cards SET fields_json = ? WHERE id = ?').run(JSON.stringify(data), c.id)
      }
      for (const t of db.prepare('SELECT id, svg_source FROM templates').all()) {
        const next = renameSlugInSvg(t.svg_source, 'card_id', slug)
        if (next !== t.svg_source) db.prepare('UPDATE templates SET svg_source = ? WHERE id = ?').run(next, t.id)
      }
      for (const g of db.prepare("SELECT id, formula FROM fields WHERE set_id = ? AND type = 'formula' AND formula IS NOT NULL").all(f.set_id)) {
        const next = g.formula.replace(/\bcard_id\b/g, slug)
        if (next !== g.formula) db.prepare('UPDATE fields SET formula = ? WHERE id = ?').run(next, g.id)
      }
    }
    db.prepare('UPDATE fields SET slug = ?, name = ? WHERE id = ?').run(slug, name, f.id)
    notices.push(tr('cardIds.upgradeRenamedField', { from: f.name, to: name }))
  }
  return notices
}

// Currently open databases, keyed by project folder path
const openDbs = new Map()

// What the last open of each project had to do (read once by the shell to tell the user)
const upgrades = new Map()
export const takeUpgradeInfo = projectDir => { const info = upgrades.get(projectDir) ?? null; upgrades.delete(projectDir); return info }

/** The schema version a project database was written with; 0 for a new, empty database. */
function storedVersion(db) {
  const hasMeta = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'project_meta'").get()
  if (!hasMeta) return 0
  const row = db.prepare('SELECT value FROM project_meta WHERE key = ?').get('schema_version')
  return row ? parseInt(row.value, 10) || 0 : 0
}

/**
 * Under Electron in development, use the Electron build of better-sqlite3 that `npm install` fetched
 * (scripts/native.mjs); the build in node_modules is for Node, which the tests use. A packaged app
 * has no such folder and uses the build electron-builder made for it.
 */
function nativeBinding() {
  if (!process.versions.electron) return undefined
  const file = join(process.cwd(), 'node_modules', 'better-sqlite3', 'prebuilt', 'electron', 'better_sqlite3.node')
  return existsSync(file) ? file : undefined
}

export function openProjectDb(projectDir) {
  if (openDbs.has(projectDir)) return openDbs.get(projectDir)

  const dbPath = join(projectDir, 'project.db')
  const db = new Database(dbPath, { nativeBinding: nativeBinding() })

  try {
    // Schema guard (PRD §24.2, phase 0.2): look before touching anything. A project made by a newer
    // version is refused, because opening it with older rules would misread it and could damage it.
    const currentVersion = storedVersion(db)
    if (currentVersion > CURRENT_SCHEMA_VERSION) throw new SchemaTooNewError(currentVersion, CURRENT_SCHEMA_VERSION)

    // Enable WAL mode for crash safety (PRD §14.2)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')

    // A snapshot first, before anything is added to the old project, so restoring it brings back exactly
    // what the user had (PRD §5.8)
    let snapshot = null
    if (currentVersion > 0 && currentVersion < CURRENT_SCHEMA_VERSION) {
      try {
        snapshot = writeSnapshot(projectDir, db, {
          id: `pre_upgrade_v${currentVersion}_${Date.now()}`,
          name: tr('snapshots.upgradeName', { from: currentVersion, to: CURRENT_SCHEMA_VERSION }),
          description: tr('snapshots.upgradeDescription')
        })
      } catch (err) {
        logError('db:pre-upgrade-snapshot', err)
      }
    }

    // Initialize schema
    db.exec(SCHEMA_SQL)

    if (currentVersion === 0) {
      db.prepare('INSERT OR REPLACE INTO project_meta (key, value) VALUES (?, ?)').run(
        'schema_version',
        String(CURRENT_SCHEMA_VERSION)
      )
    } else if (currentVersion < CURRENT_SCHEMA_VERSION) {
      const notices = runMigrations(db, currentVersion)
      upgrades.set(projectDir, { from: currentVersion, to: CURRENT_SCHEMA_VERSION, snapshot: snapshot?.id ?? null, notices })
    }
    db.exec(POST_MIGRATION_SQL)
  } catch (err) {
    db.close()
    throw err
  }

  openDbs.set(projectDir, db)
  return db
}

export function closeProjectDb(projectDir) {
  const db = openDbs.get(projectDir)
  if (db) {
    db.close()
    openDbs.delete(projectDir)
  }
}

export function getDb(projectDir) {
  return openDbs.get(projectDir) ?? null
}

function runMigrations(db, fromVersion) {
  const notices = []
  let version = fromVersion
  while (version < CURRENT_SCHEMA_VERSION) {
    version++
    if (MIGRATIONS[version]) {
      db.transaction(() => {
        notices.push(...(MIGRATIONS[version](db) ?? []))
        db.prepare('INSERT OR REPLACE INTO project_meta (key, value) VALUES (?, ?)').run(
          'schema_version',
          String(version)
        )
      })()
    }
  }
  return notices
}

export function checkIntegrity(db) {
  const result = db.pragma('integrity_check')
  return result[0]?.integrity_check === 'ok'
}

export function ensureProjectDirs(projectDir) {
  for (const sub of ['templates', 'assets', 'fonts', 'exports', 'snapshots']) {
    const dir = join(projectDir, sub)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  }
}
