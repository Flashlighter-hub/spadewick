/**
 * Templates made before the rename to Spadewick use the `data-cardexy-*` attribute prefix and
 * `<!-- cardexy:… -->` comment markers. Both stay readable permanently (PRD §24.2, phase 0.1):
 * they are rewritten to the current prefix whenever a template is loaded, rendered or saved.
 */
export function upgradeLegacyMarkup(svg) {
  if (typeof svg !== 'string' || !/cardexy/i.test(svg)) return svg
  return svg
    .replace(/\bdata-cardexy-/g, 'data-spadewick-')
    .replace(/(<!--\s*)cardexy:/g, '$1spadewick:')
}
