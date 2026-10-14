/**
 * Applying a text style to a text element, and making one from an element (A80). A style is applied as a copy: its values become the
 * element's own attributes, so the template stays complete without the project's styles (the rule behind A55: a template never depends on
 * anything outside itself). Pure: values in, values out.
 *
 * A style (shared/textStyleProps.js) and the attribute that holds the same thing on a text element:
 *   fontFamily -> font-family      bold -> font-weight      italic -> font-style      color -> fill
 *   tracking (thousandths of an em) -> letter-spacing      smallCaps -> data-spadewick-text-transform
 *   outlineWidth, outlineColor -> data-spadewick-outline   shadowX, shadowY, shadowColor -> data-spadewick-shadow
 * The size of a style is a multiple of the text around it, which has no meaning for an element, so it is left out.
 */

const em = v => `${Math.round(v * 1000) / 1000}em`

/** The attributes (a name to a value; '' means "remove it") a style sets on a text element. Only what the style defines. */
export function styleAttrs(props = {}) {
  const out = {}
  if (props.fontFamily) out['font-family'] = props.fontFamily
  if (props.bold) out['font-weight'] = 'bold'
  if (props.italic) out['font-style'] = 'italic'
  if (props.color) out.fill = props.color
  if (props.tracking != null) out['letter-spacing'] = props.tracking === 0 ? '' : em(props.tracking / 1000)
  if (props.smallCaps) out['data-spadewick-text-transform'] = 'small-caps'
  if (props.outlineWidth) out['data-spadewick-outline'] = `${em(props.outlineWidth)} ${props.outlineColor ?? '#000000'}`
  if (props.shadowX || props.shadowY) out['data-spadewick-shadow'] = `${em(props.shadowX ?? 0)} ${em(props.shadowY ?? 0)} ${props.shadowColor ?? '#000000'}`
  return out
}

/** The style an element's attributes make (what Save as text style stores). `get(name)` reads an attribute, '' when it has none. */
export function styleFromAttrs(get) {
  const props = {}
  const family = get('font-family')
  if (family) props.fontFamily = family
  if (/^(bold|[6-9]00)$/.test(get('font-weight'))) props.bold = true
  if (get('font-style') === 'italic') props.italic = true
  if (/^#[0-9a-f]{6}$/i.test(get('fill'))) props.color = get('fill')
  const track = /^(-?[\d.]+)em$/.exec(get('letter-spacing'))
  if (track) props.tracking = Math.round(parseFloat(track[1]) * 1000)
  if (get('data-spadewick-text-transform') === 'small-caps') props.smallCaps = true
  const outline = get('data-spadewick-outline').trim().split(/\s+/)
  if (outline.length === 2 && /^[\d.]+em$/.test(outline[0]) && /^#[0-9a-f]{6}$/i.test(outline[1])) { props.outlineWidth = parseFloat(outline[0]); props.outlineColor = outline[1] }
  const shadow = get('data-spadewick-shadow').trim().split(/\s+/)
  if (shadow.length === 3 && /^-?[\d.]+em$/.test(shadow[0]) && /^-?[\d.]+em$/.test(shadow[1]) && /^#[0-9a-f]{6}$/i.test(shadow[2])) {
    props.shadowX = parseFloat(shadow[0]); props.shadowY = parseFloat(shadow[1]); props.shadowColor = shadow[2]
  }
  return props
}
