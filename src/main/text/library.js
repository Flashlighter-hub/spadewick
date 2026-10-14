/**
 * What the text engine needs from the project besides fonts (PRD §16.4, §16.5): the icons by name, the text styles, and
 * the keyword rules. Loaded once per card; an icon's picture is read only when text uses it.
 */
import { drawable } from '../rasterUri.js'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { iconKey } from '../../shared/richText.js'
import { starterIcon } from '../../shared/starterIcons.js'
import { iconSvgParts } from '../../shared/iconSvg.js'

const json = (text, fallback) => { try { return JSON.parse(text) } catch { return fallback } }
const DEFAULTS = { aspect: 1, size: 1, vOffset: 0, spacing: 0 }

/**
 * An icon as the engine draws it:
 *   { kind: 'commands', commands }          a built-in shape (0..100 box)
 *   { kind: 'svg', parts, follow }          an SVG from the library; `follow`: it takes the colour of the text
 *   { kind: 'raster', href }                a picture, drawn as it is
 * each with { aspect, size, vOffset, spacing }, the settings of the icon.
 */
function starterEntry(key) {
  const commands = starterIcon(key)
  return commands ? { kind: 'commands', commands, ...DEFAULTS } : null
}

/** A library with nothing in it: only the built-in icons, no styles, no rules. */
export const emptyLibrary = { entry: key => starterEntry(iconKey(key)), styles: new Map(), styleKeys: new Set(), rules: [] }

/**
 * @param {object} db the project database
 * @param {string} projectDir
 */
export function createTextLibrary(db, projectDir) {
  const iconRows = db.prepare('SELECT * FROM icons').all()
  const byKey = new Map()
  for (const r of iconRows) byKey.set(r.name, r)                                    // names first,
  for (const r of iconRows) for (const a of json(r.aliases, [])) if (!byKey.has(a)) byKey.set(a, r) // then aliases
  const cache = new Map()

  function entry(name) {
    const key = iconKey(name)
    if (cache.has(key)) return cache.get(key)
    let e = null
    const row = byKey.get(key)
    if (row) {
      const settings = { aspect: row.aspect, size: row.size, vOffset: row.v_offset, spacing: row.spacing }
      const asset = db.prepare('SELECT filename, mime_type FROM assets WHERE id = ?').get(row.asset_id)
      const file = asset && join(projectDir, 'assets', asset.filename)
      if (file && existsSync(file)) {
        if (asset.mime_type === 'image/svg+xml') {
          const parts = iconSvgParts(readFileSync(file, 'utf8'))
          if (parts) e = { kind: 'svg', parts, follow: row.color_mode === 'follow' && parts.single, ...settings }
        } else {
          const pic = drawable(projectDir, asset)   // a WebP icon is drawn from its PNG copy
          if (pic) e = { kind: 'raster', href: `data:${pic.mime};base64,${readFileSync(pic.file).toString('base64')}`, ...settings }
        }
      } // a library icon whose picture is gone is a missing icon: a placeholder is drawn and it is reported
    } else e = starterEntry(key)
    cache.set(key, e)
    return e
  }

  const styles = new Map(db.prepare('SELECT name, props FROM text_styles').all().map(r => [r.name, json(r.props, {})]))
  const rules = db.prepare('SELECT * FROM keyword_rules ORDER BY sort_order, created_at').all().map(r => ({
    match: r.match, wholeWord: !!r.whole_word, ignoreCase: !!r.ignore_case, isPattern: !!r.is_pattern, mode: r.mode,
    action: json(r.action, {}), scope: r.scope == null ? null : json(r.scope, null), enabled: !!r.enabled
  }))
  return { entry, styles, styleKeys: new Set(styles.keys()), rules }
}
