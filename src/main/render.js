/**
 * Card rendering pipeline — PRD §10.5
 *
 * Steps:
 *  1. Load card + field values from DB
 *  2. Evaluate formula fields
 *  3. Load template, resolve inheritance (parent slot merging)
 *  5. Conditional rendering       (data-spadewick-show-if / hide-if)
 *  6. Token substitution          ({{slug}})
 *  7. Text                        (outlines from real font measurements, text/; or, for a project that
 *                                  still uses the old estimate, dynamicText.js before the tokens)
 *  8. Collect font files          (bundled defaults + referenced project fonts; resvg ignores @font-face)
 *  9. Rasterize via resvg-js      → PNG Buffer
 */

import { join } from 'path'
import { readFileSync, existsSync } from 'fs'
import { rasterize } from './safeRaster.js'
import { openProjectDb } from './db.js'
import { evaluateFormula } from './formula.js'
import { getCardSize } from './cardSize.js'
import { applyDynamicText } from './dynamicText.js'
import { defaultFontFiles, DEFAULT_FAMILIES, mapGenericFonts } from './fontFiles.js'
import { tr } from '../shared/i18n.js'
import { upgradeLegacyMarkup } from '../shared/legacy.js'
import { cardContext, withCardContext } from './cardIds.js'
import { loadHarfBuzz } from './text/hb.js'
import { createFontSet } from './text/fonts.js'
import { convertText, applyOverflow, markRichTokens } from './text/svgText.js'
import { createTextLibrary } from './text/library.js'
import { richSlugsOf, plainValues } from './richFields.js'
import { stripMarkup } from '../shared/richText.js'
import { createResolver } from './core/values.js'
import { ensurePngCache, drawable, pngifyDataUris } from './rasterUri.js'
import { ruleTemplate } from './templateRules.js'
import { applyInstance, readPatch } from './instance.js'

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * @param {string} projectDir
 * @param {string} cardId
 * @param {{ width?: number, height?: number }} [opts]
 * @returns {Promise<Buffer>} PNG buffer
 */
export async function renderCard(projectDir, cardId, opts = {}) {
  const { svg, fontFiles, db, card } = await buildCardSvg(projectDir, cardId, opts)
  const size   = getCardSize(db, card.set_id)
  const width  = opts.width  ?? size.widthPx

  // drawn in a helper process: a panic of the drawing engine must not stop the application (safeRaster.js)
  return rasterize(svg, {
    fitTo: { mode: 'width', value: width },
    font: {
      loadSystemFonts: false, // keep exports identical on every machine
      fontFiles,
      defaultFontFamily: DEFAULT_FAMILIES.sans,
      sansSerifFamily: DEFAULT_FAMILIES.sans,
      serifFamily: DEFAULT_FAMILIES.serif,
      monospaceFamily: DEFAULT_FAMILIES.mono
    }
  }, { report: opts.report, what: `card ${cardId}` })
}

/**
 * Everything up to the rasterizer: the card's final SVG (text already drawn) and the fonts the rasterizer still needs.
 * `opts.report`, when given, learns what the text step saw (characters no font had, elements left to the rasterizer).
 * @returns {Promise<{ svg: string, fontFiles: string[], db, card }>}
 */
