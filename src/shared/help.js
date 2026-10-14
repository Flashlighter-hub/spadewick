/**
 * What the built-in guide (the Help tab) contains. The words are in strings.js under `help`; this file says which entries each section
 * has, so that a test can check that every entry has its words and no words are left over. The formula functions are not listed here:
 * they come from the formula language itself (src/main/formula.js), so the guide cannot fall behind it.
 */
import { FORMULA_FUNCTIONS, FORMULA_OPERATORS } from '../main/formula.js'

/** The sections of the guide, in groups, in the order the list on the left shows them. */
export const HELP_GROUPS = {
  start: ['quickstart', 'workspace'],
  build: ['projects', 'data', 'balance', 'images', 'templates', 'svgSizing', 'canvas'],
  reference: ['formulas', 'tokens', 'conditions', 'fitting', 'fields', 'richText', 'textTools'],
  output: ['exporting', 'print'],
  play: ['table', 'keys', 'rules'],
  more: ['commandLine', 'troubleshooting', 'glossary']
}

export const HELP_SECTIONS = Object.values(HELP_GROUPS).flat()

/** The entries of every section except the function lists of the formulas, in the order they are shown. */
export const HELP_ITEMS = {
  quickstart: ['project', 'set', 'fields', 'cards', 'template', 'bind', 'check', 'export', 'snapshot', 'next'],
  workspace: ['tabs', 'sidebar', 'statusBar', 'saving', 'menus', 'shortcuts', 'panels', 'preferences', 'access', 'portable'],
  projects: ['project', 'sets', 'sizes', 'sizeChange', 'undo', 'snapshots', 'compare', 'restoreChanges', 'older', 'integrity', 'backup'],
  data: ['table', 'builtIn', 'rows', 'columns', 'bulk', 'preview', 'fieldManager', 'slug', 'displayName', 'cardIds', 'quantity', 'import', 'importOther', 'ownVersion', 'views', 'status', 'excel', 'export', 'findReplace'],
  images: ['library', 'importing', 'using', 'replace', 'fonts', 'fontNames', 'fontRights', 'engine'],
  templates: ['what', 'editor', 'create', 'library', 'packages', 'inheritance', 'svgImport', 'naming', 'tools', 'reimport', 'components', 'backs', 'rules', 'bleed', 'source', 'attributes'],
  canvas: ['select', 'tools', 'moving', 'zoom', 'snapping', 'properties', 'editing', 'typing', 'binding', 'everyLayer', 'resizeAll', 'pasteboard', 'layers', 'colours'],
  formulas: ['writing', 'fieldNames', 'quotes', 'nesting', 'results', 'choosing', 'comparing', 'circular', 'errors', 'whereUsed'],
  svgSizing: ['rule', 'sizes', 'header', 'noBleed', 'bleed', 'safe', 'linkedPictures', 'textBoxes', 'corners', 'wrongShape', 'resolution', 'tools', 'check', 'checklist'],
  tokens: ['field', 'displayName', 'cardId', 'cardNumber', 'cardCount', 'asset'],
  conditions: ['showIf', 'hideIf', 'truthy', 'layerNames'],
  fitting: ['box', 'wrap', 'shrink', 'truncate', 'overflow', 'clip', 'lines', 'spacing'],
  fields: ['text', 'number', 'boolean', 'image', 'color', 'formula', 'richText', 'choice', 'tags', 'lookup', 'name', 'identifier'],
  balance: ['view', 'charts', 'warnings', 'required'],
  richText: ['bold', 'italic', 'underline', 'strike', 'icon', 'color', 'size', 'font', 'style', 'escape'],
  textTools: ['icons', 'styles', 'keywords', 'editor', 'check', 'emoji', 'scripts'],
  exporting: ['dialog', 'exportPreview', 'pdfFit', 'filter', 'finalOnly', 'fileNames', 'tts', 'ttsLoad', 'ttsLinks', 'pdf', 'duplex', 'png', 'backsExport', 'sameLook'],
  print: ['production', 'honest', 'presets', 'preflight', 'bleed', 'colour', 'printColours', 'profiles', 'images'],
  table: ['start', 'moving', 'dice', 'pan', 'turns', 'saving', 'follows', 'share', 'private', 'connection', 'authority'],
  keys: ['flip', 'peek', 'sets', 'shuffle', 'rotate', 'draw', 'deal', 'look', 'move', 'roll', 'next', 'hand', 'delete', 'undo'],
  rules: ['pages', 'format', 'pictures', 'cardRefs', 'links', 'importExport', 'limits'],
  commandLine: ['where', 'commands', 'options', 'exitCodes', 'safety', 'build', 'watch'],
  troubleshooting: ['notDrawn', 'noTemplates', 'emptyToken', 'boxes', 'missingImage', 'formulaWrong', 'ttsImageError', 'sizeMismatch', 'sharing', 'csvProblems', 'newer', 'damaged', 'slow', 'synced', 'report'],
  glossary: ['project', 'set', 'field', 'token', 'template', 'frame', 'component', 'asset', 'snapshot', 'cardId', 'quantity', 'displayName', 'identifier', 'pile', 'trim', 'cmyk', 'preflight', 'dieLine', 'spot', 'richText', 'markdown']
}

/** The worked examples of the formulas section. */
export const HELP_EXAMPLES = ['strong', 'stats', 'position', 'initial', 'rarity', 'tier', 'colour', 'short', 'ratio', 'label', 'total']

export const HELP_FORMULA_GROUPS = Object.keys(FORMULA_FUNCTIONS)
export const HELP_FORMULA_FUNCTIONS = FORMULA_FUNCTIONS
export const HELP_OPERATORS = FORMULA_OPERATORS
