<script>
  /**
   * Rich text markup shown as styled text (PRD §16.7): in the card table, and in the editor's preview. The card itself is
   * drawn by the text engine; this is the same markup read by the same parser, with the project's keyword rules and text
   * styles applied, and the interface's own rendering.
   */
  import { parseMarkup, iconKey } from '../../../shared/richText.js'
  import { applyKeywordRules } from '../../../shared/keywords.js'
  import { mergeStyles } from '../../../shared/textStyleProps.js'
  import { starterIcon, iconPathData, PLACEHOLDER_ICON } from '../../../shared/starterIcons.js'
  import { iconsByKey, stylesByKey, keywordRules } from '../stores/textLibrary.js'

  export let text = ''
  export let inline = false   // newlines become spaces: one line, as in a table cell
  export let slug = undefined // the field the text is from, for keyword rules that are limited to some fields
  export let rules = null     // rules to apply instead of the project's (a rule previewing itself)

  $: runs = applyKeywordRules(parseMarkup(inline ? String(text ?? '').replace(/\s*\n\s*/g, ' ') : String(text ?? ''), { knownStyles: new Set($stylesByKey.keys()) }).runs, rules ?? $keywordRules, { slug })

  const pathOf = name => iconPathData(starterIcon(name) ?? PLACEHOLDER_ICON)
  const maskUri = svg => `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.replace(/currentColor/g, '#000'))}")`
  const imgUri = svg => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.replace(/currentColor/g, '#000'))}`

  // Colours and fonts reach this string only after they were checked (a hex colour, a name without quotes)
  function css(r) {
    const sp = mergeStyles((r.styles ?? []).map(k => $stylesByKey.get(k)))
    let s = ''
    if (r.bold || sp.bold) s += 'font-weight:700;'
    if (r.italic || sp.italic) s += 'font-style:italic;'
    if (r.underline || r.strike || sp.underline || sp.strike) s += `text-decoration:${[(r.underline || sp.underline) && 'underline', (r.strike || sp.strike) && 'line-through'].filter(Boolean).join(' ')};`
    if (r.color ?? sp.color) s += `color:${r.color ?? sp.color};`
    const size = r.size * (sp.size ?? 1)
    if (size !== 1) s += `font-size:${size}em;`
    if (r.font ?? sp.fontFamily) s += `font-family:'${r.font ?? sp.fontFamily}';`
    if (sp.smallCaps) s += 'font-variant:small-caps;'
    if (sp.outlineWidth) s += `-webkit-text-stroke:${Math.max(0.5, sp.outlineWidth * 16)}px ${sp.outlineColor ?? '#000'};paint-order:stroke fill;`
    if (sp.shadowX || sp.shadowY) s += `text-shadow:${sp.shadowX ?? 0}em ${sp.shadowY ?? 0}em 0 ${sp.shadowColor ?? '#000'};`
    return s
  }

  function iconStyle(r, lib) {
    const color = r.iconColor ?? r.color
    const size = r.scale * (lib?.size ?? 1)
    const w = size * (lib?.aspect ?? 1)
    let s = `width:${w}em;height:${size}em;margin:0 ${lib?.spacing ?? 0}em;vertical-align:${-0.12 + (lib?.vOffset ?? 0)}em;`
    if (color) s += `color:${color};`
    return s
  }
</script>

<span class="rich" class:block={!inline}>{#each runs as r}{#if r.icon}{@const lib = $iconsByKey.get(iconKey(r.icon))}{#if lib?.svg && lib.single && lib.colorMode === 'follow'}<span class="icon mask" role="img" aria-label={r.icon} style="{iconStyle(r, lib)}-webkit-mask-image:{maskUri(lib.svg)};mask-image:{maskUri(lib.svg)};" />{:else if lib?.svg}<img class="icon" alt={r.icon} src={imgUri(lib.svg)} style={iconStyle(r, lib)} />{:else if lib?.uri}<img class="icon" alt={r.icon} src={lib.uri} style={iconStyle(r, lib)} />{:else}<svg class="icon" viewBox="0 0 100 100" role="img" aria-label={r.icon} style={iconStyle(r, null)}><path d={pathOf(r.icon)} fill="currentColor" /></svg>{/if}{:else}<span style={css(r)}>{r.text}</span>{/if}{/each}</span>

<style>
  .rich.block { white-space: pre-wrap; }
  .icon { display: inline-block; }
  .mask { background-color: currentColor; -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat; -webkit-mask-position: center; mask-position: center; -webkit-mask-size: contain; mask-size: contain; }
</style>