export async function buildCardSvg(projectDir, cardId, opts = {}) {
  const db = openProjectDb(projectDir)

  // --- 1. Card + fields -------------------------------------------------------
  const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(cardId)
  if (!card) throw new Error(tr('errors.cardNotFoundId', { id: cardId }))

  const fieldDefs = db.prepare('SELECT * FROM fields WHERE set_id = ? ORDER BY display_order').all(card.set_id)
  // Include display_name so templates can use {{display_name}}, and the card's ID and position for {{@card.id}} (PRD §5.8)
  const rawFields = withCardContext({ ...JSON.parse(card.fields_json), display_name: card.display_name }, cardContext(db, card))

  // --- 2. Evaluate formula fields ---------------------------------------------
  const resolvedFields = { ...rawFields }
  // Formulas read a Rich text field as the text it reads as, without its markup (PRD §16.7)
  const richSlugs = richSlugsOf(fieldDefs)
  // Lookup fields (UPDATES U23) take their value from a card of another set; formulas may then use them
  if (fieldDefs.some(f => f.type === 'lookup')) Object.assign(resolvedFields, createResolver(db).lookupsOf(card))
  const formulaInput = plainValues(resolvedFields, richSlugs)
  for (const fd of fieldDefs.filter(f => f.type === 'formula')) {
    resolvedFields[fd.slug] = formulaInput[fd.slug] = evaluateFormula(fd.formula ?? '', formulaInput)
  }

  // --- 3. Load template + resolve inheritance ---------------------------------
  // opts.templateId / opts.svgSource let the canvas editor preview an unsaved template with any card's data
  // A card's own template wins; otherwise the set's default applies (PRD §5.2)
  const back = opts.side === 'back'                       // the card's back is drawn with the same data as its front (PRD §7.8)
  const templateId = opts.templateId ?? (back ? effectiveBackTemplateId(db, card) : effectiveTemplateId(db, card))
  if (!templateId) throw new Error(back ? tr('errors.noBack') : tr('errors.noTemplate'))
  const stored = db.prepare('SELECT * FROM templates WHERE id = ?').get(templateId)
  if (!stored) throw new Error(tr('errors.templateNotFoundId', { id: templateId }))
  const template = opts.svgSource != null ? { ...stored, svg_source: opts.svgSource } : stored

  let svgSource = resolveInheritance(template, db)
  // What this card changed of its template (UPDATES U29). Not for a drawing of an unsaved or chosen template (the editors pass the source they want drawn).
  if (!back && opts.svgSource == null && opts.templateId == null) svgSource = applyInstance(svgSource, readPatch(card.instance_json))

  // --- 5. Conditional rendering -----------------------------------------------
  svgSource = applyConditionals(svgSource, resolvedFields)

  // --- 6. Text, the old way: estimated widths, before the tokens (a project that has not moved to the new engine) --
  const engine = opts.textEngine ?? textEngineOf(db) // opts.textEngine lets the upgrade compare the two without switching the project
  if (engine === 'estimate') {
    // The earlier estimate knows no markup: a Rich text field shows as the plain text it reads as
    for (const slug of richSlugs) if (slug in resolvedFields) resolvedFields[slug] = stripMarkup(resolvedFields[slug])
    svgSource = applyDynamicText(svgSource, resolvedFields)
  } else {
    svgSource = markRichTokens(svgSource, richSlugs) // elements whose content is a Rich text token read their markup
  }

  // --- 7. Token substitution --------------------------------------------------
  await ensurePngCache(db, projectDir)
  svgSource = await pngifyDataUris(await substituteTokens(svgSource, resolvedFields, fieldDefs, projectDir, db))

  // --- 7b. Text, the new way: laid out with the fonts' own measurements and drawn as outlines (PRD §16.2) ----------
  if (engine === 'outlines') svgSource = await drawText(svgSource, resolvedFields, Object.fromEntries(fieldDefs.map(f => [f.slug, f.type])), projectDir, db, opts.report)

  // --- 8. Fonts: passed to the rasterizer as files (resvg ignores @font-face) --------
  svgSource = mapGenericFonts(svgSource)
  const fontFiles = collectFontFiles(svgSource, projectDir, db)

  return { svg: svgSource, fontFiles, db, card }
}

// ---------------------------------------------------------------------------
// Step 7b — Text as outlines
// ---------------------------------------------------------------------------

/** Which text engine a project uses: 'outlines' (the engine) or 'estimate' (the old per-character estimate). Settable per project. */
export function textEngineOf(db) {
  return getMeta(db, 'text_engine') === 'outlines' ? 'outlines' : 'estimate'
}

async function drawText(svg, fields, fieldTypes, projectDir, db, report) {
  const hb = await loadHarfBuzz()
  const env = { fontSet: createFontSet(hb, { projectDir, db }), library: createTextLibrary(db, projectDir), fields, fieldTypes, report, overflow: new Map() }
  svg = convertText(svg, env, 'bound')
  svg = applyOverflow(svg, env.overflow)
  svg = applyDynamicText(svg, fields)  // a bound element the engine left alone is laid out the old way, for the rasterizer
  svg = resolveOverflowTargets(svg)
  return convertText(svg, env, 'plain')
}

/** The template a card renders with: its own, else its set's default. */
export function effectiveTemplateId(db, card) {
  if (card.template_id) return card.template_id
  const set = db.prepare('SELECT default_template_id, template_rules FROM sets WHERE id = ?').get(card.set_id)
  return ruleTemplate(db, card, set, 'front') ?? set?.default_template_id ?? null
}

/** The template a card's back is drawn with: its own back, else its set's card back; null when there is none (PRD §7.8). */
export function effectiveBackTemplateId(db, card) {
  if (card.back_template_id) return card.back_template_id
  const set = db.prepare('SELECT default_back_template_id, template_rules FROM sets WHERE id = ?').get(card.set_id)
  return ruleTemplate(db, card, set, 'back') ?? set?.default_back_template_id ?? null
}

// ---------------------------------------------------------------------------
// Step 3 — Template inheritance
// ---------------------------------------------------------------------------

function resolveInheritance(template, db) {
  let svgSource = upgradeLegacyMarkup(template.svg_source ?? '')

  if (!template.parent_id) return svgSource

  const parent = db.prepare('SELECT * FROM templates WHERE id = ?').get(template.parent_id)
  if (!parent) return svgSource // parent missing — degrade gracefully

  // Extract fills blocks from child
  // Pattern: <!-- spadewick:fills="name" --> ... <!-- spadewick:fills="other" or end-of-body -->
  const fills = extractFills(svgSource)

  // Merge into parent: replace each <!-- spadewick:slot="name" --> with matching fill content
  let merged = upgradeLegacyMarkup(parent.svg_source ?? '')
  for (const [name, content] of fills) {
    merged = merged.replace(
      new RegExp(`<!--\\s*spadewick:slot="${escapeRegex(name)}"\\s*-->`, 'g'),
      content
    )
  }

  // Remove any unfilled slots (replace remaining slot comments with empty string)
  merged = merged.replace(/<!--\s*spadewick:slot="[^"]*"\s*-->/g, '')

  // Strip the parent-declaration comment from the result
  merged = merged.replace(/<!--\s*spadewick:parent="[^"]*"\s*-->/g, '')

  return merged
}

/** Extract fills from a child SVG — returns a Map<name, content> */
function extractFills(svgSource) {
  const fills = new Map()
  // Match <!-- spadewick:fills="name" --> ... up to the next fills comment or close of the SVG
  const fillPattern = /<!--\s*spadewick:fills="([^"]+)"\s*-->([\s\S]*?)(?=<!--\s*spadewick:fills=|<\/svg>|$)/g
  let m
  while ((m = fillPattern.exec(svgSource)) !== null) {
    fills.set(m[1], m[2].trim())
  }
  return fills
}

// ---------------------------------------------------------------------------
// Step 5 — Conditional rendering
// ---------------------------------------------------------------------------

function applyConditionals(svg, fields) {
  // data-spadewick-show-if="expr" — hide the element (add display:none) when expr is falsy
  svg = svg.replace(
    /(\s)data-spadewick-show-if="([^"]+)"/g,
    (match, space, expr) => {
      const result = evaluateFormula(expr, fields)
      const hide = !result || result === 'false' || result === '0' || result === ''
      return hide ? `${space}style="display:none"` : ''
    }
  )

  // data-spadewick-hide-if="expr" — hide the element when expr is truthy
  svg = svg.replace(
    /(\s)data-spadewick-hide-if="([^"]+)"/g,
    (match, space, expr) => {
      const result = evaluateFormula(expr, fields)
      const hide = !!result && result !== 'false' && result !== '0' && result !== ''
      return hide ? `${space}style="display:none"` : ''
    }
  )

  return svg
}

// ---------------------------------------------------------------------------
// Step 6 — Dynamic text rendering (PRD §7.4) lives in dynamicText.js
// ---------------------------------------------------------------------------

/** Resolve overflow markers — fills the overflow target element with content */
function resolveOverflowTargets(svg) {
  // Find <!-- spadewick:overflow-content id="X" -->TEXT<!-- spadewick:overflow-end --> markers
  // and fill the SVG element with id="X" with TEXT
  const overflowPattern = /<!--\s*spadewick:overflow-content id="([^"]+)"\s*-->([\s\S]*?)<!--\s*spadewick:overflow-end\s*-->/g
  let m
  while ((m = overflowPattern.exec(svg)) !== null) {
    const [fullMarker, id, overflowText] = m
    svg = svg.replace(fullMarker, '') // remove marker
    // Replace content of the element with matching id
    svg = svg.replace(
      new RegExp(`(<[^>]+\\bid="${escapeRegex(id)}"[^>]*>)[\\s\\S]*?(<\/)`),
      (_, open, close) => `${open}${overflowText}${close}`
    )
  }
  return svg
}

// ---------------------------------------------------------------------------
// Step 7 — Token substitution
// ---------------------------------------------------------------------------

/** data: URI of a library image, or null when the asset or its file is gone. */
function assetDataUri(db, projectDir, assetId) {
  const asset = db.prepare('SELECT filename, mime_type FROM assets WHERE id = ?').get(assetId)
  if (!asset) return null
  const pic = drawable(projectDir, asset)   // a WebP (or other type resvg cannot read) is drawn from its PNG copy
  if (!pic) return null
  return `data:${pic.mime};base64,${readFileSync(pic.file).toString('base64')}`
}

async function substituteTokens(svg, fields, fieldDefs, projectDir, db) {
  const fieldTypeMap = new Map(fieldDefs.map(f => [f.slug, f.type]))

  // PRD §7.1: {{@asset.<id>}} is a fixed library image, the same on every card
  svg = svg.replace(/\{\{\s*@asset\.([^}\s]+)\s*\}\}/g, (_, assetId) => assetDataUri(db, projectDir, assetId) ?? '')

  // Collect image_ref fields that appear in the SVG to load their data URIs
  const imageRefs = new Map()
  for (const [slug, type] of fieldTypeMap) {
    if (type === 'image_ref' && fields[slug]) {
      const assetRef = String(fields[slug])
      if (assetRef.startsWith('asset:')) {
        const uri = assetDataUri(db, projectDir, assetRef.slice(6))
        if (uri) imageRefs.set(slug, uri)
      }
    }
  }

  // Replace all {{slug}} tokens
  svg = svg.replace(/\{\{([^}]+)\}\}/g, (match, slug) => {
    slug = slug.trim()
    if (imageRefs.has(slug)) return imageRefs.get(slug)

    const value = fields[slug]
    if (value === undefined || value === null) return ''

    // Color fields are used verbatim in SVG attributes
    if (fieldTypeMap.get(slug) === 'color') return String(value)

    return xmlEscape(String(value))
  })

  // Resolve overflow target content now that tokens are filled
  svg = resolveOverflowTargets(svg)

  return svg
}

// ---------------------------------------------------------------------------
// Step 8 — Font files
// ---------------------------------------------------------------------------

/**
 * Fonts for this render: the bundled defaults plus any project font whose family the SVG mentions.
 * (Passing only referenced fonts keeps rendering fast for projects with large font libraries.)
 */
function collectFontFiles(svg, projectDir, db) {
  const files = defaultFontFiles(svg)
  const haystack = svg.toLowerCase()
  for (const font of db.prepare('SELECT * FROM fonts').all()) {
    if (!haystack.includes(font.family_name.toLowerCase())) continue
    const filePath = join(projectDir, 'fonts', font.filename)
    if (existsSync(filePath)) files.push(filePath)
  }
  return files
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function getMeta(db, key) {
  return db.prepare('SELECT value FROM project_meta WHERE key = ?').get(key)?.value ?? null
}

function xmlEscape(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Get the value of a named attribute from an attribute string */
function getAttr(attrs, name) {
  const m = attrs.match(new RegExp(`\\b${escapeRegex(name)}="([^"]*)"`, 'i'))
  return m ? m[1] : null
}

/** Set or replace the value of a named attribute in an attribute string */
function setAttr(attrs, name, value) {
  const pattern = new RegExp(`\\b${escapeRegex(name)}="[^"]*"`, 'i')
  if (pattern.test(attrs)) {
    return attrs.replace(pattern, `${name}="${value}"`)
  }
  return `${attrs} ${name}="${value}"`
}
